from __future__ import annotations

import argparse
import csv
import json
import math
import re
from collections import defaultdict
from pathlib import Path
from typing import Any

import numpy as np

from advanced_analysis_worker import (
    analyze_subject_batch,
    analyze_xdf,
    extract_run_summary,
    infer_run_position,
    infer_sequence_index,
    infer_subject_id,
    metric_meta,
    normal_cdf,
    to_float,
    to_jsonable,
)

try:
    from scipy import stats as scipy_stats
except Exception:  # pragma: no cover - local runtime compatibility fallback
    scipy_stats = None


DENSITY_LEVELS = ("low", "medium", "high")
PLANNED_CONTRAST_WEIGHTS = {"low": -0.5, "medium": 1.0, "high": -0.5}
FE_CONTRAST_CODING = {"low": -1.0, "medium": 2.0, "high": -1.0}

METRICS = [
    "route_confirmation_hesitation_index",
    "route_decision_hesitation_index",
    "eeg_information_processing_load_index",
    "decision_point_enter_eeg_load_proxy",
    "sign_readable_eeg_load_proxy",
    "eeg_load_proxy",
    "theta_alpha_ratio",
    "frontal_theta_4_7",
    "posterior_alpha_8_12",
    "route_confirmation_disfluency_index",
    "decision_dwell_total_s",
    "decision_total_look_count",
    "decision_scan_both_count",
    "decision_load_proxy",
    "behavior_load_proxy",
    "navigation_inefficiency_proxy",
    "prompt_to_first_confirmation_s",
    "time_to_first_sign_readable_s",
    "time_to_first_decision_s",
    "duration_s",
]

RAW_TRANSFORM_METRICS = {
    "decision_dwell_total_s",
    "decision_total_look_count",
    "decision_scan_both_count",
    "decision_load_proxy",
    "behavior_load_proxy",
    "navigation_inefficiency_proxy",
    "prompt_to_first_confirmation_s",
    "time_to_first_sign_readable_s",
    "time_to_first_decision_s",
    "duration_s",
}


