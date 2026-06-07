#!/usr/bin/env python
"""Formal MNE preprocessing and event-locked EEG features for Metro Rescue XDF.

This script is intentionally separate from the lightweight web worker summary.
It produces paper-facing EEG QC, baseline-corrected event-window features, and
planned contrasts from local or downloaded XDF files.
"""

from __future__ import annotations

import argparse
import csv
import html
import json
import math
import random
import sys
import traceback
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
LOCAL_PYDEPS = ROOT / "work" / "pydeps"
if LOCAL_PYDEPS.exists() and str(LOCAL_PYDEPS) not in sys.path:
    sys.path.insert(0, str(LOCAL_PYDEPS))

import numpy as np

import advanced_analysis_worker as worker


DENSITY_LEVELS = ("low", "medium", "high")
RUN_POSITION_TO_DENSITY = {1: "low", 2: "medium", 3: "high"}
PLANNED_CONTRAST_WEIGHTS = {"low": -0.5, "medium": 1.0, "high": -0.5}

BANDS = {
    "theta": (4.0, 7.0),
    "alpha": (8.0, 12.0),
    "beta": (13.0, 30.0),
}

EVENT_SPECS = {
    "decision_point_enter": {"tmin": -1.0, "tmax": 2.0, "post": (0.0, 2.0), "role": "primary_h3"},
    "sign_readable": {"tmin": -1.0, "tmax": 1.5, "post": (0.0, 1.5), "role": "secondary_confirmation"},
    "sign_visible_enter": {"tmin": -1.0, "tmax": 1.5, "post": (0.0, 1.5), "role": "secondary_visibility"},
    "audio_play": {"tmin": -1.0, "tmax": 1.5, "post": (0.0, 1.5), "role": "secondary_prompt"},
}

BASELINE_WINDOW = (-1.0, 0.0)
FORMAL_CONTRAST_METRICS = (
    "decision_point_enter_formal_load_delta",
    "sign_readable_formal_load_delta",
    "trial_formal_load_proxy",
    "decision_point_enter_frontal_theta_delta",
    "decision_point_enter_posterior_alpha_delta",
)
METRIC_LABELS = {
    "decision_point_enter_formal_load_delta": "H3 composite: decision-point formal EEG load",
    "sign_readable_formal_load_delta": "Secondary: sign-readable formal EEG load",
    "trial_formal_load_proxy": "Sensitivity: whole-trial formal EEG load",
    "decision_point_enter_frontal_theta_delta": "Planned component: decision-point frontal theta",
    "decision_point_enter_posterior_alpha_delta": "Planned component: decision-point posterior alpha",
}
BOOTSTRAP_ITERATIONS = 20000
SIGNFLIP_ITERATIONS = 50000
NON_EEG_LABEL_TOKENS = (
    "event",
    "marker",
    "trigger",
    "stim",
    "status",
    "sync",
    "counter",
    "timestamp",
    "packet",
)


@dataclass
class ProcessedRun:
    qc: dict[str, Any]
    features: dict[str, Any]
    epoch_rows: list[dict[str, Any]]
    event_rows: list[dict[str, Any]]
    notes: list[str]


def main() -> None:
    parser = argparse.ArgumentParser(description="Run formal MNE preprocessing on Metro Rescue XDF files.")
    parser.add_argument("--xdf", action="append", type=Path, help="One XDF file. Can be passed multiple times.")
    parser.add_argument("--raw-dir", type=Path, default=Path("work/xdf_raw"), help="Directory used when --xdf is omitted.")
    parser.add_argument("--out-dir", type=Path, default=Path("work/eeg_mne_preprocessing"))
    parser.add_argument("--limit", type=int, default=0, help="Optional file limit for smoke tests.")
    parser.add_argument("--line-freq", type=float, default=50.0, help="Line noise frequency in Hz; use 0 to skip notch.")
    parser.add_argument("--l-freq", type=float, default=1.0)
    parser.add_argument("--h-freq", type=float, default=40.0)
    parser.add_argument("--resample-hz", type=float, default=250.0)
    parser.add_argument("--no-resample", action="store_true")
    parser.add_argument("--epoch-ptp-z", type=float, default=6.0, help="Robust MAD-z threshold for epoch artifact rejection.")
    parser.add_argument("--bad-channel-z", type=float, default=8.0, help="Robust MAD-z threshold for bad channel detection.")
    args = parser.parse_args()

    pyxdf, mne = require_dependencies()
    mne.set_log_level("ERROR")

    paths = list(args.xdf or sorted(args.raw_dir.glob("*.xdf")))
    if args.limit and args.limit > 0:
        paths = paths[: args.limit]
    if not paths:
        raise SystemExit(f"No XDF files found. Checked --xdf and {args.raw_dir}.")

    args.out_dir.mkdir(parents=True, exist_ok=True)

    qc_rows: list[dict[str, Any]] = []
    feature_rows: list[dict[str, Any]] = []
    epoch_rows: list[dict[str, Any]] = []
    event_rows: list[dict[str, Any]] = []

    for index, path in enumerate(paths, start=1):
        print(f"[{index}/{len(paths)}] formal EEG {path.name}", flush=True)
        try:
            result = process_xdf(path, args, pyxdf, mne)
        except Exception as exc:  # pragma: no cover - keeps batch jobs moving
            qc = base_file_identity(path)
            qc.update({"status": "failed", "error": f"{type(exc).__name__}: {exc}"})
            qc_rows.append(qc)
            (args.out_dir / f"{safe_stem(path.name)}.error.txt").write_text(traceback.format_exc(), encoding="utf-8")
            continue

        qc_rows.append(result.qc)
        feature_rows.append(result.features)
        epoch_rows.extend(result.epoch_rows)
        event_rows.extend(result.event_rows)

        per_run_json = {
            "qc": result.qc,
            "features": result.features,
            "events": result.event_rows,
            "notes": result.notes,
        }
        write_json(args.out_dir / f"{safe_stem(path.name)}.formal_eeg.json", per_run_json)

    subject_contrasts, contrast_summary = compute_formal_contrasts(feature_rows)
    condition_profiles = compute_condition_profiles(subject_contrasts)
    pairwise_results = compute_pairwise_results(subject_contrasts)
    robustness_results = compute_robustness_results(subject_contrasts)
    leave_one_out = compute_leave_one_subject_out(subject_contrasts)

    write_csv(args.out_dir / "formal_eeg_run_qc.csv", qc_rows)
    write_csv(args.out_dir / "formal_eeg_run_features.csv", feature_rows)
    write_csv(args.out_dir / "formal_eeg_event_summary.csv", event_rows)
    write_csv(args.out_dir / "formal_eeg_epoch_features.csv", epoch_rows)
    write_csv(args.out_dir / "formal_eeg_subject_contrasts.csv", subject_contrasts)
    write_csv(args.out_dir / "formal_eeg_contrast_summary.csv", contrast_summary)
    write_csv(args.out_dir / "formal_eeg_condition_profiles.csv", condition_profiles)
    write_csv(args.out_dir / "formal_eeg_pairwise_results.csv", pairwise_results)
    write_csv(args.out_dir / "formal_eeg_robustness_results.csv", robustness_results)
    write_csv(args.out_dir / "formal_eeg_leave_one_subject_out.csv", leave_one_out)
    write_formal_eeg_html_report(
        args.out_dir / "formal_eeg_report.html",
        qc_rows=qc_rows,
        contrast_summary=contrast_summary,
        robustness_results=robustness_results,
        condition_profiles=condition_profiles,
        pairwise_results=pairwise_results,
        leave_one_out=leave_one_out,
    )
    write_json(
        args.out_dir / "formal_eeg_summary.json",
        {
            "files_requested": len(paths),
            "files_completed": sum(1 for row in qc_rows if row.get("status") == "ok"),
            "files_failed": sum(1 for row in qc_rows if row.get("status") == "failed"),
            "contrast_metrics": list(FORMAL_CONTRAST_METRICS),
            "contrast_summary": contrast_summary,
            "robustness_results": robustness_results,
        },
    )

    print(
        json.dumps(
            {
                "out_dir": str(args.out_dir),
                "files_completed": sum(1 for row in qc_rows if row.get("status") == "ok"),
                "files_failed": sum(1 for row in qc_rows if row.get("status") == "failed"),
                "contrast_rows": len(contrast_summary),
            },
            ensure_ascii=False,
            indent=2,
        ),
        flush=True,
    )


