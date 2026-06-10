from __future__ import annotations

import argparse
import csv
import json
import math
from collections import defaultdict
from pathlib import Path
from typing import Any, Callable

import numpy as np

try:
    from scipy import stats as scipy_stats
except Exception:  # pragma: no cover - optional local runtime dependency
    scipy_stats = None


DENSITY_LEVELS = ("low", "medium", "high")
CONTRAST_WEIGHTS = {"low": -0.5, "medium": 1.0, "high": -0.5}
PRIMARY_METRIC = "route_confirmation_hesitation_index"
LEGACY_METRIC = "route_decision_hesitation_index"
PRIMARY_COMPONENTS = (
    "prompt_to_first_confirmation_s",
    "time_to_first_sign_readable_s",
    "decision_total_look_count",
    "decision_scan_both_count",
)
RNG_SEED = 20260607


def main() -> None:
    parser = argparse.ArgumentParser(description="Build robust H1 confirmation-hesitation evidence from canonical XDF rows.")
    parser.add_argument("--input", type=Path, default=Path("work/xdf_exploration/canonical_run_rows.csv"))
    parser.add_argument("--out-dir", type=Path, default=Path("work/xdf_exploration"))
    parser.add_argument("--resamples", type=int, default=50000)
    parser.add_argument("--permutations", type=int, default=100000)
    args = parser.parse_args()

    args.out_dir.mkdir(parents=True, exist_ok=True)
    rows = read_csv(args.input)
    subjects = complete_subject_rows(rows)
    rng = np.random.default_rng(RNG_SEED)

    subject_contrast_rows = build_subject_contrast_rows(subjects)
    write_csv(args.out_dir / "h1_subject_contrast_details.csv", subject_contrast_rows)
    write_json(args.out_dir / "h1_subject_contrast_details.json", subject_contrast_rows)

    metric_specs = build_metric_specs()
    robustness_rows: list[dict[str, Any]] = []
    loo_rows: list[dict[str, Any]] = []
    pairwise_rows: list[dict[str, Any]] = []
    profile_rows: list[dict[str, Any]] = []
    shape_rows: list[dict[str, Any]] = []

    for spec in metric_specs:
        matrix = metric_matrix(subjects, spec["value_fn"])
        if not matrix:
            continue
        profile_rows.extend(condition_profile_rows(spec["name"], matrix))
        contrasts = {subject: planned_contrast(values) for subject, values in matrix.items()}
        robust = robust_summary(spec["name"], contrasts, args.resamples, args.permutations, rng)
        robust.update(
            {
                "label": spec["label"],
                "role": spec["role"],
                "components": "+".join(spec.get("components", [])),
            }
        )
        robust.update(label_permutation_summary(matrix, args.permutations, rng))
        robust.update(leave_one_out_summary(spec["name"], contrasts))
        robustness_rows.append(robust)
        loo_rows.extend(leave_one_out_rows(spec["name"], contrasts))
        pairwise_rows.extend(pairwise_summary_rows(spec["name"], matrix, args.resamples, rng))
        if spec["name"] == PRIMARY_METRIC:
            shape_rows.append(inverted_u_shape_summary(spec["name"], matrix))

    component_sensitivity_rows = build_component_sensitivity_rows(subjects, args.resamples, args.permutations, rng)
    robustness_rows.extend(component_sensitivity_rows)

    write_csv(args.out_dir / "h1_robustness_results.csv", robustness_rows)
    write_json(args.out_dir / "h1_robustness_results.json", robustness_rows)
    write_csv(args.out_dir / "h1_component_sensitivity.csv", component_sensitivity_rows)
    write_json(args.out_dir / "h1_component_sensitivity.json", component_sensitivity_rows)
    write_csv(args.out_dir / "h1_leave_one_subject_out.csv", loo_rows)
    write_json(args.out_dir / "h1_leave_one_subject_out.json", loo_rows)
    write_csv(args.out_dir / "h1_pairwise_results.csv", pairwise_rows)
    write_json(args.out_dir / "h1_pairwise_results.json", pairwise_rows)
    write_csv(args.out_dir / "h1_condition_profiles.csv", profile_rows)
    write_json(args.out_dir / "h1_condition_profiles.json", profile_rows)
    write_csv(args.out_dir / "h1_shape_diagnostics.csv", shape_rows)
    write_json(args.out_dir / "h1_shape_diagnostics.json", shape_rows)

    summary = {
        "input": str(args.input),
        "n_subjects": len(subjects),
        "rng_seed": RNG_SEED,
        "primary_metric": PRIMARY_METRIC,
        "legacy_metric": LEGACY_METRIC,
        "primary_result": next((row for row in robustness_rows if row.get("metric") == PRIMARY_METRIC), None),
        "mechanism_result": next((row for row in robustness_rows if row.get("metric") == "prompt_to_first_confirmation_s"), None),
        "legacy_result": next((row for row in robustness_rows if row.get("metric") == LEGACY_METRIC), None),
        "shape_result": shape_rows[0] if shape_rows else None,
        "component_sensitivity": component_sensitivity_rows,
        "top_rows": prioritized_robustness_rows(robustness_rows),
    }
    write_json(args.out_dir / "h1_robustness_summary.json", summary)
    print(json.dumps(to_jsonable(summary), ensure_ascii=False, indent=2), flush=True)