def main() -> None:
    parser = argparse.ArgumentParser(description="Explore local Metro Rescue XDF planned contrasts.")
    parser.add_argument("--raw-dir", type=Path, default=Path("work/xdf_raw"))
    parser.add_argument("--out-dir", type=Path, default=Path("work/xdf_exploration"))
    parser.add_argument("--manifest", type=Path, default=Path("work/xdf_manifest.json"))
    parser.add_argument("--refresh", action="store_true")
    args = parser.parse_args()

    args.out_dir.mkdir(parents=True, exist_ok=True)
    report_dir = args.out_dir / "run_reports"
    subject_dir = args.out_dir / "subject_reports"
    report_dir.mkdir(parents=True, exist_ok=True)
    subject_dir.mkdir(parents=True, exist_ok=True)

    manifest = load_manifest(args.manifest)
    local_files = discover_files(args.raw_dir, manifest)
    if not local_files:
        raise SystemExit(f"No XDF files found in {args.raw_dir}")

    run_records: list[dict[str, Any]] = []
    report_cache: dict[str, dict[str, Any]] = {}

    for index, item in enumerate(local_files, start=1):
        path = Path(item["local_path"])
        doc = {
            "id": item.get("id") or path.stem,
            "filename": item.get("filename") or path.name,
            "storage_path": item.get("storage_path") or str(path),
            "size_bytes": item.get("size_bytes") or path.stat().st_size,
        }
        cache_path = report_dir / f"{safe_stem(path.name)}.json"
        if cache_path.exists() and not args.refresh:
            report = json.loads(cache_path.read_text(encoding="utf-8"))
            print(f"[{index}/{len(local_files)}] cache {path.name}", flush=True)
        else:
            print(f"[{index}/{len(local_files)}] analyze {path.name}", flush=True)
            report = analyze_xdf(doc, path)
            cache_path.write_text(json.dumps(to_jsonable(report), ensure_ascii=False, indent=2), encoding="utf-8")
        report_cache[path.name] = report

        summary = extract_run_summary(doc, report)
        summary.update(qc_from_report(report))
        summary["local_path"] = str(path)
        summary["document_id"] = doc["id"]
        summary["is_old_version"] = "yes" if is_old_version(path.name) else "no"
        summary["sequence_index"] = infer_sequence_index(path.name) or ""
        summary["run_position"] = infer_run_position(path.name) or ""
        summary["subject"] = summary.get("subject") or infer_subject_id(path.name)
        run_records.append(summary)

    write_json(args.out_dir / "run_summaries.json", run_records)
    write_csv(args.out_dir / "run_summaries.csv", run_records)

    canonical_runs, canonical_notes = choose_canonical_runs(run_records)
    complete_subjects = {
        subject: by_density
        for subject, by_density in canonical_runs.items()
        if all(level in by_density for level in DENSITY_LEVELS)
    }

    subject_reports: list[dict[str, Any]] = []
    subject_contrasts: list[dict[str, Any]] = []
    subject_rows_by_subject: dict[str, list[dict[str, Any]]] = {}

    for subject, by_density in sorted(complete_subjects.items()):
        rows = [by_density[level] for level in DENSITY_LEVELS]
        docs = [
            {
                "id": row.get("document_id") or row["file"],
                "filename": row["file"],
                "storage_path": row.get("local_path", row["file"]),
                "size_bytes": Path(row["local_path"]).stat().st_size if row.get("local_path") else None,
            }
            for row in rows
        ]
        reports = [report_cache[row["file"]] for row in rows]
        subject_report = analyze_subject_batch({"subjectId": subject}, docs, reports)
        (subject_dir / f"{subject}.json").write_text(
            json.dumps(to_jsonable(subject_report), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        subject_reports.append(subject_report)
        subject_rows = subject_report.get("runRows") or []
        subject_rows_by_subject[subject] = subject_rows
        for contrast in subject_report.get("supportContrasts") or []:
            subject_contrasts.append(
                {
                    "subject": subject,
                    "metric": contrast.get("metric"),
                    "metric_label": contrast.get("metricLabel"),
                    "tier": contrast.get("tier"),
                    "estimate": contrast.get("estimate"),
                    "direction": contrast.get("direction"),
                }
            )

    write_json(args.out_dir / "subject_contrasts.json", subject_contrasts)
    write_csv(args.out_dir / "subject_contrasts.csv", subject_contrasts)

    canonical_run_rows = [row for subject in sorted(subject_rows_by_subject) for row in subject_rows_by_subject[subject]]
    write_json(args.out_dir / "canonical_run_rows.json", canonical_run_rows)
    write_csv(args.out_dir / "canonical_run_rows.csv", canonical_run_rows)

    grids = build_grid_results(complete_subjects, subject_rows_by_subject, subject_contrasts)
    write_json(args.out_dir / "analysis_grid_results.json", grids)
    write_csv(args.out_dir / "analysis_grid_results.csv", grids)

    fixed_effects = build_fixed_effect_results(canonical_run_rows)
    write_json(args.out_dir / "map_adjusted_results.json", fixed_effects)
    write_csv(args.out_dir / "map_adjusted_results.csv", fixed_effects)

    summary = {
        "xdf_files": len(local_files),
        "unique_sequence_indices": len({row.get("sequence_index") for row in run_records if row.get("sequence_index")}),
        "subjects_with_any_run": len(canonical_runs),
        "complete_subjects": len(complete_subjects),
        "canonical_notes": canonical_notes,
        "top_results": top_results(grids),
        "top_fixed_effect_results": top_fixed_effect_results(fixed_effects),
    }
    write_json(args.out_dir / "exploration_summary.json", summary)
    print(json.dumps(summary, ensure_ascii=False, indent=2), flush=True)


def load_manifest(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    return json.loads(path.read_text(encoding="utf-8"))


def discover_files(raw_dir: Path, manifest: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_name: dict[str, dict[str, Any]] = {}
    for item in manifest:
        local = Path(item.get("local_path") or "")
        if local.exists():
            by_name[local.name] = {**item, "local_path": str(local)}
    for path in sorted(raw_dir.glob("*.xdf")):
        by_name.setdefault(path.name, {"filename": path.name, "local_path": str(path), "size_bytes": path.stat().st_size})
    return [by_name[name] for name in sorted(by_name)]


def qc_from_report(report: dict[str, Any]) -> dict[str, Any]:
    qc = {
        "qc_marker_stream": "",
        "qc_eeg_stream": "",
        "qc_trial_window": "",
        "qc_core_events": "",
        "qc_eeg_event_windows": "",
        "qc_duplicate_markers": "",
        "trial_start_present": "",
        "trial_complete_present": "",
        "valid_event_epochs": "",
        "duplicate_marker_ratio": "",
    }
    for table in report.get("tables") or []:
        if table.get("title") != "单 run QC 判定与排除记录":
            continue
        for row in table.get("rows") or []:
            if len(row) < 3:
                continue
            label, status, detail = row[0], row[1], row[2]
            if label == "marker stream":
                qc["qc_marker_stream"] = status
            elif label == "EEG stream":
                qc["qc_eeg_stream"] = status
            elif label == "trial window 起止":
                qc["qc_trial_window"] = status
                qc["trial_start_present"] = boolish_from_detail(detail, "start")
                qc["trial_complete_present"] = boolish_from_detail(detail, "complete")
            elif label == "核心事件覆盖":
                qc["qc_core_events"] = status
            elif label == "EEG 事件窗":
                qc["qc_eeg_event_windows"] = status
                match = re.search(r"valid_event_epochs=(\d+)", str(detail))
                if match:
                    qc["valid_event_epochs"] = int(match.group(1))
            elif label == "重复 marker":
                qc["qc_duplicate_markers"] = status
                match = re.search(r"\(([-+0-9.]+)\)", str(detail))
                if match:
                    qc["duplicate_marker_ratio"] = float(match.group(1))
    return qc


def boolish_from_detail(detail: Any, key: str) -> str:
    match = re.search(rf"{re.escape(key)}=(True|False|true|false|yes|no)", str(detail))
    if not match:
        return ""
    return "yes" if match.group(1).lower() in {"true", "yes"} else "no"


def choose_canonical_runs(run_records: list[dict[str, Any]]) -> tuple[dict[str, dict[str, dict[str, Any]]], list[str]]:
    grouped: dict[str, dict[str, list[dict[str, Any]]]] = defaultdict(lambda: defaultdict(list))
    for row in run_records:
        subject = str(row.get("subject") or "")
        density = str(row.get("density") or "")
        if subject and density in DENSITY_LEVELS:
            grouped[subject][density].append(row)

    canonical: dict[str, dict[str, dict[str, Any]]] = {}
    notes: list[str] = []
    for subject, by_density in grouped.items():
        canonical[subject] = {}
        for density, candidates in by_density.items():
            chosen = sorted(candidates, key=canonical_sort_key)[0]
            canonical[subject][density] = chosen
            if len(candidates) > 1:
                names = ", ".join(row["file"] for row in candidates)
                notes.append(f"{subject}/{density}: chose {chosen['file']} from {names}")
    return canonical, notes


def canonical_sort_key(row: dict[str, Any]) -> tuple[int, int, int, int, str]:
    old_penalty = 1 if is_old_version(str(row.get("file") or "")) else 0
    completion_penalty = 0 if str(row.get("has_completion") or "").lower() == "yes" else 1
    start_penalty = 0 if row.get("trial_start_present") == "yes" else 1
    eeg_penalty = 0 if numeric(row.get("eeg_load_proxy")) is not None else 1
    return (old_penalty, completion_penalty, start_penalty, eeg_penalty, str(row.get("file") or ""))


def build_grid_results(
    complete_subjects: dict[str, dict[str, dict[str, Any]]],
    subject_rows_by_subject: dict[str, list[dict[str, Any]]],
    subject_contrasts: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    contrast_by_subject_metric: dict[tuple[str, str], float] = {}
    for item in subject_contrasts:
        value = numeric(item.get("estimate"))
        if value is not None:
            contrast_by_subject_metric[(str(item["subject"]), str(item["metric"]))] = value

    filters = {
        "all_complete": lambda subject: True,
        "strict_start_all_runs": lambda subject: all(
            complete_subjects[subject][level].get("trial_start_present") == "yes" for level in DENSITY_LEVELS
        ),
        "low_duplicate_ratio": lambda subject: all(
            (numeric(complete_subjects[subject][level].get("duplicate_marker_ratio")) or 0.0) <= 0.10
            for level in DENSITY_LEVELS
        ),
        "eeg_epochs_ge_20": lambda subject: all(
            (numeric(complete_subjects[subject][level].get("valid_event_epochs")) or 0.0) >= 20
            for level in DENSITY_LEVELS
        ),
    }

    for filter_name, include_subject in filters.items():
        subjects = [subject for subject in sorted(complete_subjects) if include_subject(subject)]
        for metric in METRICS:
            values = [contrast_by_subject_metric[(subject, metric)] for subject in subjects if (subject, metric) in contrast_by_subject_metric]
            rows.append(result_row(filter_name, "subject_contrast", metric, values))

        for metric in sorted(RAW_TRANSFORM_METRICS):
            values = []
            for subject in subjects:
                by_density = {row.get("density"): row for row in subject_rows_by_subject.get(subject, [])}
                transformed = {}
                for density in DENSITY_LEVELS:
                    value = numeric(by_density.get(density, {}).get(metric))
                    if value is None:
                        transformed = {}
                        break
                    transformed[density] = math.log1p(max(value, 0.0))
                if transformed:
                    values.append(planned_contrast(transformed))
            rows.append(result_row(filter_name, "log1p_raw_metric", metric, values))

    add_fdr(rows)
    return rows


def result_row(filter_name: str, analysis: str, metric: str, values: list[float]) -> dict[str, Any]:
    clean = [float(value) for value in values if math.isfinite(float(value))]
    meta = metric_meta(metric, metric)
    out = {
        "filter": filter_name,
        "analysis": analysis,
        "metric": metric,
        "metric_label": meta.get("metricLabel") or metric,
        "tier": meta.get("tier") or "exploratory",
        "tier_label": meta.get("tierLabel") or "",
        "n": len(clean),
        "mean_contrast": "",
        "sd": "",
        "ci95_low": "",
        "ci95_high": "",
        "t": "",
        "p": "",
        "cohen_dz": "",
        "wilcoxon_p": "",
        "sign_p": "",
        "positive_count": sum(1 for value in clean if value > 0),
        "negative_count": sum(1 for value in clean if value < 0),
        "zero_count": sum(1 for value in clean if value == 0),
        "q_bh": "",
    }
    if len(clean) == 0:
        return out
    arr = np.asarray(clean, dtype=float)
    out["mean_contrast"] = float(np.mean(arr))
    out["sd"] = float(np.std(arr, ddof=1)) if len(arr) > 1 else 0.0
    if len(arr) >= 2:
        sd = float(np.std(arr, ddof=1))
        sem = sd / math.sqrt(len(arr))
        tcrit = 1.96
        t_value = float(np.mean(arr) / sem) if sem > 0 else math.nan
        p_value = normal_p(t_value) if math.isfinite(t_value) else ""
        if scipy_stats is not None:
            try:
                tcrit = float(scipy_stats.t.ppf(0.975, len(arr) - 1))
                ttest = scipy_stats.ttest_1samp(arr, 0.0, nan_policy="omit")
                t_value = float(ttest.statistic)
                p_value = float(ttest.pvalue)
            except Exception:
                pass
        out["ci95_low"] = float(np.mean(arr) - tcrit * sem)
        out["ci95_high"] = float(np.mean(arr) + tcrit * sem)
        out["t"] = t_value
        out["p"] = p_value
        out["cohen_dz"] = float(np.mean(arr) / sd) if sd > 0 else ""
        nonzero = arr[arr != 0]
        if len(nonzero) > 0:
            positives = int(np.sum(nonzero > 0))
            out["sign_p"] = exact_sign_p(positives, len(nonzero))
            if scipy_stats is not None:
                try:
                    out["wilcoxon_p"] = float(scipy_stats.wilcoxon(nonzero, alternative="two-sided").pvalue)
                except Exception:
                    out["wilcoxon_p"] = ""
    return out


def build_fixed_effect_results(run_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for metric in METRICS:
        for transform in ("raw", "log1p"):
            if transform == "log1p" and metric not in RAW_TRANSFORM_METRICS:
                continue
            for include_map in (False, True):
                result = fit_fixed_effect_contrast(run_rows, metric, transform, include_map)
                if result:
                    rows.append(result)
    add_fdr_for_key(rows, "p")
    return rows


def fit_fixed_effect_contrast(
    run_rows: list[dict[str, Any]],
    metric: str,
    transform: str,
    include_map: bool,
) -> dict[str, Any] | None:
    data = []
    for row in run_rows:
        density = str(row.get("density") or "")
        if density not in FE_CONTRAST_CODING:
            continue
        value = numeric(row.get(metric))
        if value is None:
            continue
        if transform == "log1p":
            value = math.log1p(max(value, 0.0))
        data.append((value, str(row.get("subject") or ""), density, str(row.get("map") or "map_unknown")))
    if len(data) < 10:
        return None

    subjects = sorted({subject for _value, subject, _density, _map in data})
    maps = sorted({map_name for _value, _subject, _density, map_name in data})
    design = []
    y_values = []
    for value, subject, density, map_name in data:
        row = [1.0, FE_CONTRAST_CODING[density]]
        row.extend(1.0 if subject == item else 0.0 for item in subjects[1:])
        if include_map:
            row.extend(1.0 if map_name == item else 0.0 for item in maps[1:])
        design.append(row)
        y_values.append(value)

    x = np.asarray(design, dtype=float)
    y = np.asarray(y_values, dtype=float)
    beta, *_ = np.linalg.lstsq(x, y, rcond=None)
    residuals = y - x @ beta
    rank = int(np.linalg.matrix_rank(x))
    df = int(len(y) - rank)
    if df <= 0:
        return None
    mse = float(residuals @ residuals / df)
    cov = mse * np.linalg.pinv(x.T @ x)
    se = math.sqrt(max(float(cov[1, 1]), 0.0))
    t_value = float(beta[1] / se) if se > 0 else math.nan
    return {
        "filter": "all_complete",
        "analysis": "ols_subject_fe_map_fe" if include_map else "ols_subject_fe",
        "transform": transform,
        "metric": metric,
        "n_runs": len(y),
        "n_subjects": len(subjects),
        "coef": float(beta[1]),
        "se": se,
        "t": t_value,
        "df": df,
        "p": normal_p(t_value) if math.isfinite(t_value) else "",
        "q_bh": "",
    }


def add_fdr(rows: list[dict[str, Any]]) -> None:
    groups: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        if numeric(row.get("p")) is not None:
            groups[(row["filter"], row["analysis"])].append(row)
    for group_rows in groups.values():
        sorted_rows = sorted(group_rows, key=lambda row: float(row["p"]))
        m = len(sorted_rows)
        prev = 1.0
        for rank, row in reversed(list(enumerate(sorted_rows, start=1))):
            q = min(prev, float(row["p"]) * m / rank)
            row["q_bh"] = q
            prev = q


def add_fdr_for_key(rows: list[dict[str, Any]], key: str) -> None:
    groups: dict[tuple[str, str, str], list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        if numeric(row.get(key)) is not None:
            groups[(str(row.get("filter", "")), str(row.get("analysis", "")), str(row.get("transform", "")))].append(row)
    for group_rows in groups.values():
        sorted_rows = sorted(group_rows, key=lambda row: float(row[key]))
        m = len(sorted_rows)
        prev = 1.0
        for rank, row in reversed(list(enumerate(sorted_rows, start=1))):
            q = min(prev, float(row[key]) * m / rank)
            row["q_bh"] = q
            prev = q


def top_results(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    ranked = [
        row
        for row in rows
        if numeric(row.get("p")) is not None and row.get("analysis") == "subject_contrast"
    ]
    ranked.sort(key=lambda row: (float(row["p"]), -abs(float(row.get("mean_contrast") or 0.0))))
    priority_keys = [
        ("all_complete", "route_confirmation_hesitation_index"),
        ("low_duplicate_ratio", "route_confirmation_hesitation_index"),
        ("strict_start_all_runs", "route_confirmation_hesitation_index"),
        ("all_complete", "prompt_to_first_confirmation_s"),
    ]
    prioritized: list[dict[str, Any]] = []
    used: set[tuple[str, str, str]] = set()
    for filter_name, metric in priority_keys:
        match = next(
            (
                row
                for row in ranked
                if row.get("filter") == filter_name
                and row.get("metric") == metric
                and row.get("analysis") == "subject_contrast"
            ),
            None,
        )
        if match:
            key = (str(match.get("filter")), str(match.get("analysis")), str(match.get("metric")))
            prioritized.append(match)
            used.add(key)
    for row in ranked:
        key = (str(row.get("filter")), str(row.get("analysis")), str(row.get("metric")))
        if key not in used:
            prioritized.append(row)
            used.add(key)
        if len(prioritized) >= 12:
            break
    return prioritized[:12]


def top_fixed_effect_results(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    ranked = [row for row in rows if numeric(row.get("p")) is not None]
    ranked.sort(key=lambda row: (float(row["p"]), -abs(float(row.get("coef") or 0.0))))
    priority_keys = [
        ("ols_subject_fe_map_fe", "raw", "route_confirmation_hesitation_index"),
        ("ols_subject_fe", "raw", "route_confirmation_hesitation_index"),
        ("ols_subject_fe_map_fe", "raw", "prompt_to_first_confirmation_s"),
        ("ols_subject_fe", "raw", "prompt_to_first_confirmation_s"),
    ]
    prioritized: list[dict[str, Any]] = []
    used: set[tuple[str, str, str]] = set()
    for analysis, transform, metric in priority_keys:
        match = next(
            (
                row
                for row in ranked
                if row.get("analysis") == analysis
                and row.get("transform") == transform
                and row.get("metric") == metric
            ),
            None,
        )
        if match:
            key = (str(match.get("analysis")), str(match.get("transform")), str(match.get("metric")))
            prioritized.append(match)
            used.add(key)
    for row in ranked:
        key = (str(row.get("analysis")), str(row.get("transform")), str(row.get("metric")))
        if key not in used:
            prioritized.append(row)
            used.add(key)
        if len(prioritized) >= 12:
            break
    return prioritized[:12]


def planned_contrast(values: dict[str, float]) -> float:
    return sum(values[level] * PLANNED_CONTRAST_WEIGHTS[level] for level in DENSITY_LEVELS)


def normal_p(t_value: float) -> float:
    return float(2.0 * (1.0 - normal_cdf(abs(t_value))))


def exact_sign_p(positive_count: int, n: int) -> float:
    if n <= 0:
        return math.nan
    low_tail = sum(math.comb(n, k) for k in range(0, min(positive_count, n - positive_count) + 1)) / (2**n)
    return float(min(1.0, 2.0 * low_tail))


def write_json(path: Path, data: Any) -> None:
    path.write_text(json.dumps(to_jsonable(data), ensure_ascii=False, indent=2), encoding="utf-8")


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    if not rows:
        path.write_text("", encoding="utf-8")
        return
    keys: list[str] = []
    for row in rows:
        for key in row:
            if key not in keys:
                keys.append(key)
    with path.open("w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.DictWriter(handle, fieldnames=keys, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def numeric(value: Any) -> float | None:
    parsed = to_float(value)
    if parsed is None or not math.isfinite(parsed):
        return None
    return float(parsed)


def is_old_version(filename: str) -> bool:
    return bool(re.search(r"(?:^|[_-])old\d*(?:[_-]|\.)", filename.lower()))


def safe_stem(filename: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "_", Path(filename).stem)


if __name__ == "__main__":
    main()