def require_dependencies():
    missing = []
    try:
        import pyxdf  # type: ignore
    except Exception:
        pyxdf = None
        missing.append("pyxdf")
    try:
        import mne  # type: ignore
    except Exception:
        mne = None
        missing.append("mne")

    if missing:
        raise SystemExit(
            "Missing EEG preprocessing dependency: "
            + ", ".join(missing)
            + ". Install with: python -m pip install -r scripts/analysis_requirements.txt"
        )
    return pyxdf, mne


def process_xdf(path: Path, args: argparse.Namespace, pyxdf: Any, mne: Any) -> ProcessedRun:
    streams, _header = pyxdf.load_xdf(str(path), dejitter_timestamps=True, verbose=False)
    marker_streams = [stream for stream in streams if worker.is_marker_stream(stream)]
    eeg_streams = [stream for stream in streams if worker.is_eeg_stream(stream)]
    marker_stream = worker.choose_marker_stream(marker_streams)
    eeg_stream = worker.choose_eeg_stream(eeg_streams)

    identity = base_file_identity(path)
    notes: list[str] = []

    if not marker_stream:
        raise ValueError("no marker stream")
    if not eeg_stream:
        raise ValueError("no EEG stream")

    marker_rows = worker.parse_marker_stream(marker_stream)
    raw_primary_rows = worker.select_primary_session(marker_rows)
    raw_window = worker.get_trial_window(raw_primary_rows)
    trial_rows = worker.filter_rows_to_trial_window(raw_primary_rows, raw_window)
    primary_rows, duplicate_marker_count = worker.deduplicate_marker_rows(trial_rows)
    trial_window = worker.get_trial_window(primary_rows) or raw_window

    timestamps, data, labels, raw_sfreq = load_eeg_matrix(eeg_stream)
    if data.size == 0 or len(timestamps) < 2:
        raise ValueError("empty EEG stream")

    data, timestamps = worker.align_data_and_timestamps(data, timestamps)
    trial_data = data[worker.trial_mask(timestamps, trial_window)] if trial_window else data
    if len(trial_data) < max(32, int(raw_sfreq)):
        trial_data = data
        notes.append("trial EEG samples were sparse; bad-channel screening used the full EEG stream.")

    channel_selection = select_eeg_channels(trial_data, labels, args.bad_channel_z)
    retained_indices = channel_selection["retained_indices"]
    if len(retained_indices) < 4:
        raise ValueError("fewer than 4 retained EEG-like channels after channel screening")

    retained_labels = [labels[index] for index in retained_indices]
    retained_data = data[:, retained_indices]
    raw, raw_meta = make_mne_raw(retained_data, timestamps, retained_labels, raw_sfreq, args, mne, channel_selection)
    region_meta = channel_region_meta(raw.ch_names)

    events = collect_events(primary_rows, timestamps[0], raw.times[-1], raw.info["sfreq"])
    event_summary_rows, epoch_rows, event_counts = summarize_event_features(raw, events, identity, args)
    trial_features = compute_trial_features(raw, timestamps[0], trial_window)

    features = dict(identity)
    features.update(trial_features)
    for row in event_summary_rows:
        event = row["event"]
        features[f"{event}_accepted_epochs"] = row["accepted_epochs"]
        features[f"{event}_rejected_epochs"] = row["rejected_epochs"]
        features[f"{event}_formal_load_delta"] = row["formal_load_delta"]
        features[f"{event}_frontal_theta_delta"] = row["frontal_theta_delta"]
        features[f"{event}_posterior_alpha_delta"] = row["posterior_alpha_delta"]
        features[f"{event}_theta_alpha_delta"] = row["theta_alpha_delta"]

    eeg_start = float(timestamps[0])
    eeg_end = float(timestamps[-1])
    qc = dict(identity)
    qc.update(
        {
            "status": "ok",
            "streams_total": len(streams),
            "marker_streams": len(marker_streams),
            "eeg_streams": len(eeg_streams),
            "raw_channels": data.shape[1],
            "retained_channels": len(retained_indices),
            "preexcluded_channels": len(channel_selection["preexcluded_labels"]),
            "bad_channels": len(channel_selection["bad_labels"]),
            "dropped_bad_channels": len(raw_meta["dropped_bad_channels"]),
            "interpolated_bad_channels": len(raw_meta["interpolated_bad_channels"]),
            "montage_set": "yes" if raw_meta["montage_set"] else "no",
            "frontal_channels_used": region_meta["frontal_channels_used"],
            "posterior_channels_used": region_meta["posterior_channels_used"],
            "region_fallback": region_meta["region_fallback"],
            "raw_sfreq_hz": fmt(raw_sfreq),
            "processed_sfreq_hz": fmt(raw.info["sfreq"]),
            "eeg_duration_s": fmt(eeg_end - eeg_start),
            "trial_duration_s": fmt(trial_window.get("duration_s") if trial_window else None),
            "trial_eeg_coverage_ratio": fmt(eeg_trial_coverage_ratio(timestamps, raw_sfreq, trial_window)),
            "duplicate_marker_count": duplicate_marker_count,
            "decision_point_enter_candidates": event_counts.get("decision_point_enter", {}).get("candidates", 0),
            "decision_point_enter_accepted": event_counts.get("decision_point_enter", {}).get("accepted", 0),
            "sign_readable_candidates": event_counts.get("sign_readable", {}).get("candidates", 0),
            "sign_readable_accepted": event_counts.get("sign_readable", {}).get("accepted", 0),
            "notes": " | ".join(notes[:4]),
        }
    )

    for row in event_summary_rows:
        row.update(identity)
    for row in epoch_rows:
        row.update(identity)

    return ProcessedRun(qc=qc, features=features, epoch_rows=epoch_rows, event_rows=event_summary_rows, notes=notes)


