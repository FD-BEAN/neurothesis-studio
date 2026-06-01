#!/usr/bin/env python
"""XDF-focused analysis worker for NeuroThesis Studio.

This worker is designed for LabRecorder files that contain a Mitsar/EEG stream
and a Unity LSL marker stream such as MetroRescueMarkers. It runs in GitHub
Actions, downloads one private Supabase Storage object, extracts deterministic
QC and feature summaries, and writes a JSON report to research_analysis_jobs.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import tempfile
import traceback
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote

import numpy as np
import requests


BUCKET = "research-files"
START_EVENTS = ("map_start", "trial_start", "session_start")
END_EVENT = "evacuation_complete"
FRONTAL_CHANNELS = {"fz", "f3", "f4", "fc1", "fc2"}
POSTERIOR_CHANNELS = {"pz", "p3", "p4", "o1", "o2", "oz"}
EVENT_WINDOWS = {
    "sign_readable": 2.0,
    "decision_point_enter": 4.0,
    "audio_play": 2.0,
}
BEHAVIOR_EVENTS = [
    "audio_play",
    "sign_visible_enter",
    "sign_readable",
    "decision_point_enter",
    "decision_look_left",
    "decision_look_right",
    "decision_scan_both_sides",
    "dwell_detected",
    "u_turn_detected",
    "route_backtrack_detected",
]


class SupabaseRest:
    def __init__(self, url: str, service_role_key: str):
        self.url = url.rstrip("/")
        self.headers = {
            "apikey": service_role_key,
            "Authorization": f"Bearer {service_role_key}",
            "Content-Type": "application/json",
        }

    def select_one(self, table: str, query: str) -> dict[str, Any]:
        response = requests.get(
            f"{self.url}/rest/v1/{table}?{query}",
            headers={**self.headers, "Accept": "application/json"},
            timeout=30,
        )
        response.raise_for_status()
        rows = response.json()
        if not rows:
            raise RuntimeError(f"No row found in {table}: {query}")
        return rows[0]

    def update_job(self, job_id: str, payload: dict[str, Any]) -> None:
        response = requests.patch(
            f"{self.url}/rest/v1/research_analysis_jobs?id=eq.{job_id}",
            headers={**self.headers, "Prefer": "return=minimal"},
            data=json.dumps(to_jsonable(payload), ensure_ascii=False),
            timeout=30,
        )
        response.raise_for_status()

    def download_storage_object(self, storage_path: str, destination: Path) -> None:
        encoded_path = quote(storage_path, safe="/")
        response = requests.get(
            f"{self.url}/storage/v1/object/{BUCKET}/{encoded_path}",
            headers=self.headers,
            timeout=180,
        )
        response.raise_for_status()
        destination.write_bytes(response.content)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--job-id", required=True)
    args = parser.parse_args()

    supabase_url = os.environ.get("SUPABASE_URL")
    service_role_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    run_url = os.environ.get("GITHUB_RUN_URL", "")

    if not supabase_url or not service_role_key:
        raise SystemExit("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.")

    client = SupabaseRest(supabase_url, service_role_key)

    try:
        run_job(client, args.job_id, run_url)
    except Exception as exc:  # pragma: no cover - worker safety net
        client.update_job(
            args.job_id,
            {
                "status": "failed",
                "status_message": "XDF Python worker 运行失败。",
                "error_message": f"{exc}\n\n{traceback.format_exc()}",
                "completed_at": now_sql(),
                "github_run_url": run_url,
            },
        )
        raise


def run_job(client: SupabaseRest, job_id: str, run_url: str) -> None:
    client.update_job(
        job_id,
        {
            "status": "running",
            "status_message": "XDF worker 正在下载文件并解析 EEG + Unity marker stream。",
            "github_run_url": run_url,
        },
    )

    job = client.select_one("research_analysis_jobs", f"id=eq.{job_id}&select=*")
    document = client.select_one("research_documents", f"id=eq.{job['document_id']}&select=*")
    extension = get_extension(document["filename"])

    if extension != "xdf":
        raise RuntimeError("XDF 高级分析当前只面向 LabRecorder .xdf 文件。PDF/CSV 可用即时摘要，不进入 EEG+Unity marker 分析流水线。")

    with tempfile.TemporaryDirectory() as tmp_dir:
        local_file = Path(tmp_dir) / "input.xdf"
        client.download_storage_object(document["storage_path"], local_file)
        report = analyze_xdf(document, local_file)

    client.update_job(
        job_id,
        {
            "status": "completed",
            "status_message": "XDF EEG + Unity marker 分析完成。",
            "result_json": report,
            "error_message": None,
            "completed_at": now_sql(),
            "github_run_url": run_url,
        },
    )


def analyze_xdf(document: dict[str, Any], path: Path) -> dict[str, Any]:
    import pyxdf

    streams, _header = pyxdf.load_xdf(str(path), dejitter_timestamps=True, verbose=False)
    marker_streams = [stream for stream in streams if is_marker_stream(stream)]
    eeg_streams = [stream for stream in streams if is_eeg_stream(stream)]
    marker_stream = choose_marker_stream(marker_streams)
    eeg_stream = choose_eeg_stream(eeg_streams)

    stream_table = build_stream_table(streams, selected_marker=marker_stream, selected_eeg=eeg_stream)
    charts = [build_stream_duration_chart(streams)]
    tables = [stream_table]
    notes: list[str] = []

    if not marker_stream:
        notes.append("未发现 MetroRescueMarkers 或 marker stream，无法进行 Unity 事件对齐。")
    if not eeg_stream:
        notes.append("未发现 Mitsar/EEG stream，无法计算脑电质控和频带特征。")
    if len(eeg_streams) > 1 and eeg_stream:
        notes.append("检测到多个 EEG/Mitsar stream；报告已按最长且最像 EEG 的 stream 作为主分析对象，正式预处理前仍建议人工确认。")

    marker_rows = parse_marker_stream(marker_stream) if marker_stream else []
    sessions = summarize_sessions(marker_rows)
    primary_rows = select_primary_session(marker_rows)
    trial_window = get_trial_window(primary_rows)
    event_counts = Counter(row.get("event", "<no_event>") for row in marker_rows)

    if marker_rows:
        charts.append(build_event_count_chart(event_counts))
        tables.append(build_session_table(sessions))
    if primary_rows:
        tables.append(build_behavior_table(primary_rows, trial_window))
        primary_events = {row.get("event", "") for row in primary_rows}
        if not set(START_EVENTS) & primary_events:
            notes.append("主 trial 缺少 map_start / trial_start / session_start，报告只能用该 session 的第一条 marker 估计开始时间。")
        if END_EVENT not in primary_events:
            notes.append("主 trial 缺少 evacuation_complete，报告只能用该 session 的最后一条 marker 估计结束时间。")
    else:
        notes.append("未能从 marker 中选出可分析 trial；需要检查 subject/session/map/signage/audio 字段和开始/完成事件。")

    eeg_report = analyze_eeg_stream(eeg_stream, primary_rows, trial_window) if eeg_stream else empty_eeg_report()
    charts.extend(eeg_report["charts"])
    tables.extend(eeg_report["tables"])
    notes.extend(eeg_report["notes"])

    valid_event_epochs = eeg_report["metrics"].get("valid_event_epochs", 0)
    session_label = format_session_label(primary_rows[0]) if primary_rows else "-"
    trial_duration = trial_window["duration_s"] if trial_window else None

    summary = (
        "报告围绕 LabRecorder XDF 中的 EEG stream 与 Unity marker stream 展开："
        "先检查 stream/session/trial 完整性，再提取 trial-level 行为事件、EEG 覆盖情况、通道质控、"
        "theta/alpha/beta 频带摘要，以及 sign_readable 和 decision_point_enter 的事件锁定特征。"
    )

    if not notes:
        notes.append("当前输出是 QC 与特征提取报告，不直接给出显著性结论；正式论文结果需要多被试 trial_features/event_features 后再做混合效应模型和 planned contrast。")

    return {
        "title": f"{document['filename']} XDF EEG + Unity marker 分析",
        "kind": "XDF EEG+Marker",
        "summary": summary,
        "metrics": [
            {"label": "stream 数", "value": str(len(streams))},
            {"label": "marker 数", "value": str(len(marker_rows))},
            {"label": "主 trial", "value": session_label},
            {"label": "trial 时长", "value": fmt_seconds(trial_duration)},
            {"label": "EEG stream", "value": str(len(eeg_streams))},
            {"label": "有效事件窗", "value": str(valid_event_epochs)},
        ],
        "charts": [chart for chart in charts if chart and chart["data"]][:6],
        "tables": tables[:10],
        "notes": notes[:12],
    }


def build_stream_table(streams: list[dict[str, Any]], selected_marker: dict[str, Any] | None, selected_eeg: dict[str, Any] | None) -> dict[str, Any]:
    rows = []
    for index, stream in enumerate(streams, start=1):
        info = stream.get("info", {})
        timestamps = np.asarray(stream.get("time_stamps", []), dtype=float)
        samples = len(timestamps)
        duration = stream_duration(stream)
        name = str(meta_value(info, "name", ""))
        stream_type = str(meta_value(info, "type", ""))
        srate = to_float(meta_value(info, "nominal_srate", 0)) or 0
        channels = int(to_float(meta_value(info, "channel_count", 0)) or 0)
        role = []
        if stream is selected_marker:
            role.append("selected marker")
        if stream is selected_eeg:
            role.append("selected EEG")
        rows.append([str(index), name, stream_type, fmt(srate), str(channels), str(samples), fmt(duration), ", ".join(role) or "-"])

    return {
        "title": "XDF stream 概览",
        "columns": ["#", "name", "type", "srate", "channels", "samples", "duration_s", "role"],
        "rows": rows,
    }


def build_stream_duration_chart(streams: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "type": "bar",
        "title": "stream 时长",
        "xLabel": "stream",
        "yLabel": "seconds",
        "data": [
            {"label": f"{stream_name(stream) or 'stream'} ({index + 1})", "value": round(stream_duration(stream), 3)}
            for index, stream in enumerate(streams)
        ],
    }


def build_event_count_chart(event_counts: Counter[str]) -> dict[str, Any]:
    return {
        "type": "bar",
        "title": "Unity marker 事件计数",
        "xLabel": "event",
        "yLabel": "markers",
        "data": [{"label": label, "value": int(value)} for label, value in event_counts.most_common(18)],
    }


def summarize_sessions(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[tuple[str, str, str, str, str], list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        grouped[session_key(row)].append(row)

    sessions = []
    for key, items in grouped.items():
        sorted_items = sorted(items, key=lambda item: item["_xdf_ts"])
        events = {item.get("event", "") for item in sorted_items}
        window = get_trial_window(sorted_items)
        sessions.append(
            {
                "key": key,
                "items": sorted_items,
                "count": len(sorted_items),
                "has_start": bool(set(START_EVENTS) & events),
                "has_complete": END_EVENT in events,
                "duration_s": window["duration_s"] if window else None,
                "first_event": sorted_items[0].get("event", "-") if sorted_items else "-",
                "last_event": sorted_items[-1].get("event", "-") if sorted_items else "-",
            }
        )
    return sorted(sessions, key=lambda session: session_score(session), reverse=True)


def build_session_table(sessions: list[dict[str, Any]]) -> dict[str, Any]:
    rows = []
    for session in sessions[:12]:
        subject, session_id, metro, signature, audio = session["key"]
        rows.append(
            [
                subject or "-",
                session_id or "-",
                metro or "-",
                signature or "-",
                audio or "-",
                str(session["count"]),
                "yes" if session["has_start"] else "no",
                "yes" if session["has_complete"] else "no",
                fmt_seconds(session["duration_s"]),
                str(session["first_event"]),
                str(session["last_event"]),
            ]
        )
    return {
        "title": "marker session/trial 切分",
        "columns": ["subject", "session", "map", "signature", "audio", "markers", "start", "complete", "duration", "first", "last"],
        "rows": rows,
    }


def build_behavior_table(rows: list[dict[str, Any]], window: dict[str, float] | None) -> dict[str, Any]:
    counts = Counter(row.get("event", "") for row in rows)
    completion = find_first_event(rows, (END_EVENT,))
    behavior_load_proxy = (
        counts.get("dwell_detected", 0)
        + counts.get("u_turn_detected", 0)
        + counts.get("route_backtrack_detected", 0)
        + counts.get("decision_scan_both_sides", 0)
    )
    duration_minutes = (window["duration_s"] / 60.0) if window and window.get("duration_s") else None
    behavior_load_rate = behavior_load_proxy / duration_minutes if duration_minutes else None
    metrics = [
        ["trial_duration_s", fmt(window["duration_s"]) if window else "-"],
        ["exit_label", completion.get("exit", "") if completion else "-"],
        ["horizontal_distance_m", fmt(to_float(completion.get("horizontal_distance_m"))) if completion else "-"],
        ["time_to_first_sign_readable_s", fmt(first_event_latency(rows, "sign_readable", window))],
        ["time_to_first_decision_s", fmt(first_event_latency(rows, "decision_point_enter", window))],
        ["sign_readable_latency_from_visible_s", fmt(mean_sign_readable_latency(rows))],
        ["behavior_load_proxy", str(behavior_load_proxy)],
        ["behavior_load_proxy_per_min", fmt(behavior_load_rate)],
    ]
    metrics.extend([[event, str(counts.get(event, 0))] for event in BEHAVIOR_EVENTS])

    return {
        "title": "trial-level Unity 行为 marker 指标",
        "columns": ["metric", "value"],
        "rows": metrics,
    }


def analyze_eeg_stream(stream: dict[str, Any], rows: list[dict[str, Any]], window: dict[str, float] | None) -> dict[str, Any]:
    notes: list[str] = []
    charts: list[dict[str, Any]] = []
    tables: list[dict[str, Any]] = []

    timestamps = np.asarray(stream.get("time_stamps", []), dtype=float)
    data = ensure_2d_numeric(stream.get("time_series", []), len(timestamps))
    labels = extract_channel_labels(stream.get("info", {}), data.shape[1] if data.size else 0)
    fs = effective_sampling_rate(stream, timestamps)

    if data.size == 0 or len(timestamps) < 2:
        return {
            "metrics": {"valid_event_epochs": 0},
            "charts": [],
            "tables": [],
            "notes": ["EEG stream 没有可用 sample，无法计算通道质控或频带特征。"],
        }

    data, timestamps = align_data_and_timestamps(data, timestamps)
    mask = trial_mask(timestamps, window)
    trial_data = data[mask]
    trial_timestamps = timestamps[mask]
    if len(trial_data) < max(32, int(fs) if fs else 32):
        notes.append("trial window 内 EEG sample 太少；频带特征改用整个 EEG stream 的可用片段估算。")
        trial_data = data
        trial_timestamps = timestamps

    channel_qc = channel_quality(trial_data, labels)
    signal_indices = [row["index"] for row in channel_qc if not row["exclude"]]
    if not signal_indices:
        signal_indices = list(range(trial_data.shape[1]))
        notes.append("未找到稳定的 EEG 信号通道集合；频带特征临时使用全部通道。")

    excluded_event_channels = [row["label"] for row in channel_qc if "event" in row["label"].lower()]
    if excluded_event_channels:
        notes.append(f"已将疑似 event 通道排除出 EEG 频带计算：{', '.join(excluded_event_channels[:4])}。")

    coverage_rows, coverage_notes = eeg_coverage_rows(timestamps, trial_timestamps, fs, window)
    notes.extend(coverage_notes)
    tables.append(
        {
            "title": "EEG 覆盖与采样 QC",
            "columns": ["metric", "value"],
            "rows": coverage_rows,
        }
    )

    tables.append(
        {
            "title": "EEG 通道质量候选",
            "columns": ["channel", "std", "ptp", "missing_pct", "flag"],
            "rows": [
                [row["label"], fmt(row["std"]), fmt(row["ptp"]), fmt(row["missing_pct"]), row["flag"]]
                for row in channel_qc[:24]
            ],
        }
    )

    band_report = compute_band_report(trial_data[:, signal_indices], [labels[i] for i in signal_indices], fs)
    if band_report:
        tables.append(band_report["table"])
        charts.append(band_report["chart"])
        notes.extend(band_report["notes"])
    else:
        notes.append("EEG 数据长度不足或采样率不可用，暂未计算 Welch 频带功率。")

    event_report = compute_event_locked_report(data[:, signal_indices], timestamps, [labels[i] for i in signal_indices], fs, rows)
    if event_report:
        tables.append(event_report["table"])
        charts.append(event_report["chart"])
        valid_event_epochs = event_report["valid_event_epochs"]
    else:
        valid_event_epochs = 0
        notes.append("未生成有效事件窗；需要确认 sign_readable / decision_point_enter marker 是否落在 EEG 时间范围内。")

    return {
        "metrics": {"valid_event_epochs": valid_event_epochs},
        "charts": charts,
        "tables": tables,
        "notes": notes,
    }


def compute_band_report(data: np.ndarray, labels: list[str], fs: float) -> dict[str, Any] | None:
    powers = band_powers(data, fs)
    if not powers:
        return None

    frontal_indices = label_indices(labels, FRONTAL_CHANNELS)
    posterior_indices = label_indices(labels, POSTERIOR_CHANNELS)
    notes = []
    if not frontal_indices:
        frontal_indices = list(range(data.shape[1]))
        notes.append("未识别到 Fz/F3/F4/Fc1/Fc2 等额区标签；frontal theta 暂用全通道均值。")
    if not posterior_indices:
        posterior_indices = list(range(data.shape[1]))
        notes.append("未识别到 Pz/P3/P4/O1/O2/Oz 等后部标签；posterior alpha 暂用全通道均值。")

    theta = powers["theta"]
    alpha = powers["alpha"]
    beta = powers["beta"]
    frontal_theta = float(np.nanmean(theta[frontal_indices]))
    posterior_alpha = float(np.nanmean(alpha[posterior_indices]))
    global_theta = float(np.nanmean(theta))
    global_alpha = float(np.nanmean(alpha))
    global_beta = float(np.nanmean(beta))
    theta_alpha_ratio = safe_ratio(global_theta, global_alpha)
    load_proxy = math.log10(frontal_theta + 1e-12) - math.log10(posterior_alpha + 1e-12) + math.log10(theta_alpha_ratio + 1e-12)

    rows = [
        ["frontal_theta_4_7", fmt(frontal_theta), "Fz/F3/F4/Fc1/Fc2；缺失时全通道均值"],
        ["posterior_alpha_8_12", fmt(posterior_alpha), "Pz/P3/P4/O1/O2/Oz；缺失时全通道均值"],
        ["global_theta", fmt(global_theta), "all retained EEG channels"],
        ["global_alpha", fmt(global_alpha), "all retained EEG channels"],
        ["global_beta_13_30", fmt(global_beta), "all retained EEG channels"],
        ["theta_alpha_ratio", fmt(theta_alpha_ratio), "global theta / global alpha"],
        ["eeg_load_proxy", fmt(load_proxy), "log frontal_theta - log posterior_alpha + log theta_alpha_ratio"],
    ]

    return {
        "table": {
            "title": "trial-level EEG 频带特征",
            "columns": ["feature", "value", "definition"],
            "rows": rows,
        },
        "chart": {
            "type": "bar",
            "title": "EEG 频带摘要",
            "xLabel": "feature",
            "yLabel": "power / ratio",
            "data": [
                {"label": "frontal theta", "value": safe_chart_value(frontal_theta)},
                {"label": "posterior alpha", "value": safe_chart_value(posterior_alpha)},
                {"label": "theta/alpha", "value": safe_chart_value(theta_alpha_ratio)},
                {"label": "global beta", "value": safe_chart_value(global_beta)},
            ],
        },
        "notes": notes,
    }


def compute_event_locked_report(data: np.ndarray, timestamps: np.ndarray, labels: list[str], fs: float, rows: list[dict[str, Any]]) -> dict[str, Any] | None:
    if fs <= 0 or len(timestamps) < 2:
        return None

    frontal_indices = label_indices(labels, FRONTAL_CHANNELS) or list(range(data.shape[1]))
    posterior_indices = label_indices(labels, POSTERIOR_CHANNELS) or list(range(data.shape[1]))
    feature_rows = []

    for row in rows:
        event = row.get("event", "")
        duration = EVENT_WINDOWS.get(event)
        if not duration:
            continue
        start_ts = row["_xdf_ts"]
        mask = (timestamps >= start_ts) & (timestamps <= start_ts + duration)
        epoch = data[mask]
        if len(epoch) < max(32, int(fs * 0.5)):
            continue
        powers = band_powers(epoch, fs)
        if not powers:
            continue
        theta = powers["theta"]
        alpha = powers["alpha"]
        feature_rows.append(
            {
                "event": event,
                "window_s": duration,
                "xdf_time": start_ts,
                "samples": len(epoch),
                "frontal_theta": float(np.nanmean(theta[frontal_indices])),
                "posterior_alpha": float(np.nanmean(alpha[posterior_indices])),
                "theta_alpha_ratio": safe_ratio(float(np.nanmean(theta)), float(np.nanmean(alpha))),
                "near_audio": has_nearby_event(rows, start_ts, "audio_play", radius_s=2.0),
            }
        )

    if not feature_rows:
        return None

    summary = []
    chart_data = []
    for event in EVENT_WINDOWS:
        event_rows = [row for row in feature_rows if row["event"] == event]
        if not event_rows:
            continue
        mean_theta = float(np.nanmean([row["frontal_theta"] for row in event_rows]))
        mean_alpha = float(np.nanmean([row["posterior_alpha"] for row in event_rows]))
        mean_ratio = float(np.nanmean([row["theta_alpha_ratio"] for row in event_rows]))
        summary.append(
            [
                event,
                str(len(event_rows)),
                fmt(mean_theta),
                fmt(mean_alpha),
                fmt(mean_ratio),
                str(sum(row["near_audio"] for row in event_rows)),
            ]
        )
        chart_data.append({"label": event, "value": safe_chart_value(mean_ratio)})

    return {
        "valid_event_epochs": len(feature_rows),
        "table": {
            "title": "事件锁定 EEG 特征摘要",
            "columns": ["event", "epochs", "mean_frontal_theta", "mean_posterior_alpha", "mean_theta_alpha_ratio", "near_audio_epochs"],
            "rows": summary,
        },
        "chart": {
            "type": "bar",
            "title": "事件窗 theta/alpha ratio",
            "xLabel": "event",
            "yLabel": "theta/alpha",
            "data": chart_data,
        },
    }


def empty_eeg_report() -> dict[str, Any]:
    return {
        "metrics": {"valid_event_epochs": 0},
        "charts": [],
        "tables": [],
        "notes": ["没有 EEG stream，报告只保留 marker/session/behavior 层面的信息。"],
    }


def choose_marker_stream(streams: list[dict[str, Any]]) -> dict[str, Any] | None:
    if not streams:
        return None
    return max(streams, key=lambda stream: marker_stream_score(stream))


def choose_eeg_stream(streams: list[dict[str, Any]]) -> dict[str, Any] | None:
    if not streams:
        return None
    return max(streams, key=lambda stream: eeg_stream_score(stream))


def is_marker_stream(stream: dict[str, Any]) -> bool:
    text = stream_identity(stream)
    return "metrorescuemarkers" in text or "marker" in text


def is_eeg_stream(stream: dict[str, Any]) -> bool:
    text = stream_identity(stream)
    channels = int(to_float(meta_value(stream.get("info", {}), "channel_count", 0)) or 0)
    return "mitsar" in text or "eeg" in text or channels >= 8


def marker_stream_score(stream: dict[str, Any]) -> tuple[int, int]:
    text = stream_identity(stream)
    score = 0
    if "metrorescuemarkers" in text:
        score += 100
    if "marker" in text:
        score += 20
    return score, len(stream.get("time_stamps", []))


def eeg_stream_score(stream: dict[str, Any]) -> tuple[int, float, int]:
    text = stream_identity(stream)
    info = stream.get("info", {})
    channels = int(to_float(meta_value(info, "channel_count", 0)) or 0)
    score = 0
    if "mitsar" in text:
        score += 100
    if "eeg" in text:
        score += 50
    score += min(channels, 64)
    return score, stream_duration(stream), len(stream.get("time_stamps", []))


def parse_marker_stream(stream: dict[str, Any]) -> list[dict[str, Any]]:
    rows = []
    for timestamp, row in zip(stream.get("time_stamps", []), stream.get("time_series", [])):
        raw = row[0] if isinstance(row, (list, tuple, np.ndarray)) and len(row) else row
        parsed = parse_marker(raw)
        parsed["_raw"] = str(raw)
        parsed["_xdf_ts"] = float(timestamp)
        rows.append(parsed)
    return sorted(rows, key=lambda row: row["_xdf_ts"])


def parse_marker(raw: Any) -> dict[str, str]:
    text = str(raw)
    parsed: dict[str, str] = {}
    for part in text.split(";"):
        if "=" not in part:
            continue
        key, value = part.split("=", 1)
        parsed[key.strip()] = value.strip()
    if "event" not in parsed and text.strip():
        parsed["event"] = text.strip()
    return parsed


def select_primary_session(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    sessions = summarize_sessions(rows)
    return sessions[0]["items"] if sessions else []


def session_score(session: dict[str, Any]) -> tuple[int, int, int]:
    return (
        1 if session["has_start"] and session["has_complete"] else 0,
        1 if session["has_complete"] else 0,
        int(session["count"]),
    )


def session_key(row: dict[str, Any]) -> tuple[str, str, str, str, str]:
    return (
        row.get("subject", ""),
        row.get("session", ""),
        row.get("map", ""),
        row.get("signage", row.get("signature", "")),
        row.get("audio", ""),
    )


def get_trial_window(rows: list[dict[str, Any]]) -> dict[str, float] | None:
    if not rows:
        return None

    start_row = find_first_event(rows, START_EVENTS) or rows[0]
    end_row = find_first_event(rows, (END_EVENT,)) or rows[-1]
    start_ts = float(start_row["_xdf_ts"])
    end_ts = float(end_row["_xdf_ts"])
    if end_ts < start_ts:
        end_ts = float(rows[-1]["_xdf_ts"])
    return {
        "start_ts": start_ts,
        "end_ts": end_ts,
        "duration_s": max(0.0, end_ts - start_ts),
    }


def find_first_event(rows: list[dict[str, Any]], events: tuple[str, ...]) -> dict[str, Any] | None:
    event_set = set(events)
    for row in sorted(rows, key=lambda item: item["_xdf_ts"]):
        if row.get("event", "") in event_set:
            return row
    return None


def first_event_latency(rows: list[dict[str, Any]], event: str, window: dict[str, float] | None) -> float | None:
    if not window:
        return None
    for row in sorted(rows, key=lambda item: item["_xdf_ts"]):
        if row.get("event", "") == event:
            return float(row["_xdf_ts"]) - window["start_ts"]
    return None


def mean_sign_readable_latency(rows: list[dict[str, Any]]) -> float | None:
    latencies = []
    visible_times: list[float] = []
    for row in sorted(rows, key=lambda item: item["_xdf_ts"]):
        event = row.get("event", "")
        if event == "sign_visible_enter":
            visible_times.append(float(row["_xdf_ts"]))
        elif event == "sign_readable" and visible_times:
            previous_visible = max(time for time in visible_times if time <= float(row["_xdf_ts"]))
            latencies.append(float(row["_xdf_ts"]) - previous_visible)
    return float(np.nanmean(latencies)) if latencies else None


def has_nearby_event(rows: list[dict[str, Any]], timestamp: float, event: str, radius_s: float) -> bool:
    return any(row.get("event", "") == event and abs(float(row["_xdf_ts"]) - timestamp) <= radius_s for row in rows)


def ensure_2d_numeric(series: Any, timestamp_count: int) -> np.ndarray:
    try:
        data = np.asarray(series, dtype=float)
    except (TypeError, ValueError):
        return np.empty((0, 0), dtype=float)
    if data.ndim == 1:
        data = data.reshape((-1, 1))
    if data.ndim != 2:
        return np.empty((0, 0), dtype=float)
    if timestamp_count and data.shape[0] != timestamp_count and data.shape[1] == timestamp_count:
        data = data.T
    return data


def align_data_and_timestamps(data: np.ndarray, timestamps: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    length = min(len(data), len(timestamps))
    return data[:length], timestamps[:length]


def trial_mask(timestamps: np.ndarray, window: dict[str, float] | None) -> np.ndarray:
    if not window:
        return np.ones(len(timestamps), dtype=bool)
    return (timestamps >= window["start_ts"]) & (timestamps <= window["end_ts"])


def channel_quality(data: np.ndarray, labels: list[str]) -> list[dict[str, Any]]:
    rows = []
    std_values = np.nanstd(data, axis=0)
    ptp_values = np.nanmax(data, axis=0) - np.nanmin(data, axis=0)
    missing_values = np.mean(~np.isfinite(data), axis=0) * 100
    finite_stds = std_values[np.isfinite(std_values) & (std_values > 0)]
    median_std = float(np.nanmedian(finite_stds)) if len(finite_stds) else 0.0

    for index, label in enumerate(labels):
        std = float(std_values[index]) if index < len(std_values) else 0.0
        ptp = float(ptp_values[index]) if index < len(ptp_values) else 0.0
        missing = float(missing_values[index]) if index < len(missing_values) else 100.0
        flags = []
        if "event" in label.lower():
            flags.append("event-channel")
        if not math.isfinite(std) or std < 1e-9 or ptp < 1e-9:
            flags.append("flat")
        if median_std > 0 and std > median_std * 8:
            flags.append("high-variance")
        if missing > 5:
            flags.append("missing")
        rows.append(
            {
                "index": index,
                "label": label,
                "std": std,
                "ptp": ptp,
                "missing_pct": missing,
                "flag": ", ".join(flags) or "ok",
                "exclude": bool({"event-channel", "flat"} & set(flags)),
            }
        )
    return rows


def eeg_coverage_rows(all_timestamps: np.ndarray, trial_timestamps: np.ndarray, fs: float, window: dict[str, float] | None) -> tuple[list[list[str]], list[str]]:
    notes = []
    eeg_start = float(all_timestamps[0])
    eeg_end = float(all_timestamps[-1])
    rows = [
        ["eeg_start_xdf_time", fmt(eeg_start)],
        ["eeg_end_xdf_time", fmt(eeg_end)],
        ["eeg_duration_s", fmt(eeg_end - eeg_start)],
        ["effective_srate_hz", fmt(fs)],
        ["samples_in_analysis_window", str(len(trial_timestamps))],
    ]

    if window:
        start_margin = window["start_ts"] - eeg_start
        end_margin = eeg_end - window["end_ts"]
        expected = int(round(window["duration_s"] * fs)) if fs > 0 else 0
        ratio = safe_ratio(len(trial_timestamps), expected) if expected else None
        rows.extend(
            [
                ["trial_start_inside_eeg", "yes" if start_margin >= 0 else "no"],
                ["trial_end_inside_eeg", "yes" if end_margin >= 0 else "no"],
                ["start_margin_s", fmt(start_margin)],
                ["end_margin_s", fmt(end_margin)],
                ["expected_trial_samples", str(expected) if expected else "-"],
                ["actual_expected_ratio", fmt(ratio)],
            ]
        )
        if start_margin < 0 or end_margin < 0:
            notes.append("EEG stream 没有完整覆盖 map_start 到 evacuation_complete，需要检查 LabRecorder 启停或选择另一条 EEG stream。")
        if ratio is not None and ratio < 0.9:
            notes.append("trial window 内 EEG sample 数低于按采样率估计的 90%，可能存在中断、时间戳异常或 trial window 识别问题。")
    else:
        rows.append(["trial_window", "missing"])
    return rows, notes


def compute_event_sampling_warning(fs: float, n: int) -> bool:
    return fs <= 0 or n < max(32, int(fs * 0.5) if fs > 0 else 32)


def band_powers(data: np.ndarray, fs: float) -> dict[str, np.ndarray] | None:
    if compute_event_sampling_warning(fs, len(data)):
        return None

    clean = np.asarray(data, dtype=float)
    clean = clean - np.nanmean(clean, axis=0, keepdims=True)
    clean = np.nan_to_num(clean, nan=0.0, posinf=0.0, neginf=0.0)
    freqs, psd = welch_psd(clean, fs)
    if freqs is None or psd is None:
        return None
    return {
        "theta": integrate_band(freqs, psd, 4.0, 7.0),
        "alpha": integrate_band(freqs, psd, 8.0, 12.0),
        "beta": integrate_band(freqs, psd, 13.0, 30.0),
    }


def welch_psd(data: np.ndarray, fs: float) -> tuple[np.ndarray | None, np.ndarray | None]:
    nperseg = min(len(data), max(128, int(round(fs * 4))))
    if nperseg < 32:
        return None, None
    step = max(1, nperseg // 2)
    starts = list(range(0, len(data) - nperseg + 1, step))
    if not starts:
        starts = [0]

    window = np.hanning(nperseg).reshape(-1, 1)
    scale = fs * float(np.sum(window[:, 0] ** 2))
    if scale <= 0:
        return None, None

    spectra = []
    for start in starts:
        segment = data[start : start + nperseg]
        if len(segment) != nperseg:
            continue
        fft = np.fft.rfft(segment * window, axis=0)
        psd = (np.abs(fft) ** 2) / scale
        if len(psd) > 2:
            psd[1:-1] *= 2
        spectra.append(psd)

    if not spectra:
        return None, None
    freqs = np.fft.rfftfreq(nperseg, d=1.0 / fs)
    return freqs, np.nanmean(np.stack(spectra, axis=0), axis=0)


def integrate_band(freqs: np.ndarray, psd: np.ndarray, low: float, high: float) -> np.ndarray:
    mask = (freqs >= low) & (freqs <= high)
    if not np.any(mask):
        return np.full(psd.shape[1], np.nan)
    return np.trapz(psd[mask], freqs[mask], axis=0)


def label_indices(labels: list[str], targets: set[str]) -> list[int]:
    normalized = [normalize_channel_label(label) for label in labels]
    return [index for index, label in enumerate(normalized) if label in targets]


def extract_channel_labels(info: dict[str, Any], fallback_count: int) -> list[str]:
    labels: list[str] = []
    desc = first_item(info.get("desc"))
    channels = first_item(desc.get("channels")) if isinstance(desc, dict) else None
    channel_items = channels.get("channel") if isinstance(channels, dict) else None
    for item in ensure_list(channel_items):
        if isinstance(item, dict):
            label = str(meta_value(item, "label", "") or meta_value(item, "name", "")).strip()
            if label:
                labels.append(label)
    if len(labels) < fallback_count:
        labels.extend([f"Ch{index + 1}" for index in range(len(labels), fallback_count)])
    return labels[:fallback_count]


def effective_sampling_rate(stream: dict[str, Any], timestamps: np.ndarray) -> float:
    nominal = to_float(meta_value(stream.get("info", {}), "nominal_srate", 0)) or 0.0
    if nominal > 0:
        return nominal
    if len(timestamps) > 2:
        diffs = np.diff(timestamps)
        median = float(np.nanmedian(diffs[diffs > 0])) if np.any(diffs > 0) else 0.0
        if median > 0:
            return 1.0 / median
    return 0.0


def is_eeg_like_channel(label: str) -> bool:
    return "event" not in label.lower()


def stream_identity(stream: dict[str, Any]) -> str:
    info = stream.get("info", {})
    return f"{meta_value(info, 'name', '')} {meta_value(info, 'type', '')}".lower()


def stream_name(stream: dict[str, Any]) -> str:
    return str(meta_value(stream.get("info", {}), "name", ""))


def stream_duration(stream: dict[str, Any]) -> float:
    timestamps = np.asarray(stream.get("time_stamps", []), dtype=float)
    return float(timestamps[-1] - timestamps[0]) if len(timestamps) > 1 else 0.0


def format_session_label(row: dict[str, Any]) -> str:
    subject, session_id, metro, signature, audio = session_key(row)
    parts = [part for part in [subject, session_id, metro, signature, audio] if part]
    return " / ".join(parts) if parts else "-"


def normalize_channel_label(label: str) -> str:
    return "".join(ch for ch in str(label).lower() if ch.isalnum())


def meta_value(info: dict[str, Any], key: str, default: Any = "") -> Any:
    value = info.get(key, default) if isinstance(info, dict) else default
    return first_item(value)


def first_item(value: Any) -> Any:
    if isinstance(value, list) and value:
        return value[0]
    return value


def ensure_list(value: Any) -> list[Any]:
    if value is None:
        return []
    return value if isinstance(value, list) else [value]


def to_float(value: Any) -> float | None:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def safe_ratio(numerator: float | int | None, denominator: float | int | None) -> float | None:
    if numerator is None or denominator is None:
        return None
    denominator = float(denominator)
    if not math.isfinite(denominator) or abs(denominator) < 1e-12:
        return None
    result = float(numerator) / denominator
    return result if math.isfinite(result) else None


def safe_chart_value(value: Any) -> float:
    number = to_float(value)
    if number is None:
        return 0.0
    if number < 0:
        return round(number, 6)
    return round(number, 6)


def get_extension(filename: str) -> str:
    return filename.rsplit(".", 1)[-1].lower() if "." in filename else ""


def fmt(value: Any) -> str:
    if value is None:
        return "-"
    try:
        number = float(value)
    except (TypeError, ValueError):
        return str(value)
    if not math.isfinite(number):
        return "-"
    if number == 0:
        return "0"
    if abs(number) >= 1000 or abs(number) < 0.001:
        return f"{number:.3e}"
    return f"{number:.3f}".rstrip("0").rstrip(".")


def fmt_seconds(value: Any) -> str:
    number = to_float(value)
    return f"{fmt(number)} s" if number is not None else "-"


def now_sql() -> str:
    return datetime.now(timezone.utc).isoformat()


def to_jsonable(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): to_jsonable(item) for key, item in value.items()}
    if isinstance(value, list):
        return [to_jsonable(item) for item in value]
    if isinstance(value, tuple):
        return [to_jsonable(item) for item in value]
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        number = float(value)
        return number if math.isfinite(number) else None
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if value is None:
        return None
    return value


if __name__ == "__main__":
    main()
