#!/usr/bin/env python
"""Prepare questionnaire scale scores for the Metro Rescue mediation model.

The script keeps the theoretical roles strict:

- M1 perceived reliability comes from per-map questionnaire items.
- On-site A3 signage items are manipulation checks / confirmation-chain closure.
- Subjective correctness items are confidence auxiliaries, not objective accuracy.
- W protective action instruction clarity is a post-all moderator.
- Spatial ability is a covariate; VR discomfort is QC/sensitivity.

If the questionnaire input is not available yet, the script writes a CSV template
and codebook so the real data can be arranged without reworking the analysis.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import re
import statistics
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any


SUPPORT_LEVELS = ("low", "medium", "high")
M1_SCALE = "perceived_reliability_score"
CLOSURE_SCALE = "route_closure_manipulation_check_score"
CONFIDENCE_SCALE = "subjective_route_confidence_score"
W_SCALE = "protective_action_instruction_clarity_score"
SPATIAL_SCALE = "spatial_ability_score"
VR_DISCOMFORT_SCALE = "vr_discomfort_score"
H1_METRIC = "route_confirmation_hesitation_index"
M2_FORMAL = "decision_point_enter_formal_load_delta"
M2_THETA = "decision_point_enter_frontal_theta_delta"

PER_MAP_SCALES = {
    M1_SCALE: {
        "label": "M1 感知可靠性",
        "items": [f"reliability_item_{index}" for index in range(1, 6)],
        "min": 1.0,
        "max": 7.0,
        "role": "formal mediator for low -> medium dominance",
    },
    CLOSURE_SCALE: {
        "label": "A3 现场标识闭合感 / 操纵检查",
        "items": [f"a3_signage_item_{index}" for index in range(1, 5)],
        "min": 1.0,
        "max": 7.0,
        "role": "manipulation check, not M1",
    },
    CONFIDENCE_SCALE: {
        "label": "主观路线正确性 / 信心",
        "items": [f"subjective_correctness_item_{index}" for index in range(1, 4)],
        "min": 1.0,
        "max": 7.0,
        "role": "confidence auxiliary",
    },
}

SUBJECT_SCALES = {
    W_SCALE: {
        "label": "W 保护性行动指令清晰度",
        "items": [f"warning_clarity_item_{index}" for index in range(1, 5)],
        "min": 1.0,
        "max": 7.0,
        "reverse": [],
        "role": "formal subject-level moderator",
    },
    SPATIAL_SCALE: {
        "label": "空间 / 寻路能力",
        "items": [f"spatial_ability_item_{index}" for index in range(1, 8)],
        "min": 1.0,
        "max": 7.0,
        "reverse": ["spatial_ability_item_6", "spatial_ability_item_7"],
        "role": "covariate; items 6-7 are reverse coded",
    },
    VR_DISCOMFORT_SCALE: {
        "label": "VR 身体不适",
        "items": [
            "vr_discomfort_dizziness",
            "vr_discomfort_nausea",
            "vr_discomfort_eye_fatigue",
            "vr_discomfort_headache",
            "vr_discomfort_blurred_vision",
            "vr_discomfort_disorientation",
            "vr_discomfort_neck_discomfort",
            "vr_discomfort_body_fatigue",
        ],
        "min": 0.0,
        "max": 4.0,
        "reverse": [],
        "role": "QC/sensitivity covariate, not mediator",
    },
}

TEMPLATE_COLUMNS = [
    "participant_id",
    "condition",
    "run_order",
    "map_id",
    "reliability_item_1",
    "reliability_item_2",
    "reliability_item_3",
    "reliability_item_4",
    "reliability_item_5",
    "a3_signage_item_1",
    "a3_signage_item_2",
    "a3_signage_item_3",
    "a3_signage_item_4",
    "subjective_correctness_item_1",
    "subjective_correctness_item_2",
    "subjective_correctness_item_3",
    "warning_clarity_item_1",
    "warning_clarity_item_2",
    "warning_clarity_item_3",
    "warning_clarity_item_4",
    "spatial_ability_item_1",
    "spatial_ability_item_2",
    "spatial_ability_item_3",
    "spatial_ability_item_4",
    "spatial_ability_item_5",
    "spatial_ability_item_6",
    "spatial_ability_item_7",
    "vr_discomfort_dizziness",
    "vr_discomfort_nausea",
    "vr_discomfort_eye_fatigue",
    "vr_discomfort_headache",
    "vr_discomfort_blurred_vision",
    "vr_discomfort_disorientation",
    "vr_discomfort_neck_discomfort",
    "vr_discomfort_body_fatigue",
]


def main() -> None:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    parser = argparse.ArgumentParser(description="Score Metro Rescue questionnaire data and prepare mediation-ready tables.")
    parser.add_argument("--input", type=Path, default=Path("work/questionnaire/questionnaire_responses.csv"))
    parser.add_argument("--out-dir", type=Path, default=Path("work/questionnaire"))
    parser.add_argument("--behavior-subjects", type=Path, default=Path("work/xdf_exploration/h1_subject_contrast_details.csv"))
    parser.add_argument("--eeg-subjects", type=Path, default=Path("work/eeg_mne_preprocessing/formal_eeg_subject_contrasts.csv"))
    args = parser.parse_args()

    args.out_dir.mkdir(parents=True, exist_ok=True)
    write_codebook(args.out_dir / "questionnaire_codebook.csv")

    if not args.input.exists():
        write_template(args.out_dir / "questionnaire_template.csv")
        summary = {
            "status": "template_written",
            "message": f"Questionnaire input not found: {args.input}",
            "template": str(args.out_dir / "questionnaire_template.csv"),
            "codebook": str(args.out_dir / "questionnaire_codebook.csv"),
        }
        write_json(args.out_dir / "questionnaire_analysis_summary.json", summary)
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        return

    raw_rows = read_csv(args.input)
    rows = [canonicalize_row(row) for row in raw_rows]
    long_rows = expand_wide_rows(rows)
    per_map_rows = build_per_map_scores(long_rows)
    subject_rows = build_subject_scores(long_rows)
    behavior_by_subject = load_behavior_subjects(args.behavior_subjects)
    eeg_by_subject = load_eeg_subjects(args.eeg_subjects)
    mediation_rows = build_mediation_ready_rows(per_map_rows, subject_rows, behavior_by_subject, eeg_by_subject)
    reliability = build_reliability_summary(long_rows)

    write_csv(args.out_dir / "questionnaire_scale_scores.csv", per_map_rows)
    write_csv(args.out_dir / "questionnaire_subject_covariates.csv", subject_rows)
    write_csv(args.out_dir / "questionnaire_segment_mediation_ready.csv", mediation_rows)

    summary = {
        "status": "scored",
        "input": str(args.input),
        "per_map_rows": len(per_map_rows),
        "subject_rows": len(subject_rows),
        "mediation_ready_rows": len(mediation_rows),
        "behavior_subjects_merged": len(behavior_by_subject),
        "eeg_subjects_merged": len(eeg_by_subject),
        "scale_reliability": reliability,
        "outputs": {
            "scale_scores": str(args.out_dir / "questionnaire_scale_scores.csv"),
            "subject_covariates": str(args.out_dir / "questionnaire_subject_covariates.csv"),
            "segment_mediation_ready": str(args.out_dir / "questionnaire_segment_mediation_ready.csv"),
            "codebook": str(args.out_dir / "questionnaire_codebook.csv"),
        },
    }
    write_json(args.out_dir / "questionnaire_analysis_summary.json", summary)
    print(json.dumps(summary, ensure_ascii=False, indent=2))


def canonicalize_row(row: dict[str, str]) -> dict[str, str]:
    canonical: dict[str, str] = {}
    for key, value in row.items():
        name = canonical_column_name(key)
        canonical[name] = value.strip() if isinstance(value, str) else value
    return canonical


def canonical_column_name(name: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "_", name.strip().lower()).strip("_")
    direct = {
        "participant": "participant_id",
        "subject": "participant_id",
        "subject_id": "participant_id",
        "participant": "participant_id",
        "pid": "participant_id",
        "support": "condition",
        "support_level": "condition",
        "density": "condition",
        "density_level": "condition",
        "route_confirmation_support": "condition",
        "map": "map_id",
        "map_name": "map_id",
    }
    if normalized in direct:
        return direct[normalized]

    item_patterns = [
        (r"^(?:m1|reliability|perceived_reliability|official_chain)_?(?:item_?)?([1-5])$", "reliability_item_{}"),
        (r"^(?:a3|a3_signage|closure|manipulation|signage)_?(?:item_?)?([1-4])$", "a3_signage_item_{}"),
        (r"^(?:confidence|subjective_correctness|subjective_route_confidence)_?(?:item_?)?([1-3])$", "subjective_correctness_item_{}"),
        (r"^(?:w|warning|warning_clarity|protective_action)_?(?:item_?)?([1-4])$", "warning_clarity_item_{}"),
        (r"^(?:spatial|spatial_ability|wayfinding_ability)_?(?:item_?)?([1-7])$", "spatial_ability_item_{}"),
    ]
    for pattern, template in item_patterns:
        match = re.match(pattern, normalized)
        if match:
            return template.format(match.group(1))

    discomfort_aliases = {
        "dizziness": "vr_discomfort_dizziness",
        "vr_dizziness": "vr_discomfort_dizziness",
        "nausea": "vr_discomfort_nausea",
        "vr_nausea": "vr_discomfort_nausea",
        "eye_fatigue": "vr_discomfort_eye_fatigue",
        "vr_eye_fatigue": "vr_discomfort_eye_fatigue",
        "headache": "vr_discomfort_headache",
        "vr_headache": "vr_discomfort_headache",
        "blurred_vision": "vr_discomfort_blurred_vision",
        "vision_blur": "vr_discomfort_blurred_vision",
        "disorientation": "vr_discomfort_disorientation",
        "lost_direction": "vr_discomfort_disorientation",
        "neck_discomfort": "vr_discomfort_neck_discomfort",
        "neck_pain": "vr_discomfort_neck_discomfort",
        "body_fatigue": "vr_discomfort_body_fatigue",
        "physical_fatigue": "vr_discomfort_body_fatigue",
    }
    if normalized in discomfort_aliases:
        return discomfort_aliases[normalized]

    return normalized


def expand_wide_rows(rows: list[dict[str, str]]) -> list[dict[str, str]]:
    if any(normalize_condition(row.get("condition")) for row in rows):
        return rows

    expanded: list[dict[str, str]] = []
    for row in rows:
        for level in SUPPORT_LEVELS:
            next_row = dict(row)
            next_row["condition"] = level
            for source, target in [
                (f"reliability_{level}", M1_SCALE),
                (f"perceived_reliability_{level}", M1_SCALE),
                (f"route_closure_{level}", CLOSURE_SCALE),
                (f"subjective_confidence_{level}", CONFIDENCE_SCALE),
            ]:
                if source in row and row[source] and target not in next_row:
                    next_row[target] = row[source]
            expanded.append(next_row)
    return expanded


def build_per_map_scores(rows: list[dict[str, str]]) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    for row in rows:
        participant_id = normalize_participant_id(row.get("participant_id", ""))
        condition = normalize_condition(row.get("condition", ""))
        if not participant_id or condition not in SUPPORT_LEVELS:
            continue
        scored: dict[str, Any] = {
            "participant_id": participant_id,
            "condition": condition,
            "run_order": row.get("run_order", ""),
            "map_id": row.get("map_id", ""),
        }
        for scale_name, spec in PER_MAP_SCALES.items():
            if row.get(scale_name):
                values = [number(row.get(scale_name))]
                valid_values = [value for value in values if value is not None]
                scored[scale_name] = mean_or_blank(valid_values)
                scored[f"{scale_name}_valid_items"] = len(valid_values)
                continue
            values = scale_values(row, spec["items"], spec["min"], spec["max"], [])
            scored[scale_name] = mean_or_blank(values)
            scored[f"{scale_name}_valid_items"] = len(values)
        output.append(scored)
    return sorted(output, key=lambda item: (item["participant_id"], SUPPORT_LEVELS.index(item["condition"])))


def build_subject_scores(rows: list[dict[str, str]]) -> list[dict[str, Any]]:
    grouped: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in rows:
        participant_id = normalize_participant_id(row.get("participant_id", ""))
        if participant_id:
            grouped[participant_id].append(row)

    output: list[dict[str, Any]] = []
    for participant_id, participant_rows in sorted(grouped.items()):
        scored: dict[str, Any] = {"participant_id": participant_id}
        for scale_name, spec in SUBJECT_SCALES.items():
            row_scores: list[float] = []
            valid_item_counts = 0
            for row in participant_rows:
                if row.get(scale_name):
                    value = number(row.get(scale_name))
                    if value is not None:
                        row_scores.append(value)
                        valid_item_counts += 1
                    continue
                values = scale_values(
                    row,
                    spec["items"],
                    spec["min"],
                    spec["max"],
                    spec.get("reverse", []),
                )
                if values:
                    row_scores.append(sum(values) / len(values))
                    valid_item_counts += len(values)
            scored[scale_name] = mean_or_blank(row_scores)
            scored[f"{scale_name}_valid_items"] = valid_item_counts
        output.append(scored)
    return output


def build_mediation_ready_rows(
    per_map_rows: list[dict[str, Any]],
    subject_rows: list[dict[str, Any]],
    behavior_by_subject: dict[str, dict[str, str]],
    eeg_by_subject: dict[str, dict[str, dict[str, str]]],
) -> list[dict[str, Any]]:
    per_map: dict[str, dict[str, dict[str, Any]]] = defaultdict(dict)
    for row in per_map_rows:
        per_map[row["participant_id"]][row["condition"]] = row
    subject_by_id = {row["participant_id"]: row for row in subject_rows}
    participant_ids = sorted(set(per_map) | set(subject_by_id) | set(behavior_by_subject) | set(eeg_by_subject))
    rows: list[dict[str, Any]] = []

    for participant_id in participant_ids:
        row: dict[str, Any] = {"participant_id": participant_id}
        for level in SUPPORT_LEVELS:
            condition_row = per_map.get(participant_id, {}).get(level, {})
            for scale_name in (M1_SCALE, CLOSURE_SCALE, CONFIDENCE_SCALE):
                row[f"{scale_name}_{level}"] = condition_row.get(scale_name, "")
        add_delta(row, M1_SCALE, "lm", "medium", "low")
        add_delta(row, M1_SCALE, "mh", "medium", "high")
        add_delta(row, CLOSURE_SCALE, "lm", "medium", "low")
        add_delta(row, CLOSURE_SCALE, "mh", "medium", "high")
        add_delta(row, CONFIDENCE_SCALE, "lm", "medium", "low")
        add_delta(row, CONFIDENCE_SCALE, "mh", "medium", "high")

        behavior = behavior_by_subject.get(participant_id, {})
        for level in SUPPORT_LEVELS:
            row[f"{H1_METRIC}_{level}"] = behavior.get(f"{H1_METRIC}_{level}", "")
        row["delta_y_lm"] = subtract(row.get(f"{H1_METRIC}_medium"), row.get(f"{H1_METRIC}_low"))
        row["delta_y_mh"] = subtract(row.get(f"{H1_METRIC}_medium"), row.get(f"{H1_METRIC}_high"))
        row["h1_planned_contrast"] = behavior.get(f"{H1_METRIC}_contrast", "")

        for metric in (M2_FORMAL, M2_THETA):
            eeg = eeg_by_subject.get(participant_id, {}).get(metric, {})
            for level in SUPPORT_LEVELS:
                row[f"{metric}_{level}"] = eeg.get(level, "")
            row[f"{metric}_delta_lm"] = subtract(row.get(f"{metric}_medium"), row.get(f"{metric}_low"))
            row[f"{metric}_delta_mh"] = subtract(row.get(f"{metric}_medium"), row.get(f"{metric}_high"))
            row[f"{metric}_planned_contrast"] = eeg.get("contrast_medium_minus_low_high_mean", "")

        subject = subject_by_id.get(participant_id, {})
        for scale_name in (W_SCALE, SPATIAL_SCALE, VR_DISCOMFORT_SCALE):
            row[scale_name] = subject.get(scale_name, "")
        rows.append(row)
    return rows


def build_reliability_summary(rows: list[dict[str, str]]) -> list[dict[str, Any]]:
    summaries: list[dict[str, Any]] = []
    for scale_name, spec in {**PER_MAP_SCALES, **SUBJECT_SCALES}.items():
        alpha = cronbach_alpha(
            rows,
            spec["items"],
            spec["min"],
            spec["max"],
            spec.get("reverse", []),
        )
        summaries.append(
            {
                "scale": scale_name,
                "label": spec["label"],
                "items": len(spec["items"]),
                "cronbach_alpha": round(alpha, 3) if alpha is not None else None,
                "role": spec["role"],
            }
        )
    return summaries


def add_delta(row: dict[str, Any], scale_name: str, suffix: str, left: str, right: str) -> None:
    row[f"{scale_name}_delta_{suffix}"] = subtract(row.get(f"{scale_name}_{left}"), row.get(f"{scale_name}_{right}"))


def subtract(left: Any, right: Any) -> str:
    left_number = number(left)
    right_number = number(right)
    if left_number is None or right_number is None:
        return ""
    return round(left_number - right_number, 6)


def scale_values(
    row: dict[str, str],
    columns: list[str],
    min_score: float,
    max_score: float,
    reverse_columns: list[str],
) -> list[float]:
    values: list[float] = []
    for column in columns:
        value = number(row.get(column))
        if value is None:
            continue
        if column in reverse_columns:
            value = min_score + max_score - value
        values.append(value)
    return values


def cronbach_alpha(
    rows: list[dict[str, str]],
    columns: list[str],
    min_score: float,
    max_score: float,
    reverse_columns: list[str],
) -> float | None:
    matrix: list[list[float]] = []
    for row in rows:
        values = []
        for column in columns:
            value = number(row.get(column))
            if value is None:
                values = []
                break
            if column in reverse_columns:
                value = min_score + max_score - value
            values.append(value)
        if values:
            matrix.append(values)
    if len(matrix) < 2 or len(columns) < 2:
        return None
    item_variances = [safe_variance([row[index] for row in matrix]) for index in range(len(columns))]
    total_scores = [sum(row) for row in matrix]
    total_variance = safe_variance(total_scores)
    if total_variance is None or total_variance <= 0 or any(value is None for value in item_variances):
        return None
    k = len(columns)
    alpha = (k / (k - 1)) * (1 - (sum(item_variances) / total_variance))
    if not math.isfinite(alpha):
        return None
    return alpha


def safe_variance(values: list[float]) -> float | None:
    if len(values) < 2:
        return None
    return statistics.variance(values)


def load_behavior_subjects(path: Path) -> dict[str, dict[str, str]]:
    if not path.exists():
        return {}
    rows = read_csv(path)
    output: dict[str, dict[str, str]] = {}
    for row in rows:
        subject = normalize_participant_id(row.get("subject", "") or row.get("participant_id", ""))
        if subject:
            output[subject] = row
    return output


def load_eeg_subjects(path: Path) -> dict[str, dict[str, dict[str, str]]]:
    if not path.exists():
        return {}
    rows = read_csv(path)
    output: dict[str, dict[str, dict[str, str]]] = defaultdict(dict)
    for row in rows:
        subject = normalize_participant_id(row.get("subject", "") or row.get("participant_id", ""))
        metric = row.get("metric", "")
        if subject and metric:
            output[subject][metric] = row
    return output


def normalize_participant_id(value: str) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    p_match = re.search(r"p\s*0*(\d{1,3})", text, flags=re.I)
    if p_match:
        return f"P{int(p_match.group(1)):02d}"
    sub_match = re.search(r"sub[-_ ]?0*(\d{1,3})", text, flags=re.I)
    if sub_match:
        sequence = int(sub_match.group(1))
        if sequence >= 1:
            return f"P{((sequence - 1) // 3) + 1:02d}"
    if text.isdigit():
        return f"P{int(text):02d}"
    return text


def normalize_condition(value: str | None) -> str:
    text = str(value or "").strip().lower()
    if not text:
        return ""
    if text in {"low", "l", "1", "signature1", "condition_1"} or "低" in text:
        return "low"
    if text in {"medium", "mid", "m", "2", "signature2", "condition_2"} or "中" in text:
        return "medium"
    if text in {"high", "h", "3", "signature3", "condition_3"} or "高" in text:
        return "high"
    return text


def number(value: Any) -> float | None:
    if value is None:
        return None
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


def mean_or_blank(values: list[float]) -> str | float:
    if not values:
        return ""
    return round(sum(values) / len(values), 6)


def read_csv(path: Path) -> list[dict[str, str]]:
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


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")


def write_template(path: Path) -> None:
    rows = []
    for level in SUPPORT_LEVELS:
        rows.append({column: "" for column in TEMPLATE_COLUMNS} | {"participant_id": "P03", "condition": level})
    write_csv(path, rows)


def write_codebook(path: Path) -> None:
    rows: list[dict[str, Any]] = [
        {
            "column": "participant_id",
            "scale": "identifier",
            "role": "P01-P100 被试编号；sub001 会被换算为 P01。",
            "coding": "P03",
        },
        {
            "column": "condition",
            "scale": "X",
            "role": "路径确认支持水平。",
            "coding": "low / medium / high；也接受 Signature1/2/3 或中文低/中/高。",
        },
    ]
    for scale_name, spec in {**PER_MAP_SCALES, **SUBJECT_SCALES}.items():
        for item in spec["items"]:
            rows.append(
                {
                    "column": item,
                    "scale": scale_name,
                    "role": spec["role"],
                    "coding": f"{int(spec['min'])}-{int(spec['max'])}; reverse coded" if item in spec.get("reverse", []) else f"{int(spec['min'])}-{int(spec['max'])}",
                }
            )
    write_csv(path, rows)


if __name__ == "__main__":
    main()