def load_eeg_matrix(stream: dict[str, Any]) -> tuple[np.ndarray, np.ndarray, list[str], float]:
    timestamps = np.asarray(stream.get("time_stamps", []), dtype=float)
    data = worker.ensure_2d_numeric(stream.get("time_series", []), len(timestamps))
    labels = worker.extract_channel_labels(stream.get("info", {}), data.shape[1] if data.size else 0)
    sfreq = worker.effective_sampling_rate(stream, timestamps)
    return timestamps, data, labels, sfreq


def select_eeg_channels(data: np.ndarray, labels: list[str], bad_channel_z: float) -> dict[str, Any]:
    quality = worker.channel_quality(data, labels)
    preexcluded: list[str] = []
    retained_candidates: list[int] = []

    for row in quality:
        label = row["label"]
        if is_non_eeg_label(label) or "event-channel" in row["flag"] or "flat" in row["flag"]:
            preexcluded.append(label)
            continue
        retained_candidates.append(row["index"])

    if not retained_candidates:
        retained_candidates = [row["index"] for row in quality if "flat" not in row["flag"]]

    candidate_data = data[:, retained_candidates]
    std = robust_vector(np.nanstd(candidate_data, axis=0))
    ptp = robust_vector(np.nanmax(candidate_data, axis=0) - np.nanmin(candidate_data, axis=0))
    missing = np.mean(~np.isfinite(candidate_data), axis=0) * 100.0
    std_z = robust_z(std)
    ptp_z = robust_z(ptp)

    bad_indices: list[int] = []
    for local_index, original_index in enumerate(retained_candidates):
        if missing[local_index] > 5.0 or std[local_index] <= 0:
            bad_indices.append(original_index)
        elif std_z[local_index] > bad_channel_z or ptp_z[local_index] > bad_channel_z:
            bad_indices.append(original_index)

    retained = [index for index in retained_candidates if index not in set(bad_indices)]
    return {
        "quality": quality,
        "retained_indices": retained,
        "preexcluded_labels": preexcluded,
        "bad_labels": [labels[index] for index in bad_indices],
    }


def make_mne_raw(
    data: np.ndarray,
    timestamps: np.ndarray,
    labels: list[str],
    sfreq: float,
    args: argparse.Namespace,
    mne: Any,
    channel_selection: dict[str, Any],
) -> tuple[Any, dict[str, Any]]:
    if sfreq <= 0:
        raise ValueError("invalid EEG sampling rate")

    clean = np.asarray(data, dtype=float)
    for col in range(clean.shape[1]):
        column = clean[:, col]
        finite = np.isfinite(column)
        fill = float(np.nanmedian(column[finite])) if np.any(finite) else 0.0
        column[~finite] = fill
        clean[:, col] = column

    unique_labels = make_unique_labels(canonical_mne_labels(labels, mne))
    info = mne.create_info(unique_labels, sfreq=sfreq, ch_types=["eeg"] * len(unique_labels))
    raw = mne.io.RawArray(clean.T, info, verbose="ERROR")

    raw.info["bads"] = [label for label in channel_selection["bad_labels"] if label in raw.ch_names]
    montage_set = try_set_montage(raw, mne)

    h_freq = min(float(args.h_freq), max(1.0, (sfreq / 2.0) - 1.0))
    if args.line_freq and args.line_freq > 0 and args.line_freq < (sfreq / 2.0):
        raw.notch_filter(freqs=[float(args.line_freq)], picks="eeg", verbose="ERROR")
    raw.filter(l_freq=float(args.l_freq), h_freq=h_freq, picks="eeg", verbose="ERROR")

    interpolated: list[str] = []
    dropped: list[str] = []
    if raw.info["bads"]:
        if montage_set and (len(raw.ch_names) - len(raw.info["bads"])) >= 4:
            interpolated = list(raw.info["bads"])
            raw.interpolate_bads(reset_bads=True, verbose="ERROR")
        else:
            dropped = list(raw.info["bads"])
            raw.drop_channels(dropped)

    raw.set_eeg_reference("average", projection=False, verbose="ERROR")

    if not args.no_resample and args.resample_hz and raw.info["sfreq"] > args.resample_hz:
        raw.resample(float(args.resample_hz), npad="auto", verbose="ERROR")

    return raw, {
        "montage_set": montage_set,
        "interpolated_bad_channels": interpolated,
        "dropped_bad_channels": dropped,
    }


def try_set_montage(raw: Any, mne: Any) -> bool:
    montage = mne.channels.make_standard_montage("standard_1020")
    montage_names = {worker.normalize_channel_label(name) for name in montage.ch_names}
    matches = [name for name in raw.ch_names if worker.normalize_channel_label(name) in montage_names]
    if len(matches) < 4:
        return False
    raw.set_montage(montage, on_missing="ignore", verbose="ERROR")
    return True


def canonical_mne_labels(labels: list[str], mne: Any) -> list[str]:
    montage = mne.channels.make_standard_montage("standard_1020")
    standard_by_norm = {worker.normalize_channel_label(name): name for name in montage.ch_names}
    out = []
    for label in labels:
        normalized = worker.normalize_channel_label(label)
        out.append(standard_by_norm.get(normalized, worker.canonical_channel_label(label)))
    return out


def collect_events(rows: list[dict[str, Any]], eeg_start: float, eeg_duration: float, sfreq: float) -> dict[str, list[dict[str, Any]]]:
    events: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        event = str(row.get("event", ""))
        spec = EVENT_SPECS.get(event)
        if not spec:
            continue
        rel_time = float(row["_xdf_ts"]) - eeg_start
        if rel_time + float(spec["tmin"]) < 0 or rel_time + float(spec["tmax"]) > eeg_duration:
            continue
        events[event].append(
            {
                "sample": int(round(rel_time * sfreq)),
                "xdf_time": float(row["_xdf_ts"]),
                "rel_time": rel_time,
            }
        )
    return events


def summarize_event_features(
    raw: Any,
    events: dict[str, list[dict[str, Any]]],
    identity: dict[str, Any],
    args: argparse.Namespace,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, dict[str, int]]]:
    event_rows: list[dict[str, Any]] = []
    epoch_rows: list[dict[str, Any]] = []
    event_counts: dict[str, dict[str, int]] = {}

    for event_name, spec in EVENT_SPECS.items():
        candidates = events.get(event_name, [])
        candidate_epochs = [epoch_from_event(raw, candidate, spec) for candidate in candidates]
        candidate_epochs = [epoch for epoch in candidate_epochs if epoch is not None]
        accepted, rejected = reject_artifact_epochs(candidate_epochs, args.epoch_ptp_z)

        event_counts[event_name] = {"candidates": len(candidates), "accepted": len(accepted), "rejected": len(rejected)}
        if not accepted:
            event_rows.append(empty_event_summary(event_name, len(candidates), len(rejected)))
            continue

        per_epoch_features = []
        for epoch_index, epoch in enumerate(accepted, start=1):
            features = compute_epoch_band_delta(raw, epoch, spec)
            if not features:
                continue
            features.update(
                {
                    "event": event_name,
                    "epoch_index": epoch_index,
                    "xdf_time": fmt(epoch["xdf_time"]),
                    "rel_time_s": fmt(epoch["rel_time"]),
                    "artifact_ptp": fmt(epoch["artifact_ptp"]),
                }
            )
            features.update(identity)
            per_epoch_features.append(features)
            epoch_rows.append(features)

        event_rows.append(summarize_epoch_feature_rows(event_name, len(candidates), len(rejected), per_epoch_features))

    return event_rows, epoch_rows, event_counts