def build_metric_specs() -> list[dict[str, Any]]:
    return [
        {
            "name": PRIMARY_METRIC,
            "label": "Proximal route-confirmation hesitation index",
            "role": "primary_h1",
            "components": PRIMARY_COMPONENTS,
            "value_fn": lambda row: number(row.get(PRIMARY_METRIC)),
        },
        {
            "name": "h1_log_z_component_index",
            "label": "Log-z component proximal H1 sensitivity index",
            "role": "sensitivity",
            "components": PRIMARY_COMPONENTS,
            "value_fn": log_z_component_placeholder,
        },
        {
            "name": "h1_rank_component_index",
            "label": "Rank component proximal H1 sensitivity index",
            "role": "sensitivity",
            "components": PRIMARY_COMPONENTS,
            "value_fn": rank_component_placeholder,
        },
        {
            "name": "prompt_to_first_confirmation_s",
            "label": "Prompt-to-first-confirmation latency",
            "role": "mechanism",
            "components": ("prompt_to_first_confirmation_s",),
            "value_fn": lambda row: number(row.get("prompt_to_first_confirmation_s")),
        },
        {
            "name": "log_prompt_to_first_confirmation_s",
            "label": "Log prompt-to-first-confirmation latency",
            "role": "mechanism_sensitivity",
            "components": ("prompt_to_first_confirmation_s",),
            "value_fn": lambda row: log1p_value(row.get("prompt_to_first_confirmation_s")),
        },
        {
            "name": "decision_scan_both_count",
            "label": "Decision bilateral scan count",
            "role": "component",
            "components": ("decision_scan_both_count",),
            "value_fn": lambda row: number(row.get("decision_scan_both_count")),
        },
        {
            "name": LEGACY_METRIC,
            "label": "Legacy broad route-decision hesitation index",
            "role": "legacy_sensitivity",
            "components": (),
            "value_fn": lambda row: number(row.get(LEGACY_METRIC)),
        },
    ]


