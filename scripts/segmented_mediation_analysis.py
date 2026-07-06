#!/usr/bin/env python
"""Run the segmented mediation and W-moderation checks for Metro Rescue.

The script is deliberately strict about the theory:

- H1 uses prompt_to_first_confirmation_s as the primary Y.
- M1 comes from perceived-reliability questionnaire items.
- M2 comes from decision-point EEG load, with frontal theta as the planned
  component and the formal composite as sensitivity.
- W is a subject-level moderator, not a substitute mediator.

When questionnaire data are not available, the script still writes an audit
report. That report records which fields are missing and carries forward the
current H1/EEG evidence, but it does not invent mediation results.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import random
import statistics
import sys
from pathlib import Path
from typing import Any

try:
    import numpy as np
except Exception:  # pragma: no cover - runtime fallback for minimal envs
    np = None  # type: ignore[assignment]

try:
    from scipy import stats as scipy_stats
except Exception:  # pragma: no cover - runtime fallback for minimal envs
    scipy_stats = None  # type: ignore[assignment]


SUPPORT_LEVELS = ("low", "medium", "high")
Y_METRIC = "prompt_to_first_confirmation_s"
M1 = "perceived_reliability_score"
M2_THETA = "decision_point_enter_frontal_theta_delta"
M2_FORMAL = "decision_point_enter_formal_load_delta"
W = "protective_action_instruction_clarity_score"
SPATIAL = "spatial_ability_score"
VR_DISCOMFORT = "vr_discomfort_score"
RNG_SEED = 20260705

SEGMENT_FIELDS = [
    "participant_id",
    f"{M1}_low",
    f"{M1}_medium",
    f"{M1}_high",
    f"{M1}_delta_lm",
    f"{M1}_delta_mh",
    f"{Y_METRIC}_low",
    f"{Y_METRIC}_medium",
    f"{Y_METRIC}_high",
    "delta_y_lm",
    "delta_y_mh",
    "h1_planned_contrast",
    f"{M2_THETA}_low",
    f"{M2_THETA}_medium",
    f"{M2_THETA}_high",
    f"{M2_THETA}_delta_lm",
    f"{M2_THETA}_delta_mh",
    f"{M2_THETA}_planned_contrast",
    f"{M2_FORMAL}_delta_lm",
    f"{M2_FORMAL}_delta_mh",
    f"{M2_FORMAL}_planned_contrast",
    W,
    SPATIAL,
    VR_DISCOMFORT,
]


def main() -> None:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    parser = argparse.ArgumentParser(description="Analyze segmented M1/M2 mediation and W moderation.")
    parser.add_argument("--questionnaire-ready", type=Path, default=Path("work/questionnaire/questionnaire_segment_mediation_ready.csv"))
    parser.add_argument("--out-dir", type=Path, default=Path("work/segmented_mediation"))
    parser.add_argument("--h1-summary", type=Path, default=Path("work/xdf_full_analysis/h1_robustness_summary.json"))
    parser.add_argument("--eeg-summary", type=Path, default=Path("work/eeg_mne_preprocessing/formal_eeg_robustness_results.csv"))
    parser.add_argument("--min-complete", type=int, default=20)
    parser.add_argument("--bootstrap", type=int, default=2000)
    args = parser.parse_args()

    args.out_dir.mkdir(parents=True, exist_ok=True)
    h1_summary = read_json(args.h1_summary)
    eeg_summary = read_csv(args.eeg_summary) if args.eeg_summary.exists() else []

    if not args.questionnaire_ready.exists():
        summary = waiting_summary(args, h1_summary, eeg_summary, reason="questionnaire_ready_file_missing")
        write_outputs(args.out_dir, summary, [], [])
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        return

    rows = read_csv(args.questionnaire_ready)
    audit_rows = build_audit_rows(rows)
    complete_rows = [row for row in rows if row_complete_for_primary_models(row)]

    if len(complete_rows) < args.min_complete:
        summary = waiting_summary(
            args,
            h1_summary,
            eeg_summary,
            reason="insufficient_complete_questionnaire_rows",
            row_count=len(rows),
            complete_row_count=len(complete_rows),
            audit=field_missing_summary(rows),
        )
        write_outputs(args.out_dir, summary, audit_rows, [])
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        return

    prepared_rows = add_centered_terms(complete_rows)
    results = run_models(prepared_rows, bootstrap_n=args.bootstrap)
    summary = {
        "status": "analyzed",
        "questionnaire_ready": str(args.questionnaire_ready),
        "row_count": len(rows),
        "complete_row_count": len(prepared_rows),
        "h1_primary_metric": Y_METRIC,
        "m1_mediator": M1,
        "m2_primary": M2_THETA,
        "m2_sensitivity": M2_FORMAL,
        "w_moderator": W,
        "existing_h1": compact_h1(h1_summary),
        "existing_eeg": compact_eeg(eeg_summary),
        "models": results,
    }
    result_rows = flatten_results(results)
    write_outputs(args.out_dir, summary, audit_rows, result_rows)
    print(json.dumps(summary, ensure_ascii=False, indent=2))


def waiting_summary(
    args: argparse.Namespace,
    h1_summary: dict[str, Any],
    eeg_summary: list[dict[str, str]],
    reason: str,
    row_count: int = 0,
    complete_row_count: int = 0,
    audit: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    return {
        "status": "waiting_for_questionnaire",
        "reason": reason,
        "questionnaire_ready": str(args.questionnaire_ready),
        "row_count": row_count,
        "complete_row_count": complete_row_count,
        "minimum_complete_rows": args.min_complete,
        "h1_primary_metric": Y_METRIC,
        "m1_mediator": M1,
        "m2_primary": M2_THETA,
        "m2_sensitivity": M2_FORMAL,
        "w_moderator": W,
        "required_fields": SEGMENT_FIELDS,
        "field_audit": audit or [],
        "existing_h1": compact_h1(h1_summary),
        "existing_eeg": compact_eeg(eeg_summary),
        "interpretation_boundary": "问卷 M1 和 W 未接入前，只能报告 H1 主效应、正确率辅助结果和 EEG M2 过程证据；不能写完整中介或调节已经成立。",
    }


def compact_h1(summary: dict[str, Any]) -> dict[str, Any]:
    primary = summary.get("primary_result", {}) if isinstance(summary, dict) else {}
    shape = summary.get("shape_result", {}) if isinstance(summary, dict) else {}
    return {
        "n": primary.get("n"),
        "contrast": primary.get("mean_contrast"),
        "ci95": [primary.get("ci95_low"), primary.get("ci95_high")],
        "p_two_sided": primary.get("p_two_sided"),
        "dz": primary.get("cohen_dz"),
        "medium_peak_count": shape.get("medium_peak_count"),
        "medium_gt_high_count": shape.get("medium_gt_high_count"),
    }


def compact_eeg(rows: list[dict[str, str]]) -> list[dict[str, Any]]:
    keep = {M2_THETA, M2_FORMAL}
    output = []
    for row in rows:
        if row.get("metric") not in keep:
            continue
        output.append(
            {
                "metric": row.get("metric"),
                "n": maybe_number(row.get("n")),
                "contrast": maybe_number(row.get("mean_contrast")),
                "ci95": [maybe_number(row.get("ci95_low")), maybe_number(row.get("ci95_high"))],
                "p_two_sided": maybe_number(row.get("p_two_sided")),
                "dz": maybe_number(row.get("dz")),
            }
        )
    return output


def build_audit_rows(rows: list[dict[str, str]]) -> list[dict[str, Any]]:
    if not rows:
        return [{"field": field, "present_rows": 0, "missing_rows": 0, "complete_rate": ""} for field in SEGMENT_FIELDS]
    output = []
    for field in SEGMENT_FIELDS:
        present = sum(1 for row in rows if number(row.get(field)) is not None or (field == "participant_id" and row.get(field)))
        missing = len(rows) - present
        output.append(
            {
                "field": field,
                "present_rows": present,
                "missing_rows": missing,
                "complete_rate": round(present / len(rows), 6),
            }
        )
    return output


def field_missing_summary(rows: list[dict[str, str]]) -> list[dict[str, Any]]:
    return [row for row in build_audit_rows(rows) if row["missing_rows"]]


def row_complete_for_primary_models(row: dict[str, str]) -> bool:
    required = [
        "participant_id",
        f"{M1}_delta_lm",
        f"{M1}_delta_mh",
        "delta_y_lm",
        "delta_y_mh",
        f"{M2_THETA}_delta_lm",
        f"{M2_THETA}_delta_mh",
        W,
        SPATIAL,
        VR_DISCOMFORT,
    ]
    for field in required:
        if field == "participant_id":
            if not row.get(field):
                return False
        elif number(row.get(field)) is None:
            return False
    return True


def add_centered_terms(rows: list[dict[str, str]]) -> list[dict[str, Any]]:
    numeric_rows: list[dict[str, Any]] = []
    numeric_fields = [
        f"{M1}_delta_lm",
        f"{M1}_delta_mh",
        f"{M2_THETA}_delta_lm",
        f"{M2_THETA}_delta_mh",
        f"{M2_FORMAL}_delta_lm",
        f"{M2_FORMAL}_delta_mh",
        "delta_y_lm",
        "delta_y_mh",
        "h1_planned_contrast",
        W,
        SPATIAL,
        VR_DISCOMFORT,
    ]
    for row in rows:
        next_row: dict[str, Any] = {"participant_id": row.get("participant_id", "")}
        for field in numeric_fields:
            next_row[field] = number(row.get(field))
        numeric_rows.append(next_row)

    for field in numeric_fields:
        values = [row[field] for row in numeric_rows if row.get(field) is not None]
        if not values:
            continue
        mean_value = sum(values) / len(values)
        for row in numeric_rows:
            value = row.get(field)
            row[f"{field}_c"] = value - mean_value if value is not None else None

    for row in numeric_rows:
        row["m1_lm_x_w"] = product(row.get(f"{M1}_delta_lm_c"), row.get(f"{W}_c"))
        row["m1_mh_x_w"] = product(row.get(f"{M1}_delta_mh_c"), row.get(f"{W}_c"))
        row["m2_theta_lm_x_w"] = product(row.get(f"{M2_THETA}_delta_lm_c"), row.get(f"{W}_c"))
        row["m2_theta_mh_x_w"] = product(row.get(f"{M2_THETA}_delta_mh_c"), row.get(f"{W}_c"))
    return numeric_rows


def run_models(rows: list[dict[str, Any]], bootstrap_n: int) -> dict[str, Any]:
    segment_lm = run_segment(
        rows=rows,
        segment="low_to_medium",
        y="delta_y_lm",
        mediator=f"{M1}_delta_lm",
        mediator_label="M1 perceived reliability",
        moderation_predictors=[f"{M1}_delta_lm_c", f"{W}_c", "m1_lm_x_w", f"{SPATIAL}_c", f"{VR_DISCOMFORT}_c"],
        bootstrap_n=bootstrap_n,
    )
    segment_mh_theta = run_segment(
        rows=rows,
        segment="medium_to_high",
        y="delta_y_mh",
        mediator=f"{M2_THETA}_delta_mh",
        mediator_label="M2 frontal theta",
        moderation_predictors=[f"{M2_THETA}_delta_mh_c", f"{W}_c", "m2_theta_mh_x_w", f"{SPATIAL}_c", f"{VR_DISCOMFORT}_c"],
        bootstrap_n=bootstrap_n,
    )
    segment_mh_formal = run_segment(
        rows=rows,
        segment="medium_to_high_sensitivity",
        y="delta_y_mh",
        mediator=f"{M2_FORMAL}_delta_mh",
        mediator_label="M2 formal EEG load",
        moderation_predictors=[f"{M2_FORMAL}_delta_mh_c", f"{W}_c", f"{SPATIAL}_c", f"{VR_DISCOMFORT}_c"],
        bootstrap_n=bootstrap_n,
    )
    h1_w = ols_model(rows, "h1_planned_contrast", [f"{W}_c", f"{SPATIAL}_c", f"{VR_DISCOMFORT}_c"])
    return {
        "low_to_medium_m1_dominance": segment_lm,
        "medium_to_high_m2_theta_dominance": segment_mh_theta,
        "medium_to_high_m2_formal_sensitivity": segment_mh_formal,
        "h1_planned_contrast_w_moderation": h1_w,
    }


def run_segment(
    rows: list[dict[str, Any]],
    segment: str,
    y: str,
    mediator: str,
    mediator_label: str,
    moderation_predictors: list[str],
    bootstrap_n: int,
) -> dict[str, Any]:
    mediator_values = numeric_values(rows, mediator)
    y_values = numeric_values(rows, y)
    a_path = one_sample_summary(mediator_values)
    y_delta = one_sample_summary(y_values)
    b_model = ols_model(rows, y, [f"{mediator}_c", f"{SPATIAL}_c", f"{VR_DISCOMFORT}_c"])
    moderated_model = ols_model(rows, y, moderation_predictors)
    b = coefficient_value(b_model, f"{mediator}_c")
    indirect = None if a_path.get("mean") is None or b is None else a_path["mean"] * b
    indirect_ci = bootstrap_indirect(rows, y, mediator, bootstrap_n)
    return {
        "segment": segment,
        "mediator": mediator,
        "mediator_label": mediator_label,
        "outcome_delta": y,
        "a_path_delta_summary": a_path,
        "y_delta_summary": y_delta,
        "b_path_model": b_model,
        "moderated_model": moderated_model,
        "indirect_product_proxy": indirect,
        "indirect_bootstrap_ci95": indirect_ci,
        "interpretation_rule": "方向只在该段内解释；不要把 low->medium 的 M1 结论外推到 medium->high，也不要把 medium->high 的 M2 结论外推到 low->medium。",
    }


def one_sample_summary(values: list[float]) -> dict[str, Any]:
    if not values:
        return {"n": 0, "mean": None, "sd": None, "t": None, "p_two_sided": None, "ci95": [None, None]}
    n = len(values)
    mean_value = sum(values) / n
    if n < 2:
        return {"n": n, "mean": mean_value, "sd": None, "t": None, "p_two_sided": None, "ci95": [None, None]}
    sd = statistics.stdev(values)
    se = sd / math.sqrt(n) if sd else 0.0
    if se == 0:
        t_value = math.inf if mean_value > 0 else (-math.inf if mean_value < 0 else 0.0)
        p_value = 0.0 if mean_value else 1.0
        ci = [mean_value, mean_value]
    else:
        t_value = mean_value / se
        p_value = two_sided_t_p(t_value, n - 1)
        t_crit = t_ppf(0.975, n - 1)
        ci = [mean_value - t_crit * se, mean_value + t_crit * se]
    return {
        "n": n,
        "mean": round(mean_value, 6),
        "sd": round(sd, 6),
        "t": round(t_value, 6) if math.isfinite(t_value) else t_value,
        "p_two_sided": p_value,
        "ci95": [round(ci[0], 6), round(ci[1], 6)],
    }


def ols_model(rows: list[dict[str, Any]], y_field: str, predictors: list[str]) -> dict[str, Any]:
    if np is None:
        return {"status": "skipped", "reason": "numpy_not_available", "y": y_field, "predictors": predictors}
    model_rows = []
    for row in rows:
        y_value = row.get(y_field)
        x_values = [row.get(field) for field in predictors]
        if y_value is None or any(value is None for value in x_values):
            continue
        model_rows.append((float(y_value), [float(value) for value in x_values]))
    n = len(model_rows)
    k = len(predictors) + 1
    if n <= k:
        return {"status": "insufficient_df", "n": n, "y": y_field, "predictors": predictors}

    y = np.array([item[0] for item in model_rows], dtype=float)
    x = np.array([[1.0] + item[1] for item in model_rows], dtype=float)
    try:
        beta = np.linalg.lstsq(x, y, rcond=None)[0]
        residuals = y - x @ beta
        df = n - k
        sigma2 = float((residuals @ residuals) / df)
        xtx_inv = np.linalg.pinv(x.T @ x)
        covariance = sigma2 * xtx_inv
        se = np.sqrt(np.diag(covariance))
        t_values = beta / se
    except Exception as exc:
        return {"status": "failed", "reason": str(exc), "n": n, "y": y_field, "predictors": predictors}

    coefficients = []
    names = ["intercept"] + predictors
    for name, coef, coef_se, t_value in zip(names, beta, se, t_values):
        p_value = two_sided_t_p(float(t_value), df)
        coefficients.append(
            {
                "term": name,
                "estimate": round(float(coef), 6),
                "se": round(float(coef_se), 6),
                "t": round(float(t_value), 6),
                "p_two_sided": p_value,
            }
        )
    ss_res = float(residuals @ residuals)
    ss_tot = float(((y - y.mean()) @ (y - y.mean())))
    r2 = None if ss_tot <= 0 else 1 - ss_res / ss_tot
    return {
        "status": "ok",
        "n": n,
        "df": df,
        "y": y_field,
        "predictors": predictors,
        "r2": round(r2, 6) if r2 is not None else None,
        "coefficients": coefficients,
    }


def bootstrap_indirect(rows: list[dict[str, Any]], y: str, mediator: str, bootstrap_n: int) -> dict[str, Any]:
    if bootstrap_n <= 0 or np is None:
        return {"status": "skipped"}
    usable = [row for row in rows if row.get(y) is not None and row.get(mediator) is not None]
    if len(usable) < 10:
        return {"status": "insufficient_n", "n": len(usable)}
    rng = random.Random(RNG_SEED)
    estimates: list[float] = []
    for _ in range(bootstrap_n):
        sample = [usable[rng.randrange(len(usable))] for _ in usable]
        centered = add_centered_terms([{key: str(value) if value is not None else "" for key, value in row.items()} for row in sample])
        a_values = numeric_values(centered, mediator)
        model = ols_model(centered, y, [f"{mediator}_c", f"{SPATIAL}_c", f"{VR_DISCOMFORT}_c"])
        b = coefficient_value(model, f"{mediator}_c")
        if not a_values or b is None:
            continue
        estimates.append((sum(a_values) / len(a_values)) * b)
    if not estimates:
        return {"status": "failed"}
    estimates.sort()
    return {
        "status": "ok",
        "n_bootstrap": len(estimates),
        "ci95": [round(percentile(estimates, 2.5), 6), round(percentile(estimates, 97.5), 6)],
        "positive_probability": round(sum(1 for value in estimates if value > 0) / len(estimates), 6),
    }


def coefficient_value(model: dict[str, Any], term: str) -> float | None:
    for coefficient in model.get("coefficients", []):
        if coefficient.get("term") == term:
            return number(coefficient.get("estimate"))
    return None


def numeric_values(rows: list[dict[str, Any]], field: str) -> list[float]:
    values = []
    for row in rows:
        value = number(row.get(field))
        if value is not None:
            values.append(value)
    return values


def product(left: Any, right: Any) -> float | None:
    left_number = number(left)
    right_number = number(right)
    if left_number is None or right_number is None:
        return None
    return left_number * right_number


def flatten_results(results: dict[str, Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for model_name, model in results.items():
        if "coefficients" in model:
            for coefficient in model.get("coefficients", []):
                rows.append({"model": model_name, **coefficient})
            continue
        if isinstance(model, dict):
            rows.append(
                {
                    "model": model_name,
                    "term": "a_path_delta_mean",
                    "estimate": nested(model, "a_path_delta_summary", "mean"),
                    "p_two_sided": nested(model, "a_path_delta_summary", "p_two_sided"),
                }
            )
            rows.append(
                {
                    "model": model_name,
                    "term": "indirect_product_proxy",
                    "estimate": model.get("indirect_product_proxy"),
                    "p_two_sided": "",
                }
            )
            for coefficient in model.get("b_path_model", {}).get("coefficients", []):
                rows.append({"model": f"{model_name}: b_path", **coefficient})
            for coefficient in model.get("moderated_model", {}).get("coefficients", []):
                rows.append({"model": f"{model_name}: W_interaction", **coefficient})
    return rows


def nested(value: dict[str, Any], *keys: str) -> Any:
    current: Any = value
    for key in keys:
        if not isinstance(current, dict):
            return None
        current = current.get(key)
    return current


def write_outputs(out_dir: Path, summary: dict[str, Any], audit_rows: list[dict[str, Any]], result_rows: list[dict[str, Any]]) -> None:
    write_json(out_dir / "segmented_mediation_results.json", summary)
    write_csv(out_dir / "segmented_mediation_ready_audit.csv", audit_rows)
    write_csv(out_dir / "segmented_mediation_results.csv", result_rows)
    write_report(out_dir / "segmented_mediation_report.md", summary)


def write_report(path: Path, summary: dict[str, Any]) -> None:
    h1 = summary.get("existing_h1", {})
    lines = [
        "# 分段并行中介与 W 调节分析记录",
        "",
        f"状态：{summary.get('status')}",
        "",
        "## 当前能写的结论",
        "",
        f"- H1 主指标固定为 `{Y_METRIC}`，中文写作使用“官方提示到首次现场路径确认延迟”。",
        f"- 当前 H1 planned contrast 为 {format_number(h1.get('contrast'))} 秒，95% CI {format_ci(h1.get('ci95'))}，p={format_p(h1.get('p_two_sided'))}。",
        "- M1 必须来自感知可靠性问卷；问卷未接入时，不写完整中介成立。",
        f"- M2 使用 `{M2_THETA}` 作为 planned EEG 过程证据，`{M2_FORMAL}` 作为敏感性指标。",
        "",
        "## 分段模型",
        "",
        "- 低支持到中等支持：`delta_y_lm = Y_medium - Y_low`，主导中介为 `perceived_reliability_score_delta_lm`。",
        "- 中等支持到高支持：`delta_y_mh = Y_medium - Y_high`，主导中介为 `decision_point_enter_frontal_theta_delta_delta_mh`。",
        "- W 使用 `protective_action_instruction_clarity_score`。交互项只解释调节，不替代 M1 或 M2。",
        "",
    ]
    if summary.get("status") == "waiting_for_questionnaire":
        lines.extend(
            [
                "## 还缺什么",
                "",
                f"原因：{summary.get('reason')}",
                f"完整行数：{summary.get('complete_row_count')} / {summary.get('row_count')}，最低要求 {summary.get('minimum_complete_rows')}。",
                "",
                "把真实问卷整理到 `work/questionnaire/questionnaire_responses.csv` 后，先运行 `scripts/questionnaire_integration.py`，再运行本脚本。",
            ]
        )
    else:
        lines.extend(["## 模型结果", "", "结果已写入 `segmented_mediation_results.csv` 和 `segmented_mediation_results.json`。"])
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def format_number(value: Any) -> str:
    parsed = number(value)
    if parsed is None:
        return "NA"
    return f"{parsed:.3f}"


def format_ci(value: Any) -> str:
    if not isinstance(value, list) or len(value) != 2:
        return "[NA, NA]"
    return f"[{format_number(value[0])}, {format_number(value[1])}]"


def format_p(value: Any) -> str:
    parsed = number(value)
    if parsed is None:
        return "NA"
    if parsed < 0.001:
        return "<.001"
    return f"{parsed:.3f}".lstrip("0")


def read_csv(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        return []
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames: list[str] = []
    for row in rows:
        for key in row:
            if key not in fieldnames:
                fieldnames.append(key)
    if not fieldnames:
        fieldnames = ["status"]
        rows = [{"status": "no_rows"}]
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")


def maybe_number(value: Any) -> float | None:
    parsed = number(value)
    return round(parsed, 6) if parsed is not None else None


def number(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        parsed = float(value)
    else:
        text = str(value).strip()
        if not text:
            return None
        try:
            parsed = float(text)
        except ValueError:
            return None
    if not math.isfinite(parsed):
        return None
    return parsed


def two_sided_t_p(t_value: float, df: int) -> float | None:
    if df <= 0 or not math.isfinite(t_value):
        return None
    if scipy_stats is not None:
        return float(2 * scipy_stats.t.sf(abs(t_value), df))
    return float(2 * (1 - normal_cdf(abs(t_value))))


def t_ppf(probability: float, df: int) -> float:
    if scipy_stats is not None:
        return float(scipy_stats.t.ppf(probability, df))
    return 1.96


def normal_cdf(value: float) -> float:
    return 0.5 * (1 + math.erf(value / math.sqrt(2)))


def percentile(values: list[float], percentile_value: float) -> float:
    if not values:
        return math.nan
    if len(values) == 1:
        return values[0]
    position = (len(values) - 1) * percentile_value / 100
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return values[int(position)]
    weight = position - lower
    return values[lower] * (1 - weight) + values[upper] * weight


if __name__ == "__main__":
    main()