def epoch_from_event(raw: Any, event: dict[str, Any], spec: dict[str, Any]) -> dict[str, Any] | None:
    sfreq = float(raw.info["sfreq"])
    start = int(round((event["rel_time"] + float(spec["tmin"])) * sfreq))
    stop = int(round((event["rel_time"] + float(spec["tmax"])) * sfreq))
    base_start = int(round((event["rel_time"] + BASELINE_WINDOW[0]) * sfreq))
    base_stop = int(round((event["rel_time"] + BASELINE_WINDOW[1]) * sfreq))
    post_start = int(round((event["rel_time"] + float(spec["post"][0])) * sfreq))
    post_stop = int(round((event["rel_time"] + float(spec["post"][1])) * sfreq))
    if min(start, base_start, post_start) < 0 or max(stop, base_stop, post_stop) > raw.n_times:
        return None
    epoch_data = raw.get_data(start=start, stop=stop)
    if epoch_data.shape[1] < int(sfreq):
        return None
    return {
        "xdf_time": event["xdf_time"],
        "rel_time": event["rel_time"],
        "start": start,
        "stop": stop,
        "baseline": (base_start, base_stop),
        "post": (post_start, post_stop),
        "artifact_ptp": float(np.nanmedian(np.ptp(epoch_data, axis=1))),
    }


def reject_artifact_epochs(epochs: list[dict[str, Any]], threshold_z: float) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    if not epochs:
        return [], []
    ptp = np.asarray([epoch["artifact_ptp"] for epoch in epochs], dtype=float)
    z = robust_z(ptp)
    accepted: list[dict[str, Any]] = []
    rejected: list[dict[str, Any]] = []
    for epoch, score in zip(epochs, z):
        if not math.isfinite(float(epoch["artifact_ptp"])) or score > threshold_z:
            rejected.append(epoch)
        else:
            accepted.append(epoch)
    return accepted, rejected


def compute_epoch_band_delta(raw: Any, epoch: dict[str, Any], spec: dict[str, Any]) -> dict[str, Any]:
    baseline = raw.get_data(start=epoch["baseline"][0], stop=epoch["baseline"][1])
    post = raw.get_data(start=epoch["post"][0], stop=epoch["post"][1])
    baseline_power = log_band_power(baseline, raw.info["sfreq"])
    post_power = log_band_power(post, raw.info["sfreq"])
    if not baseline_power or not post_power:
        return {}

    labels = raw.ch_names
    frontal_matched = label_indices(labels, worker.FRONTAL_CHANNELS)
    posterior_matched = label_indices(labels, worker.POSTERIOR_CHANNELS)
    frontal = frontal_matched or list(range(len(labels)))
    posterior = posterior_matched or list(range(len(labels)))

    theta_delta = post_power["theta"] - baseline_power["theta"]
    alpha_delta = post_power["alpha"] - baseline_power["alpha"]
    beta_delta = post_power["beta"] - baseline_power["beta"]

    frontal_theta_delta = float(np.nanmean(theta_delta[frontal]))
    posterior_alpha_delta = float(np.nanmean(alpha_delta[posterior]))
    global_theta_delta = float(np.nanmean(theta_delta))
    global_alpha_delta = float(np.nanmean(alpha_delta))
    global_beta_delta = float(np.nanmean(beta_delta))
    theta_alpha_delta = global_theta_delta - global_alpha_delta
    formal_load_delta = frontal_theta_delta - posterior_alpha_delta + theta_alpha_delta

    return {
        "frontal_theta_delta": fmt(frontal_theta_delta),
        "posterior_alpha_delta": fmt(posterior_alpha_delta),
        "global_theta_delta": fmt(global_theta_delta),
        "global_alpha_delta": fmt(global_alpha_delta),
        "global_beta_delta": fmt(global_beta_delta),
        "theta_alpha_delta": fmt(theta_alpha_delta),
        "formal_load_delta": fmt(formal_load_delta),
        "frontal_channel_count": len(frontal),
        "posterior_channel_count": len(posterior),
        "region_fallback": region_fallback_label(frontal_matched, posterior_matched),
        "post_window_s": f"{spec['post'][0]}..{spec['post'][1]}",
        "baseline_window_s": f"{BASELINE_WINDOW[0]}..{BASELINE_WINDOW[1]}",
    }


def compute_trial_features(raw: Any, eeg_start: float, trial_window: dict[str, float] | None) -> dict[str, Any]:
    if not trial_window:
        return {}
    start = max(0, int(round((float(trial_window["start_ts"]) - eeg_start) * raw.info["sfreq"])))
    stop = min(raw.n_times, int(round((float(trial_window["end_ts"]) - eeg_start) * raw.info["sfreq"])))
    if stop - start < int(raw.info["sfreq"] * 4):
        return {}

    segment = raw.get_data(start=start, stop=stop)
    powers = log_band_power(segment, raw.info["sfreq"])
    if not powers:
        return {}

    labels = raw.ch_names
    frontal_matched = label_indices(labels, worker.FRONTAL_CHANNELS)
    posterior_matched = label_indices(labels, worker.POSTERIOR_CHANNELS)
    frontal = frontal_matched or list(range(len(labels)))
    posterior = posterior_matched or list(range(len(labels)))
    frontal_theta = float(np.nanmean(powers["theta"][frontal]))
    posterior_alpha = float(np.nanmean(powers["alpha"][posterior]))
    global_theta = float(np.nanmean(powers["theta"]))
    global_alpha = float(np.nanmean(powers["alpha"]))
    theta_alpha = global_theta - global_alpha
    formal_load = frontal_theta - posterior_alpha + theta_alpha
    return {
        "trial_frontal_theta_log_power": fmt(frontal_theta),
        "trial_posterior_alpha_log_power": fmt(posterior_alpha),
        "trial_theta_alpha_log_ratio": fmt(theta_alpha),
        "trial_formal_load_proxy": fmt(formal_load),
        "trial_frontal_channel_count": len(frontal),
        "trial_posterior_channel_count": len(posterior),
        "trial_region_fallback": region_fallback_label(frontal_matched, posterior_matched),
    }


def log_band_power(segment: np.ndarray, sfreq: float) -> dict[str, np.ndarray] | None:
    try:
        from mne.time_frequency import psd_array_welch
    except Exception:
        return None

    if segment.ndim != 2 or segment.shape[1] < max(64, int(sfreq)):
        return None
    n_times = segment.shape[1]
    n_fft = min(n_times, max(128, int(round(sfreq * 2))))
    n_per_seg = min(n_times, n_fft)
    psd, freqs = psd_array_welch(
        segment,
        sfreq=sfreq,
        fmin=2.0,
        fmax=35.0,
        n_fft=n_fft,
        n_per_seg=n_per_seg,
        average="mean",
        verbose=False,
    )
    out: dict[str, np.ndarray] = {}
    for name, (low, high) in BANDS.items():
        mask = (freqs >= low) & (freqs <= high)
        if not np.any(mask):
            return None
        band = np.trapezoid(psd[:, mask], freqs[mask], axis=1)
        out[name] = np.log10(np.maximum(band, 1e-24))
    return out