def prioritized_robustness_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Keep the planned H1 result first; p-sorted mechanism rows are secondary."""
    metric_order = [
        PRIMARY_METRIC,
        "h1_log_z_component_index",
        "h1_rank_component_index",
        "prompt_to_first_confirmation_s",
        "log_prompt_to_first_confirmation_s",
        "decision_scan_both_count",
        LEGACY_METRIC,
    ]
    by_metric = {str(row.get("metric")): row for row in rows}
    ordered: list[dict[str, Any]] = [by_metric[metric] for metric in metric_order if metric in by_metric]
    used = {str(row.get("metric")) for row in ordered}
    remaining = sorted(
        (row for row in rows if str(row.get("metric")) not in used),
        key=lambda row: numeric_or_inf(row.get("p_two_sided")),
    )
    return (ordered + remaining)[:8]


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    fields: list[str] = []
    for row in rows:
        for key in row:
            if key not in fields:
                fields.append(key)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for row in rows:
            writer.writerow({field: row.get(field, "") for field in fields})


def write_json(path: Path, payload: Any) -> None:
    path.write_text(json.dumps(to_jsonable(payload), ensure_ascii=False, indent=2), encoding="utf-8")


def complete_subject_rows(rows: list[dict[str, str]]) -> dict[str, dict[str, dict[str, str]]]:
    by_subject: dict[str, dict[str, dict[str, str]]] = defaultdict(dict)
    for row in rows:
        subject = str(row.get("subject") or "").strip()
        density = str(row.get("density") or "").strip()
        if subject and density in DENSITY_LEVELS:
            by_subject[subject][density] = row
    return {
        subject: by_density
        for subject, by_density in sorted(by_subject.items())
        if all(level in by_density for level in DENSITY_LEVELS)
    }


def build_subject_contrast_rows(subjects: dict[str, dict[str, dict[str, str]]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for subject, by_density in subjects.items():
        row: dict[str, Any] = {"subject": subject}
        for metric in (PRIMARY_METRIC, LEGACY_METRIC, *PRIMARY_COMPONENTS):
            values = {level: number(by_density[level].get(metric)) for level in DENSITY_LEVELS}
            if all(value is not None for value in values.values()):
                row[f"{metric}_contrast"] = planned_contrast(values)
                for level in DENSITY_LEVELS:
                    row[f"{metric}_{level}"] = values[level]
        out.append(row)
    return out


def metric_matrix(
    subjects: dict[str, dict[str, dict[str, str]]],
    value_fn: Callable[[dict[str, str]], float | None],
) -> dict[str, dict[str, float]]:
    matrix: dict[str, dict[str, float]] = {}
    raw_by_subject: dict[str, dict[str, dict[str, str]]] = {}
    for subject, by_density in subjects.items():
        values: dict[str, float] = {}
        for density in DENSITY_LEVELS:
            value = value_fn(by_density[density])
            if value is None or not math.isfinite(value):
                values = {}
                break
            values[density] = float(value)
        if values:
            matrix[subject] = values
            raw_by_subject[subject] = by_density
    if value_fn is rank_component_placeholder:
        return rank_component_matrix(raw_by_subject)
    if value_fn is log_z_component_placeholder:
        return log_z_component_matrix(raw_by_subject)
    return matrix


def log_z_component_placeholder(_row: dict[str, str]) -> float | None:
    return 0.0


def rank_component_placeholder(_row: dict[str, str]) -> float | None:
    return 0.0


def log_z_component_matrix(subjects: dict[str, dict[str, dict[str, str]]]) -> dict[str, dict[str, float]]:
    matrix: dict[str, dict[str, float]] = {}
    for subject, by_density in subjects.items():
        scores = {level: [] for level in DENSITY_LEVELS}
        for metric in PRIMARY_COMPONENTS:
            values = {level: log1p_value(by_density[level].get(metric)) for level in DENSITY_LEVELS}
            if any(value is None for value in values.values()):
                scores = {}
                break
            arr = np.asarray([values[level] for level in DENSITY_LEVELS], dtype=float)
            sd = float(np.std(arr, ddof=0))
            if sd <= 0:
                z_values = {level: 0.0 for level in DENSITY_LEVELS}
            else:
                mean = float(np.mean(arr))
                z_values = {level: float((values[level] - mean) / sd) for level in DENSITY_LEVELS}
            for level in DENSITY_LEVELS:
                scores[level].append(z_values[level])
        if scores:
            matrix[subject] = {level: float(np.mean(scores[level])) for level in DENSITY_LEVELS}
    return matrix


def rank_component_matrix(subjects: dict[str, dict[str, dict[str, str]]]) -> dict[str, dict[str, float]]:
    matrix: dict[str, dict[str, float]] = {}
    for subject, by_density in subjects.items():
        scores = {level: [] for level in DENSITY_LEVELS}
        for metric in PRIMARY_COMPONENTS:
            values = {level: number(by_density[level].get(metric)) for level in DENSITY_LEVELS}
            if any(value is None for value in values.values()):
                scores = {}
                break
            sorted_levels = sorted(DENSITY_LEVELS, key=lambda level: (values[level], level))
            ranks = average_ranks([values[level] for level in sorted_levels])
            for level, rank in zip(sorted_levels, ranks):
                scores[level].append(rank)
        if scores:
            matrix[subject] = {level: float(np.mean(scores[level])) for level in DENSITY_LEVELS}
    return matrix


def z_component_matrix(
    subjects: dict[str, dict[str, dict[str, str]]],
    components: tuple[str, ...],
) -> dict[str, dict[str, float]]:
    matrix: dict[str, dict[str, float]] = {}
    for subject, by_density in subjects.items():
        scores = {level: [] for level in DENSITY_LEVELS}
        for metric in components:
            values = {level: number(by_density[level].get(metric)) for level in DENSITY_LEVELS}
            if any(value is None for value in values.values()):
                scores = {}
                break
            arr = np.asarray([values[level] for level in DENSITY_LEVELS], dtype=float)
            sd = float(np.std(arr, ddof=0))
            if sd <= 0:
                z_values = {level: 0.0 for level in DENSITY_LEVELS}
            else:
                mean = float(np.mean(arr))
                z_values = {level: float((values[level] - mean) / sd) for level in DENSITY_LEVELS}
            for level in DENSITY_LEVELS:
                scores[level].append(z_values[level])
        if scores:
            matrix[subject] = {level: float(np.mean(scores[level])) for level in DENSITY_LEVELS}
    return matrix


def build_component_sensitivity_rows(
    subjects: dict[str, dict[str, dict[str, str]]],
    resamples: int,
    permutations: int,
    rng: np.random.Generator,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for dropped in PRIMARY_COMPONENTS:
        kept = tuple(component for component in PRIMARY_COMPONENTS if component != dropped)
        matrix = z_component_matrix(subjects, kept)
        if not matrix:
            continue
        contrasts = {subject: planned_contrast(values) for subject, values in matrix.items()}
        robust = robust_summary(f"h1_drop_{dropped}_index", contrasts, resamples, permutations, rng)
        robust.update(
            {
                "label": f"H1 leave-one-component-out, drop {dropped}",
                "role": "component_sensitivity",
                "components": "+".join(kept),
                "dropped_component": dropped,
                "kept_component_count": len(kept),
            }
        )
        robust.update(label_permutation_summary(matrix, permutations, rng))
        robust.update(leave_one_out_summary(robust["metric"], contrasts))
        rows.append(robust)
    return rows


def average_ranks(values: list[float | None]) -> list[float]:
    pairs = sorted(enumerate(float(value) for value in values), key=lambda item: item[1])
    ranks = [0.0] * len(values)
    cursor = 0
    while cursor < len(pairs):
        end = cursor + 1
        while end < len(pairs) and pairs[end][1] == pairs[cursor][1]:
            end += 1
        rank = (cursor + end - 1) / 2.0
        for index in range(cursor, end):
            ranks[pairs[index][0]] = rank
        cursor = end
    return ranks


def planned_contrast(values: dict[str, float]) -> float:
    return float(sum(CONTRAST_WEIGHTS[level] * values[level] for level in DENSITY_LEVELS))


def robust_summary(
    metric: str,
    contrasts_by_subject: dict[str, float] | list[float],
    resamples: int,
    permutations: int,
    rng: np.random.Generator,
) -> dict[str, Any]:
    if isinstance(contrasts_by_subject, dict):
        values = list(contrasts_by_subject.values())
    else:
        values = list(contrasts_by_subject)
    arr = np.asarray([float(value) for value in values if math.isfinite(float(value))], dtype=float)
    out: dict[str, Any] = {
        "metric": metric,
        "n": int(len(arr)),
        "mean_contrast": "",
        "sd": "",
        "ci95_low": "",
        "ci95_high": "",
        "t": "",
        "p_two_sided": "",
        "p_one_sided_positive": "",
        "cohen_dz": "",
        "median": "",
        "trimmed20_mean": "",
        "bootstrap_ci95_low": "",
        "bootstrap_ci95_high": "",
        "bootstrap_positive_probability": "",
        "sign_p_two_sided": "",
        "wilcoxon_p_two_sided": "",
        "signflip_p_two_sided": "",
        "signflip_p_one_sided_positive": "",
        "positive_count": int(np.sum(arr > 0)) if len(arr) else 0,
        "negative_count": int(np.sum(arr < 0)) if len(arr) else 0,
        "zero_count": int(np.sum(arr == 0)) if len(arr) else 0,
    }
    if len(arr) == 0:
        return out
    mean = float(np.mean(arr))
    out["mean_contrast"] = mean
    out["median"] = float(np.median(arr))
    out["trimmed20_mean"] = trimmed_mean(arr, 0.20)
    out.update(parametric_t_summary(arr))
    out.update(bootstrap_summary(arr, resamples, rng))
    out.update(signflip_summary(arr, permutations, rng))
    nonzero = arr[arr != 0]
    if len(nonzero):
        out["sign_p_two_sided"] = exact_sign_p(int(np.sum(nonzero > 0)), int(len(nonzero)))
        if scipy_stats is not None:
            try:
                out["wilcoxon_p_two_sided"] = float(scipy_stats.wilcoxon(nonzero, alternative="two-sided").pvalue)
            except Exception:
                out["wilcoxon_p_two_sided"] = ""
    return out


def parametric_t_summary(arr: np.ndarray) -> dict[str, Any]:
    out: dict[str, Any] = {"sd": "", "ci95_low": "", "ci95_high": "", "t": "", "p_two_sided": "", "p_one_sided_positive": "", "cohen_dz": ""}
    if len(arr) < 2:
        return out
    mean = float(np.mean(arr))
    sd = float(np.std(arr, ddof=1))
    sem = sd / math.sqrt(len(arr))
    if sd > 0:
        t_value = mean / sem
        p_two = normal_p_two_sided(t_value)
        p_one = 1.0 - normal_cdf(t_value)
        tcrit = 1.96
        if scipy_stats is not None:
            try:
                tcrit = float(scipy_stats.t.ppf(0.975, len(arr) - 1))
                p_two = float(scipy_stats.ttest_1samp(arr, 0.0).pvalue)
                p_one = float(scipy_stats.t.sf(t_value, len(arr) - 1))
            except Exception:
                pass
        out.update(
            {
                "sd": sd,
                "ci95_low": float(mean - tcrit * sem),
                "ci95_high": float(mean + tcrit * sem),
                "t": float(t_value),
                "p_two_sided": p_two,
                "p_one_sided_positive": p_one,
                "cohen_dz": float(mean / sd),
            }
        )
    return out


def bootstrap_summary(arr: np.ndarray, resamples: int, rng: np.random.Generator) -> dict[str, Any]:
    if len(arr) < 2:
        return {}
    indices = rng.integers(0, len(arr), size=(resamples, len(arr)))
    means = np.mean(arr[indices], axis=1)
    return {
        "bootstrap_ci95_low": float(np.percentile(means, 2.5)),
        "bootstrap_ci95_high": float(np.percentile(means, 97.5)),
        "bootstrap_positive_probability": float(np.mean(means > 0)),
    }


def signflip_summary(arr: np.ndarray, permutations: int, rng: np.random.Generator) -> dict[str, Any]:
    if len(arr) < 2:
        return {}
    observed = abs(float(np.mean(arr)))
    signs = rng.choice(np.array([-1.0, 1.0]), size=(permutations, len(arr)))
    null = np.mean(signs * arr, axis=1)
    return {
        "signflip_p_two_sided": float((np.sum(np.abs(null) >= observed) + 1) / (permutations + 1)),
        "signflip_p_one_sided_positive": float((np.sum(null >= float(np.mean(arr))) + 1) / (permutations + 1)),
    }


def label_permutation_summary(
    matrix: dict[str, dict[str, float]],
    permutations: int,
    rng: np.random.Generator,
) -> dict[str, Any]:
    subjects = sorted(matrix)
    if not subjects:
        return {}
    observed = float(np.mean([planned_contrast(matrix[subject]) for subject in subjects]))
    permutations_by_subject = [
        np.asarray(
            [
                values[1] - 0.5 * (values[0] + values[2])
                for values in permuted_value_triplets(matrix[subject])
            ],
            dtype=float,
        )
        for subject in subjects
    ]
    draws = rng.integers(0, 6, size=(permutations, len(subjects)))
    null = np.zeros(permutations, dtype=float)
    for col, permuted_contrasts in enumerate(permutations_by_subject):
        null += permuted_contrasts[draws[:, col]]
    null = null / len(subjects)
    return {
        "label_permutation_p_two_sided": float((np.sum(np.abs(null) >= abs(observed)) + 1) / (permutations + 1)),
        "label_permutation_p_one_sided_positive": float((np.sum(null >= observed) + 1) / (permutations + 1)),
    }


def permuted_value_triplets(values: dict[str, float]) -> list[tuple[float, float, float]]:
    raw = (values["low"], values["medium"], values["high"])
    return [
        (raw[0], raw[1], raw[2]),
        (raw[0], raw[2], raw[1]),
        (raw[1], raw[0], raw[2]),
        (raw[1], raw[2], raw[0]),
        (raw[2], raw[0], raw[1]),
        (raw[2], raw[1], raw[0]),
    ]


def leave_one_out_summary(metric: str, contrasts: dict[str, float] | list[float]) -> dict[str, Any]:
    rows = leave_one_out_rows(metric, contrasts)
    p_values = [number(row.get("p_two_sided")) for row in rows]
    clean_p = [value for value in p_values if value is not None]
    if not rows:
        return {}
    worst = max(rows, key=lambda row: numeric_or_inf(row.get("p_two_sided")))
    best = min(rows, key=lambda row: numeric_or_inf(row.get("p_two_sided")))
    return {
        "loo_n_tests": len(rows),
        "loo_p_lt_05_count": sum(1 for value in clean_p if value < 0.05),
        "loo_max_p": max(clean_p) if clean_p else "",
        "loo_min_p": min(clean_p) if clean_p else "",
        "loo_worst_subject": worst.get("left_out_subject", ""),
        "loo_best_subject": best.get("left_out_subject", ""),
    }


def leave_one_out_rows(metric: str, contrasts: dict[str, float] | list[float]) -> list[dict[str, Any]]:
    if isinstance(contrasts, dict):
        items = [(subject, float(value)) for subject, value in contrasts.items()]
    else:
        items = [(f"index_{index + 1}", float(value)) for index, value in enumerate(contrasts)]
    rows: list[dict[str, Any]] = []
    for index, (subject, _value) in enumerate(items):
        subset = np.asarray([value for item_index, (_subject, value) in enumerate(items) if item_index != index], dtype=float)
        summary = parametric_t_summary(subset)
        rows.append(
            {
                "metric": metric,
                "left_out_subject": subject,
                "n": len(subset),
                "mean_contrast": float(np.mean(subset)) if len(subset) else "",
                "t": summary.get("t", ""),
                "p_two_sided": summary.get("p_two_sided", ""),
                "cohen_dz": summary.get("cohen_dz", ""),
            }
        )
    return rows


def pairwise_summary_rows(
    metric: str,
    matrix: dict[str, dict[str, float]],
    resamples: int,
    rng: np.random.Generator,
) -> list[dict[str, Any]]:
    comparisons = [
        ("medium_minus_low", "medium", "low"),
        ("medium_minus_high", "medium", "high"),
        ("high_minus_low", "high", "low"),
    ]
    rows: list[dict[str, Any]] = []
    for name, a_level, b_level in comparisons:
        diffs = {subject: values[a_level] - values[b_level] for subject, values in matrix.items()}
        summary = robust_summary(f"{metric}:{name}", diffs, resamples, 20000, rng)
        rows.append(
            {
                "metric": metric,
                "comparison": name,
                "a": a_level,
                "b": b_level,
                **{key: value for key, value in summary.items() if key not in {"metric", "label", "role", "components"}},
            }
        )
    return rows


def inverted_u_shape_summary(metric: str, matrix: dict[str, dict[str, float]]) -> dict[str, Any]:
    n = len(matrix)
    medium_peak_count = 0
    medium_gt_low_count = 0
    medium_gt_high_count = 0
    high_gt_low_count = 0
    low_gt_high_count = 0
    both_adjacent_count = 0
    planned_positive_count = 0
    high_low_diffs: list[float] = []
    for values in matrix.values():
        low = values["low"]
        medium = values["medium"]
        high = values["high"]
        medium_gt_low = medium > low
        medium_gt_high = medium > high
        if medium_gt_low:
            medium_gt_low_count += 1
        if medium_gt_high:
            medium_gt_high_count += 1
        if high > low:
            high_gt_low_count += 1
        if low > high:
            low_gt_high_count += 1
        if medium_gt_low and medium_gt_high:
            medium_peak_count += 1
            both_adjacent_count += 1
        if planned_contrast(values) > 0:
            planned_positive_count += 1
        high_low_diffs.append(high - low)
    return {
        "metric": metric,
        "n": n,
        "medium_peak_count": medium_peak_count,
        "medium_peak_ratio": medium_peak_count / n if n else "",
        "medium_peak_binomial_p_one_sided_p0_1_over_3": binomial_tail_p(medium_peak_count, n, 1.0 / 3.0) if n else "",
        "medium_gt_low_count": medium_gt_low_count,
        "medium_gt_low_ratio": medium_gt_low_count / n if n else "",
        "medium_gt_low_binomial_p_one_sided_p0_0_5": binomial_tail_p(medium_gt_low_count, n, 0.5) if n else "",
        "medium_gt_high_count": medium_gt_high_count,
        "medium_gt_high_ratio": medium_gt_high_count / n if n else "",
        "medium_gt_high_binomial_p_one_sided_p0_0_5": binomial_tail_p(medium_gt_high_count, n, 0.5) if n else "",
        "both_adjacent_count": both_adjacent_count,
        "both_adjacent_ratio": both_adjacent_count / n if n else "",
        "planned_positive_count": planned_positive_count,
        "planned_positive_ratio": planned_positive_count / n if n else "",
        "high_gt_low_count": high_gt_low_count,
        "low_gt_high_count": low_gt_high_count,
        "high_low_mean_diff": float(np.mean(high_low_diffs)) if high_low_diffs else "",
        "high_low_abs_mean_diff": float(np.mean(np.abs(high_low_diffs))) if high_low_diffs else "",
    }


def condition_profile_rows(metric: str, matrix: dict[str, dict[str, float]]) -> list[dict[str, Any]]:
    rows = []
    for level in DENSITY_LEVELS:
        arr = np.asarray([values[level] for values in matrix.values()], dtype=float)
        mean_summary = parametric_t_summary(arr)
        rows.append(
            {
                "metric": metric,
                "density": level,
                "n": len(arr),
                "mean": float(np.mean(arr)) if len(arr) else "",
                "ci95_low": mean_summary.get("ci95_low", ""),
                "ci95_high": mean_summary.get("ci95_high", ""),
                "sd": float(np.std(arr, ddof=1)) if len(arr) > 1 else "",
                "median": float(np.median(arr)) if len(arr) else "",
            }
        )
    return rows


def binomial_tail_p(successes: int, n: int, p0: float) -> float:
    if n <= 0:
        return math.nan
    return float(sum(math.comb(n, k) * (p0**k) * ((1.0 - p0) ** (n - k)) for k in range(successes, n + 1)))


def trimmed_mean(arr: np.ndarray, proportion: float) -> float:
    if len(arr) == 0:
        return math.nan
    ordered = np.sort(arr)
    trim = int(math.floor(len(ordered) * proportion))
    if trim == 0:
        return float(np.mean(ordered))
    if len(ordered) <= 2 * trim:
        return float(np.mean(ordered))
    return float(np.mean(ordered[trim:-trim]))


def number(value: Any) -> float | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text or text == "-":
        return None
    try:
        parsed = float(text)
    except ValueError:
        return None
    return parsed if math.isfinite(parsed) else None


def log1p_value(value: Any) -> float | None:
    parsed = number(value)
    if parsed is None:
        return None
    return float(math.log1p(max(parsed, 0.0)))


def exact_sign_p(positive: int, total: int) -> float:
    if total <= 0:
        return 1.0
    tail = min(positive, total - positive)
    probability = sum(math.comb(total, k) for k in range(tail + 1)) / (2**total)
    return min(1.0, 2.0 * probability)


def normal_cdf(value: float) -> float:
    return 0.5 * (1.0 + math.erf(value / math.sqrt(2.0)))


def normal_p_two_sided(t_value: float) -> float:
    return 2.0 * (1.0 - normal_cdf(abs(t_value)))


def numeric_or_inf(value: Any) -> float:
    parsed = number(value)
    return parsed if parsed is not None else math.inf


def to_jsonable(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): to_jsonable(item) for key, item in value.items()}
    if isinstance(value, list):
        return [to_jsonable(item) for item in value]
    if isinstance(value, tuple):
        return [to_jsonable(item) for item in value]
    if isinstance(value, np.generic):
        return value.item()
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return ""
    return value


if __name__ == "__main__":
    main()