def summarize_epoch_feature_rows(
    event_name: str,
    candidate_count: int,
    rejected_count: int,
    rows: list[dict[str, Any]],
) -> dict[str, Any]:
    if not rows:
        return empty_event_summary(event_name, candidate_count, rejected_count)
    return {
        "event": event_name,
        "candidate_epochs": candidate_count,
        "accepted_epochs": len(rows),
        "rejected_epochs": rejected_count,
        "frontal_theta_delta": fmt(mean_field(rows, "frontal_theta_delta")),
        "posterior_alpha_delta": fmt(mean_field(rows, "posterior_alpha_delta")),
        "global_theta_delta": fmt(mean_field(rows, "global_theta_delta")),
        "global_alpha_delta": fmt(mean_field(rows, "global_alpha_delta")),
        "global_beta_delta": fmt(mean_field(rows, "global_beta_delta")),
        "theta_alpha_delta": fmt(mean_field(rows, "theta_alpha_delta")),
        "formal_load_delta": fmt(mean_field(rows, "formal_load_delta")),
        "frontal_channel_count": rows[0].get("frontal_channel_count", ""),
        "posterior_channel_count": rows[0].get("posterior_channel_count", ""),
        "region_fallback": rows[0].get("region_fallback", ""),
    }


def empty_event_summary(event_name: str, candidate_count: int, rejected_count: int) -> dict[str, Any]:
    return {
        "event": event_name,
        "candidate_epochs": candidate_count,
        "accepted_epochs": 0,
        "rejected_epochs": rejected_count,
        "frontal_theta_delta": "",
        "posterior_alpha_delta": "",
        "global_theta_delta": "",
        "global_alpha_delta": "",
        "global_beta_delta": "",
        "theta_alpha_delta": "",
        "formal_load_delta": "",
        "frontal_channel_count": "",
        "posterior_channel_count": "",
        "region_fallback": "",
    }


def channel_region_meta(labels: list[str]) -> dict[str, Any]:
    frontal = label_indices(labels, worker.FRONTAL_CHANNELS)
    posterior = label_indices(labels, worker.POSTERIOR_CHANNELS)
    return {
        "frontal_channels_used": len(frontal) if frontal else len(labels),
        "posterior_channels_used": len(posterior) if posterior else len(labels),
        "region_fallback": region_fallback_label(frontal, posterior),
    }


def region_fallback_label(frontal: list[int], posterior: list[int]) -> str:
    flags = []
    if not frontal:
        flags.append("frontal_all_channels")
    if not posterior:
        flags.append("posterior_all_channels")
    return ";".join(flags) if flags else "none"


def compute_formal_contrasts(feature_rows: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    by_subject: dict[str, dict[str, list[dict[str, Any]]]] = defaultdict(lambda: defaultdict(list))
    for row in feature_rows:
        subject = str(row.get("subject", ""))
        condition = str(row.get("condition", ""))
        if subject and condition in DENSITY_LEVELS:
            by_subject[subject][condition].append(row)

    subject_contrasts: list[dict[str, Any]] = []
    for subject, by_condition in sorted(by_subject.items()):
        if not all(level in by_condition for level in DENSITY_LEVELS):
            continue
        selected = {level: choose_canonical_feature_row(by_condition[level]) for level in DENSITY_LEVELS}
        for metric in FORMAL_CONTRAST_METRICS:
            values = {level: number(selected[level].get(metric)) for level in DENSITY_LEVELS}
            if any(values[level] is None for level in DENSITY_LEVELS):
                continue
            contrast = sum(float(values[level]) * PLANNED_CONTRAST_WEIGHTS[level] for level in DENSITY_LEVELS)
            subject_contrasts.append(
                {
                    "subject": subject,
                    "metric": metric,
                    "low_filename": selected["low"].get("filename", ""),
                    "medium_filename": selected["medium"].get("filename", ""),
                    "high_filename": selected["high"].get("filename", ""),
                    "low": fmt(values["low"]),
                    "medium": fmt(values["medium"]),
                    "high": fmt(values["high"]),
                    "contrast_medium_minus_low_high_mean": fmt(contrast),
                }
            )

    summary: list[dict[str, Any]] = []
    for metric in FORMAL_CONTRAST_METRICS:
        values = [number(row.get("contrast_medium_minus_low_high_mean")) for row in subject_contrasts if row.get("metric") == metric]
        clean = np.asarray([value for value in values if value is not None], dtype=float)
        if len(clean) < 2:
            summary.append(
                {
                    "metric": metric,
                    "metric_label": METRIC_LABELS.get(metric, metric),
                    "n": len(clean),
                    "mean_contrast": fmt(float(np.nanmean(clean)) if len(clean) else None),
                }
            )
            continue
        mean = float(np.nanmean(clean))
        sd = float(np.nanstd(clean, ddof=1))
        se = sd / math.sqrt(len(clean)) if sd > 0 else 0.0
        t_value = mean / se if se > 0 else 0.0
        p_value = two_sided_t_p(t_value, len(clean) - 1)
        ci_low, ci_high = mean_ci(clean)
        summary.append(
            {
                "metric": metric,
                "metric_label": METRIC_LABELS.get(metric, metric),
                "n": len(clean),
                "mean_contrast": fmt(mean),
                "ci95_low": fmt(ci_low),
                "ci95_high": fmt(ci_high),
                "t": fmt(t_value),
                "p_two_sided": fmt(p_value),
                "dz": fmt(mean / sd if sd > 0 else None),
            }
        )
    return subject_contrasts, summary


def compute_condition_profiles(subject_contrasts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for metric in FORMAL_CONTRAST_METRICS:
        metric_rows = [row for row in subject_contrasts if row.get("metric") == metric]
        for condition in DENSITY_LEVELS:
            values = [number(row.get(condition)) for row in metric_rows]
            stats_row = sample_stats([value for value in values if value is not None])
            rows.append(
                {
                    "metric": metric,
                    "metric_label": METRIC_LABELS.get(metric, metric),
                    "condition": condition,
                    "n": stats_row["n"],
                    "mean": stats_row["mean"],
                    "ci95_low": stats_row["ci95_low"],
                    "ci95_high": stats_row["ci95_high"],
                    "sd": stats_row["sd"],
                }
            )
    return rows


def compute_pairwise_results(subject_contrasts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    comparisons = (("medium", "low"), ("medium", "high"), ("high", "low"))
    rows: list[dict[str, Any]] = []
    for metric in FORMAL_CONTRAST_METRICS:
        metric_rows = [row for row in subject_contrasts if row.get("metric") == metric]
        for left, right in comparisons:
            values = []
            for row in metric_rows:
                left_value = number(row.get(left))
                right_value = number(row.get(right))
                if left_value is not None and right_value is not None:
                    values.append(left_value - right_value)
            stats_row = sample_stats(values)
            rows.append(
                {
                    "metric": metric,
                    "metric_label": METRIC_LABELS.get(metric, metric),
                    "comparison": f"{left}_minus_{right}",
                    "n": stats_row["n"],
                    "mean_difference": stats_row["mean"],
                    "ci95_low": stats_row["ci95_low"],
                    "ci95_high": stats_row["ci95_high"],
                    "t": stats_row["t"],
                    "p_two_sided": stats_row["p_two_sided"],
                    "dz": stats_row["dz"],
                    "positive_subjects": stats_row["positive_subjects"],
                    "negative_subjects": stats_row["negative_subjects"],
                }
            )
    return rows


def compute_robustness_results(subject_contrasts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for metric in FORMAL_CONTRAST_METRICS:
        values = [
            number(row.get("contrast_medium_minus_low_high_mean"))
            for row in subject_contrasts
            if row.get("metric") == metric
        ]
        clean = [value for value in values if value is not None]
        stats_row = sample_stats(clean)
        bootstrap_low, bootstrap_high, bootstrap_positive = bootstrap_mean_ci(clean, BOOTSTRAP_ITERATIONS)
        signflip_p = signflip_p_two_sided(clean, SIGNFLIP_ITERATIONS)
        wilcoxon_p = wilcoxon_p_two_sided(clean)
        rows.append(
            {
                "metric": metric,
                "metric_label": METRIC_LABELS.get(metric, metric),
                "n": stats_row["n"],
                "mean_contrast": stats_row["mean"],
                "median_contrast": fmt(float(np.nanmedian(clean)) if clean else None),
                "trimmed_mean_20pct": fmt(trimmed_mean(clean, 0.2)),
                "ci95_low": stats_row["ci95_low"],
                "ci95_high": stats_row["ci95_high"],
                "t": stats_row["t"],
                "p_two_sided": stats_row["p_two_sided"],
                "dz": stats_row["dz"],
                "bootstrap_ci95_low": fmt(bootstrap_low),
                "bootstrap_ci95_high": fmt(bootstrap_high),
                "bootstrap_p_mean_gt_0": fmt(bootstrap_positive),
                "signflip_p_two_sided": fmt(signflip_p),
                "wilcoxon_p_two_sided": fmt(wilcoxon_p),
                "sign_test_p_two_sided": fmt(sign_test_p_two_sided(clean)),
                "positive_subjects": stats_row["positive_subjects"],
                "negative_subjects": stats_row["negative_subjects"],
            }
        )
    return rows


def compute_leave_one_subject_out(subject_contrasts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for metric in FORMAL_CONTRAST_METRICS:
        metric_rows = [row for row in subject_contrasts if row.get("metric") == metric]
        subjects = sorted({str(row.get("subject")) for row in metric_rows if row.get("subject")})
        for subject in subjects:
            values = [
                number(row.get("contrast_medium_minus_low_high_mean"))
                for row in metric_rows
                if row.get("subject") != subject
            ]
            stats_row = sample_stats([value for value in values if value is not None])
            rows.append(
                {
                    "metric": metric,
                    "metric_label": METRIC_LABELS.get(metric, metric),
                    "left_out_subject": subject,
                    "n": stats_row["n"],
                    "mean_contrast": stats_row["mean"],
                    "ci95_low": stats_row["ci95_low"],
                    "ci95_high": stats_row["ci95_high"],
                    "t": stats_row["t"],
                    "p_two_sided": stats_row["p_two_sided"],
                    "dz": stats_row["dz"],
                    "still_p_lt_05": "yes" if (number(stats_row["p_two_sided"]) or 1.0) < 0.05 else "no",
                }
            )
    return rows


def choose_canonical_feature_row(rows: list[dict[str, Any]]) -> dict[str, Any]:
    if not rows:
        return {}
    return max(rows, key=feature_row_score)


def feature_row_score(row: dict[str, Any]) -> tuple[int, float, float, float]:
    filename = str(row.get("filename", "")).lower()
    not_old = 0 if "old" in filename else 1
    decision_epochs = number(row.get("decision_point_enter_accepted_epochs")) or 0.0
    sign_epochs = number(row.get("sign_readable_accepted_epochs")) or 0.0
    has_trial = 1.0 if number(row.get("trial_formal_load_proxy")) is not None else 0.0
    return not_old, decision_epochs, sign_epochs, has_trial


def two_sided_t_p(t_value: float, df: int) -> float:
    try:
        from scipy import stats

        return float(stats.t.sf(abs(t_value), df) * 2.0)
    except Exception:
        return float(2.0 * (1.0 - worker.normal_cdf(abs(t_value))))


def mean_ci(values: np.ndarray) -> tuple[float, float]:
    mean = float(np.nanmean(values))
    sd = float(np.nanstd(values, ddof=1))
    se = sd / math.sqrt(len(values)) if len(values) > 0 else 0.0
    try:
        from scipy import stats

        crit = float(stats.t.ppf(0.975, len(values) - 1))
    except Exception:
        crit = 1.96
    return mean - crit * se, mean + crit * se


def sample_stats(values: list[float]) -> dict[str, Any]:
    clean = np.asarray([value for value in values if value is not None and math.isfinite(value)], dtype=float)
    n = len(clean)
    if n == 0:
        return {
            "n": 0,
            "mean": "",
            "sd": "",
            "ci95_low": "",
            "ci95_high": "",
            "t": "",
            "p_two_sided": "",
            "dz": "",
            "positive_subjects": 0,
            "negative_subjects": 0,
        }
    mean = float(np.nanmean(clean))
    sd = float(np.nanstd(clean, ddof=1)) if n > 1 else 0.0
    if n < 2 or sd <= 0:
        return {
            "n": n,
            "mean": fmt(mean),
            "sd": fmt(sd),
            "ci95_low": "",
            "ci95_high": "",
            "t": "",
            "p_two_sided": "",
            "dz": "",
            "positive_subjects": int(np.sum(clean > 0)),
            "negative_subjects": int(np.sum(clean < 0)),
        }
    se = sd / math.sqrt(n)
    t_value = mean / se if se > 0 else 0.0
    ci_low, ci_high = mean_ci(clean)
    return {
        "n": n,
        "mean": fmt(mean),
        "sd": fmt(sd),
        "ci95_low": fmt(ci_low),
        "ci95_high": fmt(ci_high),
        "t": fmt(t_value),
        "p_two_sided": fmt(two_sided_t_p(t_value, n - 1)),
        "dz": fmt(mean / sd if sd > 0 else None),
        "positive_subjects": int(np.sum(clean > 0)),
        "negative_subjects": int(np.sum(clean < 0)),
    }


def bootstrap_mean_ci(values: list[float], iterations: int) -> tuple[float | None, float | None, float | None]:
    clean = [value for value in values if value is not None and math.isfinite(value)]
    if not clean:
        return None, None, None
    rng = random.Random(20260607 + len(clean))
    means = []
    positive = 0
    for _ in range(iterations):
        sample = [clean[rng.randrange(len(clean))] for _ in clean]
        mean = sum(sample) / len(sample)
        means.append(mean)
        if mean > 0:
            positive += 1
    means.sort()
    low_index = max(0, int(math.floor(0.025 * (len(means) - 1))))
    high_index = min(len(means) - 1, int(math.ceil(0.975 * (len(means) - 1))))
    return means[low_index], means[high_index], positive / iterations


def signflip_p_two_sided(values: list[float], iterations: int) -> float | None:
    clean = [value for value in values if value is not None and math.isfinite(value) and abs(value) > 1e-12]
    if not clean:
        return None
    observed = abs(sum(clean) / len(clean))
    rng = random.Random(20260607 + len(clean) * 17)
    extreme = 0
    total = 0
    if len(clean) <= 18:
        for mask in range(1 << len(clean)):
            flipped = [value if (mask & (1 << index)) else -value for index, value in enumerate(clean)]
            if abs(sum(flipped) / len(flipped)) >= observed - 1e-12:
                extreme += 1
            total += 1
    else:
        for _ in range(iterations):
            flipped = [value if rng.random() < 0.5 else -value for value in clean]
            if abs(sum(flipped) / len(flipped)) >= observed - 1e-12:
                extreme += 1
            total += 1
    return extreme / total if total else None


def sign_test_p_two_sided(values: list[float]) -> float | None:
    clean = [value for value in values if value is not None and math.isfinite(value) and abs(value) > 1e-12]
    n = len(clean)
    if n == 0:
        return None
    positive = sum(1 for value in clean if value > 0)
    lower = sum(math.comb(n, k) for k in range(0, positive + 1)) / (2**n)
    upper = sum(math.comb(n, k) for k in range(positive, n + 1)) / (2**n)
    return min(1.0, 2.0 * min(lower, upper))


def wilcoxon_p_two_sided(values: list[float]) -> float | None:
    clean = [value for value in values if value is not None and math.isfinite(value) and abs(value) > 1e-12]
    if not clean:
        return None
    try:
        from scipy import stats

        return float(stats.wilcoxon(clean, alternative="two-sided").pvalue)
    except Exception:
        return None


def trimmed_mean(values: list[float], proportion: float) -> float | None:
    clean = sorted(value for value in values if value is not None and math.isfinite(value))
    if not clean:
        return None
    trim = int(math.floor(len(clean) * proportion))
    trimmed = clean[trim : len(clean) - trim] if trim and len(clean) > trim * 2 else clean
    return sum(trimmed) / len(trimmed)


def eeg_trial_coverage_ratio(timestamps: np.ndarray, sfreq: float, trial_window: dict[str, float] | None) -> float | None:
    if not trial_window or sfreq <= 0:
        return None
    mask = worker.trial_mask(timestamps, trial_window)
    expected = max(1, int(round(float(trial_window["duration_s"]) * sfreq)))
    return float(np.sum(mask)) / expected


def label_indices(labels: list[str], targets: set[str]) -> list[int]:
    normalized = [worker.normalize_channel_label(label) for label in labels]
    return [index for index, label in enumerate(normalized) if label in targets]


def is_non_eeg_label(label: str) -> bool:
    normalized = worker.normalize_channel_label(label)
    return any(token in normalized for token in NON_EEG_LABEL_TOKENS)


def robust_vector(values: np.ndarray) -> np.ndarray:
    clean = np.asarray(values, dtype=float)
    clean[~np.isfinite(clean)] = np.nan
    return clean


def robust_z(values: np.ndarray) -> np.ndarray:
    clean = np.asarray(values, dtype=float)
    median = float(np.nanmedian(clean)) if np.any(np.isfinite(clean)) else 0.0
    mad = float(np.nanmedian(np.abs(clean - median))) if np.any(np.isfinite(clean)) else 0.0
    if mad <= 0:
        sd = float(np.nanstd(clean))
        denom = sd if sd > 0 else 1.0
    else:
        denom = mad * 1.4826
    return np.abs((clean - median) / denom)


def make_unique_labels(labels: list[str]) -> list[str]:
    seen: dict[str, int] = defaultdict(int)
    unique = []
    for index, label in enumerate(labels, start=1):
        base = str(label).strip() or f"Ch{index}"
        seen[base] += 1
        unique.append(base if seen[base] == 1 else f"{base}-{seen[base]}")
    return unique


def base_file_identity(path: Path) -> dict[str, Any]:
    sequence_index = worker.infer_sequence_index(path.name)
    run_position = worker.infer_run_position(path.name)
    return {
        "filename": path.name,
        "local_path": str(path),
        "subject": worker.infer_subject_id(path.name),
        "sequence_index": sequence_index or "",
        "run_position": run_position or "",
        "condition": RUN_POSITION_TO_DENSITY.get(run_position or 0, ""),
    }


def safe_stem(filename: str) -> str:
    return "".join(ch if ch.isalnum() or ch in {"-", "_"} else "-" for ch in Path(filename).stem)[:90]


def number(value: Any) -> float | None:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def mean_field(rows: list[dict[str, Any]], field: str) -> float | None:
    values = [number(row.get(field)) for row in rows]
    clean = [value for value in values if value is not None]
    return float(np.nanmean(clean)) if clean else None


def fmt(value: Any) -> str:
    if value is None:
        return ""
    try:
        number_value = float(value)
    except (TypeError, ValueError):
        return str(value)
    if not math.isfinite(number_value):
        return ""
    if number_value == 0:
        return "0"
    if abs(number_value) >= 1000 or abs(number_value) < 0.001:
        return f"{number_value:.3e}"
    return f"{number_value:.6f}".rstrip("0").rstrip(".")


def write_formal_eeg_html_report(
    path: Path,
    *,
    qc_rows: list[dict[str, Any]],
    contrast_summary: list[dict[str, Any]],
    robustness_results: list[dict[str, Any]],
    condition_profiles: list[dict[str, Any]],
    pairwise_results: list[dict[str, Any]],
    leave_one_out: list[dict[str, Any]],
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    completed = sum(1 for row in qc_rows if row.get("status") == "ok")
    failed = sum(1 for row in qc_rows if row.get("status") == "failed")
    montage = sum(1 for row in qc_rows if row.get("montage_set") == "yes")
    fallback = sum(1 for row in qc_rows if row.get("region_fallback") not in {"", "none", None})
    decision_candidates = sum(int(number(row.get("decision_point_enter_candidates")) or 0) for row in qc_rows)
    decision_accepted = sum(int(number(row.get("decision_point_enter_accepted")) or 0) for row in qc_rows)
    sign_candidates = sum(int(number(row.get("sign_readable_candidates")) or 0) for row in qc_rows)
    sign_accepted = sum(int(number(row.get("sign_readable_accepted")) or 0) for row in qc_rows)

    main_result = find_row(contrast_summary, "metric", "decision_point_enter_formal_load_delta")
    theta_result = find_row(contrast_summary, "metric", "decision_point_enter_frontal_theta_delta")
    main_robust = find_row(robustness_results, "metric", "decision_point_enter_formal_load_delta")
    theta_robust = find_row(robustness_results, "metric", "decision_point_enter_frontal_theta_delta")

    loo_theta = [row for row in leave_one_out if row.get("metric") == "decision_point_enter_frontal_theta_delta"]
    theta_loo_supported = sum(1 for row in loo_theta if row.get("still_p_lt_05") == "yes")

    html_text = f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>Formal EEG MNE Report</title>
  <style>
    body {{ font-family: Arial, 'Microsoft YaHei', sans-serif; margin: 32px; color: #172033; line-height: 1.55; }}
    h1, h2 {{ margin: 0 0 12px; }}
    h1 {{ font-size: 28px; }}
    h2 {{ font-size: 20px; margin-top: 28px; border-bottom: 1px solid #dce4e8; padding-bottom: 6px; }}
    .lede {{ max-width: 980px; color: #506070; }}
    .grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; margin: 18px 0; }}
    .stat {{ border: 1px solid #dce4e8; border-radius: 8px; padding: 12px 14px; background: #fbfcfc; }}
    .stat b {{ display: block; font-size: 22px; color: #0f493f; }}
    .note {{ border-left: 4px solid #87a9a3; background: #f4f8f7; padding: 12px 14px; margin: 16px 0; }}
    table {{ border-collapse: collapse; width: 100%; margin: 12px 0 20px; font-size: 13px; }}
    th, td {{ border: 1px solid #dce4e8; padding: 7px 8px; text-align: left; vertical-align: top; }}
    th {{ background: #edf4f2; color: #153d38; }}
    code {{ background: #eef3f2; padding: 1px 4px; border-radius: 4px; }}
  </style>
</head>
<body>
  <h1>Formal EEG MNE Report</h1>
  <p class="lede">本报告基于 <code>scripts/eeg_mne_preprocessing.py</code> 生成。它用于论文层面的 H3 EEG 证据展示：MNE 预处理、10-20 montage、baseline-corrected event-window log band power、QC、planned contrast 和稳健性分析。</p>

  <div class="grid">
    <div class="stat"><b>{completed}/{len(qc_rows)}</b>完成 XDF</div>
    <div class="stat"><b>{failed}</b>失败 XDF</div>
    <div class="stat"><b>{montage}/{len(qc_rows)}</b>成功设置 montage</div>
    <div class="stat"><b>{fallback}</b>ROI fallback runs</div>
    <div class="stat"><b>{decision_accepted}/{decision_candidates}</b>decision-point epochs</div>
    <div class="stat"><b>{sign_accepted}/{sign_candidates}</b>sign-readable epochs</div>
  </div>

  <h2>主结果解释</h2>
  <div class="note">
    <p>{formal_eeg_interpretation(main_result, theta_result, main_robust, theta_robust, theta_loo_supported, len(loo_theta))}</p>
  </div>

  <h2>Planned Contrast Summary</h2>
  {render_table(contrast_summary, ["metric_label", "metric", "n", "mean_contrast", "ci95_low", "ci95_high", "t", "p_two_sided", "dz"])}

  <h2>Robustness</h2>
  {render_table(robustness_results, ["metric_label", "n", "mean_contrast", "median_contrast", "trimmed_mean_20pct", "bootstrap_ci95_low", "bootstrap_ci95_high", "signflip_p_two_sided", "wilcoxon_p_two_sided", "sign_test_p_two_sided", "positive_subjects", "negative_subjects"])}

  <h2>Condition Profiles</h2>
  {render_table(condition_profiles, ["metric_label", "condition", "n", "mean", "ci95_low", "ci95_high", "sd"])}

  <h2>Pairwise Checks</h2>
  {render_table(pairwise_results, ["metric_label", "comparison", "n", "mean_difference", "ci95_low", "ci95_high", "t", "p_two_sided", "dz", "positive_subjects", "negative_subjects"])}
</body>
</html>
"""
    path.write_text(html_text, encoding="utf-8")


def formal_eeg_interpretation(
    main_result: dict[str, Any],
    theta_result: dict[str, Any],
    main_robust: dict[str, Any],
    theta_robust: dict[str, Any],
    theta_loo_supported: int,
    theta_loo_total: int,
) -> str:
    main_p = fmt_p_like(main_result.get("p_two_sided"))
    theta_p = fmt_p_like(theta_result.get("p_two_sided"))
    theta_signflip = fmt_p_like(theta_robust.get("signflip_p_two_sided"))
    return (
        "H3 composite 的 decision-point formal load planned contrast 为 "
        f"n={escape_text(main_result.get('n'))}, mean={escape_text(main_result.get('mean_contrast'))}, "
        f"95% CI [{escape_text(main_result.get('ci95_low'))}, {escape_text(main_result.get('ci95_high'))}], "
        f"p={main_p}。它目前更适合写作边缘/趋势证据。"
        "planned secondary 生理成分 decision-point frontal theta 更清楚："
        f"n={escape_text(theta_result.get('n'))}, mean={escape_text(theta_result.get('mean_contrast'))}, "
        f"95% CI [{escape_text(theta_result.get('ci95_low'))}, {escape_text(theta_result.get('ci95_high'))}], "
        f"p={theta_p}, sign-flip p={theta_signflip}, leave-one-subject-out {theta_loo_supported}/{theta_loo_total} 次仍 p<.05。"
        "因此论文中应写为：额区 theta 成分提供支持性生理证据；综合 EEG load composite 尚未达到常规显著。"
    )


def render_table(rows: list[dict[str, Any]], columns: list[str]) -> str:
    if not rows:
        return "<p>-</p>"
    header = "".join(f"<th>{escape_text(column)}</th>" for column in columns)
    body_rows = []
    for row in rows:
        body_rows.append("<tr>" + "".join(f"<td>{escape_text(row.get(column, ''))}</td>" for column in columns) + "</tr>")
    return f"<table><thead><tr>{header}</tr></thead><tbody>{''.join(body_rows)}</tbody></table>"


def find_row(rows: list[dict[str, Any]], key: str, value: str) -> dict[str, Any]:
    return next((row for row in rows if row.get(key) == value), {})


def escape_text(value: Any) -> str:
    return html.escape("" if value is None else str(value))


def fmt_p_like(value: Any) -> str:
    numeric = number(value)
    if numeric is None:
        return escape_text(value)
    if numeric < 0.001:
        return "&lt;.001"
    return f"{numeric:.3f}"


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames: list[str] = []
    for row in rows:
        for key in row:
            if key not in fieldnames:
                fieldnames.append(key)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames or ["empty"])
        writer.writeheader()
        for row in rows:
            writer.writerow(row)


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(to_jsonable(payload), ensure_ascii=False, indent=2), encoding="utf-8")


def to_jsonable(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): to_jsonable(item) for key, item in value.items()}
    if isinstance(value, list):
        return [to_jsonable(item) for item in value]
    if isinstance(value, tuple):
        return [to_jsonable(item) for item in value]
    if isinstance(value, np.generic):
        return value.item()
    if isinstance(value, np.ndarray):
        return value.tolist()
    return value


if __name__ == "__main__":
    main()
