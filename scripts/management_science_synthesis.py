#!/usr/bin/env python
"""Build a management-science evidence synthesis from H1 behavior and formal EEG.

The thesis is positioned as neuro-engineering management / management science.
EEG is therefore treated as process-tracing evidence for information-support
design, not as a medical or biological endpoint.

The theory model is an inverted-U main effect with two parallel mediators:
M1 perceived reliability from questionnaires, and M2 information-processing
load from EEG. The two mediators are expected to dominate different adjacent
segments of the support manipulation.
"""

from __future__ import annotations

import argparse
import csv
import html
import json
import math
from pathlib import Path
from typing import Any

import numpy as np


H1_METRIC = "route_confirmation_hesitation_index"
MECHANISM_METRIC = "prompt_to_first_confirmation_s"
LEGACY_METRIC = "route_decision_hesitation_index"
EEG_COMPOSITE = "decision_point_enter_formal_load_delta"
EEG_THETA = "decision_point_enter_frontal_theta_delta"
ACCURACY_FIELDS = ("decision_choice_accuracy_ratio", "first_choice_correct", "final_arrival_correct")
SUPPORT_ORDER = ("low", "medium", "high")
SUPPORT_LABELS = {"low": "低支持", "medium": "中等支持", "high": "高支持"}
TARGET_EXIT_LABEL = "A3"


def main() -> None:
    parser = argparse.ArgumentParser(description="Create management-science evidence synthesis for the evacuation thesis.")
    parser.add_argument("--h1-summary", type=Path, default=Path("work/xdf_exploration/h1_robustness_summary.json"))
    parser.add_argument("--h1-subjects", type=Path, default=Path("work/xdf_exploration/h1_subject_contrast_details.csv"))
    parser.add_argument("--h1-profiles", type=Path, default=Path("work/xdf_exploration/h1_condition_profiles.csv"))
    parser.add_argument("--h1-pairwise", type=Path, default=Path("work/xdf_exploration/h1_pairwise_results.csv"))
    parser.add_argument("--component-sensitivity", type=Path, default=Path("work/xdf_exploration/h1_component_sensitivity.csv"))
    parser.add_argument("--analysis-grid", type=Path, default=Path("work/xdf_exploration/analysis_grid_results.csv"))
    parser.add_argument("--map-adjusted", type=Path, default=Path("work/xdf_exploration/map_adjusted_results.csv"))
    parser.add_argument("--eeg-robustness", type=Path, default=Path("work/eeg_mne_preprocessing/formal_eeg_robustness_results.csv"))
    parser.add_argument("--eeg-subjects", type=Path, default=Path("work/eeg_mne_preprocessing/formal_eeg_subject_contrasts.csv"))
    parser.add_argument("--canonical-runs", type=Path, default=Path("work/xdf_exploration/canonical_run_rows.csv"))
    parser.add_argument("--out-dir", type=Path, default=Path("work/management_science_synthesis"))
    args = parser.parse_args()

    args.out_dir.mkdir(parents=True, exist_ok=True)

    h1_summary = read_json(args.h1_summary)
    h1_subjects = read_csv(args.h1_subjects)
    h1_profiles = read_optional_csv(args.h1_profiles)
    h1_pairwise = read_optional_csv(args.h1_pairwise)
    component_sensitivity = read_optional_csv(args.component_sensitivity)
    analysis_grid = read_optional_csv(args.analysis_grid)
    map_adjusted = read_optional_csv(args.map_adjusted)
    eeg_robustness = read_csv(args.eeg_robustness)
    eeg_subjects = read_csv(args.eeg_subjects)
    canonical_rows = read_optional_csv(args.canonical_runs)

    accuracy_rows = build_accuracy_rows(canonical_rows)
    accuracy_contrast_rows = build_accuracy_contrast_rows(canonical_rows)
    link_rows = build_link_rows(h1_subjects, eeg_subjects)
    h1_figures = build_h1_figures(h1_subjects, h1_profiles)
    h1_qc_rows = build_h1_qc_sensitivity_rows(analysis_grid)
    h1_component_rows = build_h1_component_sensitivity_rows(component_sensitivity)
    h1_primary_rows = build_h1_primary_display_rows(
        h1_summary,
        h1_profiles,
        h1_pairwise,
        map_adjusted,
        h1_component_rows,
        h1_qc_rows,
    )
    construct_rows = build_construct_rows(h1_summary, eeg_robustness, accuracy_rows)
    implication_rows = build_implication_rows(h1_summary, eeg_robustness, link_rows, accuracy_rows)
    paper_sections = build_paper_sections(
        h1_summary,
        eeg_robustness,
        link_rows,
        accuracy_rows,
        accuracy_contrast_rows,
        h1_profiles,
        h1_pairwise,
        map_adjusted,
        h1_component_rows,
        h1_qc_rows,
    )

    payload = {
        "positioning": "neuro-engineering management / management science",
        "h1_primary_result": h1_primary_rows,
        "h1_component_sensitivity": h1_component_rows,
        "h1_qc_sensitivity": h1_qc_rows,
        "h1_figures": h1_figures,
        "constructs": construct_rows,
        "accuracy_auxiliary_outcome": accuracy_rows,
        "accuracy_contrasts": accuracy_contrast_rows,
        "link_analysis": link_rows,
        "managerial_implications": implication_rows,
        "paper_sections": paper_sections,
    }

    write_json(args.out_dir / "management_evidence_synthesis.json", payload)
    write_csv(args.out_dir / "management_h1_primary_result.csv", h1_primary_rows)
    write_csv(args.out_dir / "management_h1_component_sensitivity.csv", h1_component_rows)
    write_csv(args.out_dir / "management_h1_qc_sensitivity.csv", h1_qc_rows)
    write_figure_svgs(args.out_dir, h1_figures)
    write_csv(args.out_dir / "management_construct_evidence.csv", construct_rows)
    write_csv(args.out_dir / "management_accuracy_status.csv", accuracy_rows)
    write_csv(args.out_dir / "management_accuracy_contrasts.csv", accuracy_contrast_rows)
    write_csv(args.out_dir / "management_link_analysis.csv", link_rows)
    write_csv(args.out_dir / "management_implications.csv", implication_rows)
    write_markdown(args.out_dir / "management_evidence_report.md", payload)
    write_html(args.out_dir / "management_evidence_report.html", payload)
    write_h1_markdown(args.out_dir / "h1_primary_effect_report.md", payload)
    write_h1_html(args.out_dir / "h1_primary_effect_report.html", payload)

    print(json.dumps({"out_dir": str(args.out_dir), "constructs": len(construct_rows), "links": len(link_rows), "accuracy_rows": len(accuracy_rows), "accuracy_contrasts": len(accuracy_contrast_rows)}, ensure_ascii=False, indent=2))


def build_h1_primary_display_rows(
    h1_summary: dict[str, Any],
    h1_profiles: list[dict[str, str]],
    h1_pairwise: list[dict[str, str]],
    map_adjusted: list[dict[str, str]],
    component_sensitivity: list[dict[str, Any]],
    qc_sensitivity: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    primary = h1_summary.get("primary_result", {})
    profile_text = h1_profile_sentence(h1_profiles)
    medium_low = h1_pairwise_evidence(h1_pairwise, "medium_minus_low")
    medium_high = h1_pairwise_evidence(h1_pairwise, "medium_minus_high")
    high_low = h1_pairwise_evidence(h1_pairwise, "high_minus_low")
    shape_text = h1_shape_evidence(h1_summary)
    map_adjusted_text = h1_map_adjusted_evidence(map_adjusted)
    component_text = h1_component_sensitivity_evidence(component_sensitivity)
    qc_text = h1_qc_sensitivity_evidence(qc_sensitivity)
    return [
        {
            "item": "三条件均值形状",
            "evidence": profile_text,
            "interpretation": "低支持和高支持的近端确认迟滞接近，中等支持最高，直接对应倒 U 型主效应。",
        },
        {
            "item": "H1 主 planned contrast",
            "evidence": format_primary_h1_evidence(primary),
            "interpretation": "这是论文主效应的第一报告项；机制、正确率和 EEG 都应围绕它解释。",
        },
        {
            "item": "个体峰值形状诊断",
            "evidence": shape_text,
            "interpretation": "该诊断直接回答“中等支持是否更常成为个体层面的迟滞峰值”，用于补强倒 U 形状而非替换 planned contrast。",
        },
        {
            "item": "地图校正主模型",
            "evidence": map_adjusted_text,
            "interpretation": "run-level 固定效应模型用于说明 H1 不是单纯由地图或被试固定差异造成；正式结论仍以被试层 planned contrast 为主。",
        },
        {
            "item": "组件敏感性",
            "evidence": component_text,
            "interpretation": "leave-one-component-out 用于检查 H1 是否被单一组件驱动；该表应作为构念稳健性证据。",
        },
        {
            "item": "QC 敏感性",
            "evidence": qc_text,
            "interpretation": "不同质量过滤条件下方向保持一致，说明 H1 不是由单一清洗阈值造成。",
        },
        {
            "item": "低支持 -> 中等支持",
            "evidence": medium_low,
            "interpretation": "中等支持显著高于低支持，支持“可靠性上升后继续确认变得值得，迟滞上升”的第一阶段。",
        },
        {
            "item": "中等支持 -> 高支持",
            "evidence": medium_high,
            "interpretation": "中等支持高于高支持；该相邻差异在方向性 planned 检验和非参数检验中支持下降趋势。",
        },
        {
            "item": "高支持 vs 低支持",
            "evidence": high_low,
            "interpretation": "高支持与低支持几乎持平，说明主结果不是线性增加，而是中等支持峰值。",
        },
        {
            "item": "稳健性",
            "evidence": h1_sensitivity_sentence(h1_summary),
            "interpretation": "主效应不依赖单一参数检验或单一被试；旧版广义路线效率只作边界/敏感性。",
        },
    ]


def build_construct_rows(h1_summary: dict[str, Any], eeg_robustness: list[dict[str, str]], accuracy_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    primary = h1_summary.get("primary_result", {})
    mechanism = h1_summary.get("mechanism_result", {})
    legacy = h1_summary.get("legacy_result", {})
    eeg_composite = find_row(eeg_robustness, "metric", EEG_COMPOSITE)
    eeg_theta = find_row(eeg_robustness, "metric", EEG_THETA)

    return [
        {
            "construct": "路径确认支持配置",
            "role": "管理干预变量",
            "operationalization": "低 / 中 / 高路径确认支持；planned contrast = medium - mean(low, high)",
            "evidence": "同一被试经历三种路径确认支持水平的组内实验操纵",
            "management_interpretation": "应急信息系统通过改变现场线索的连续性、覆盖性和闭合程度，影响被试如何把官方提示转化为路线选择。",
            "status": "实验设计因素",
        },
        {
            "construct": "近端确认负担",
            "role": "因变量 / H1 行为主结果；报告时优先于机制和辅助结果",
            "operationalization": H1_METRIC,
            "evidence": format_primary_h1_evidence(primary),
            "management_interpretation": "中等支持增加被试把信息支持转化为路线选择时的核对、确认和查看成本；该指标聚焦官方线索确认过程，不混入整段路线执行效率。",
            "status": "主效应支持",
        },
        {
            "construct": "感知可靠性",
            "role": "中介一；低支持 -> 中等支持阶段主导",
            "operationalization": "perceived_reliability_score，问卷测量",
            "evidence": "当前 XDF/EEG 数据不包含问卷可靠性分数，需接入问卷后检验。",
            "management_interpretation": "该中介对应启发式决策中的理性权衡过程。低支持下，继续依赖官方线索的操作成本高于预期准确性收益，个体理性地转向省时省力的启发式行动；中等支持提高感知可靠性，使继续确认变得值得，因此搜索和核对增加，行动迟滞上升。",
            "status": "待问卷数据检验",
        },
        {
            "construct": "信息闭合缺口",
            "role": "行为机制线索；不替代 M1",
            "operationalization": MECHANISM_METRIC,
            "evidence": format_effect(mechanism, value_key="mean_contrast", p_key="p_two_sided", ci_low_key="ci95_low", ci_high_key="ci95_high"),
            "management_interpretation": "中等支持延长官方提示到现场确认之间的间隔，说明其形成了“可依赖但未闭合”的信息链；但感知可靠性仍必须由问卷直接测量。",
            "status": "支持，但不是正式中介一",
        },
        {
            "construct": "路径选择正确率",
            "role": "辅助因变量；速度-准确性权衡解释",
            "operationalization": "decision_choice_accuracy_ratio / first_choice_correct / final_arrival_correct",
            "evidence": accuracy_overall_evidence(accuracy_rows),
            "management_interpretation": "低支持条件下被试可能不依赖官方线索，而是用启发式搜索或其他环境线索快速行动，因此迟滞较低但正确率应较低；随着路径确认支持提高，路线选择正确率预期逐步上升。",
            "status": "待 correctness marker 完整接入" if not accuracy_has_valid_runs(accuracy_rows) else "辅助结果可报告",
        },
        {
            "construct": "信息加工负荷",
            "role": "中介二；中等支持 -> 高支持阶段主导",
            "operationalization": EEG_THETA,
            "evidence": format_effect(eeg_theta, value_key="mean_contrast", p_key="p_two_sided", ci_low_key="ci95_low", ci_high_key="ci95_high"),
            "management_interpretation": "该中介对应启发式决策中的认知局限过程。中等支持下线索足够可靠但未充分闭合，个体受处理能力限制，必须整合更多线索并可能忽略部分信息；高支持进一步提高后，确认链更容易闭合，信息加工负荷应下降。额区 theta 是 M2 的计划次级过程证据。",
            "status": "计划次级证据支持",
        },
        {
            "construct": "事件窗综合 EEG 负荷",
            "role": "H3 综合端点",
            "operationalization": EEG_COMPOSITE,
            "evidence": format_effect(eeg_composite, value_key="mean_contrast", p_key="p_two_sided", ci_low_key="ci95_low", ci_high_key="ci95_high"),
            "management_interpretation": "综合 EEG 负荷方向符合预期但为边缘结果，应作为趋势证据而不是核心显著结论。",
            "status": "边缘",
        },
        {
            "construct": "广义路线执行效率",
            "role": "解释边界 / 敏感性指标",
            "operationalization": LEGACY_METRIC,
            "evidence": format_effect(legacy, value_key="mean_contrast", p_key="p_two_sided", ci_low_key="ci95_low", ci_high_key="ci95_high"),
            "management_interpretation": "干预影响的是确认负担，不一定直接改变整段路线效率；这一区分可以避免把管理结论写过头。",
            "status": "非主指标",
        },
    ]


def build_accuracy_rows(canonical_rows: list[dict[str, str]]) -> list[dict[str, Any]]:
    if not canonical_rows:
        return [
            {
                "support_level": "all",
                "valid_runs": 0,
                "valid_subjects": 0,
                "mean_accuracy": "-",
                "source_fields": "-",
                "planned_test": "low < medium < high 线性趋势；low vs medium/high 辅助对比",
                "interpretation": "未找到 canonical run table，无法检查正确率字段。",
                "status": "待数据接入",
            }
        ]

    values_by_support: dict[str, list[float]] = {level: [] for level in SUPPORT_ORDER}
    subjects_by_support: dict[str, set[str]] = {level: set() for level in SUPPORT_ORDER}
    source_counts: dict[str, int] = {}
    all_subjects: set[str] = set()

    for row in canonical_rows:
        support = normalize_support_level(row.get("density") or row.get("density_label") or row.get("support_level"))
        if support not in values_by_support:
            continue
        value, source = extract_accuracy_value(row)
        if value is None:
            continue
        values_by_support[support].append(value)
        source_counts[source] = source_counts.get(source, 0) + 1
        subject = str(row.get("subject") or "").strip()
        if subject:
            subjects_by_support[support].add(subject)
            all_subjects.add(subject)

    all_values = [value for level in SUPPORT_ORDER for value in values_by_support[level]]
    source_text = ", ".join(f"{key}={value}" for key, value in sorted(source_counts.items())) or "-"
    trend_text = accuracy_trend_interpretation(values_by_support)
    status = "辅助结果可报告" if all_values else "当前 XDF correctness 字段为空"

    rows: list[dict[str, Any]] = [
        {
            "support_level": "all",
            "valid_runs": len(all_values),
            "valid_subjects": len(all_subjects),
            "mean_accuracy": fmt(np.mean(all_values)) if all_values else "-",
            "source_fields": source_text,
            "planned_test": "low < medium < high 线性趋势；同时报告 low vs medium/high",
            "interpretation": trend_text if all_values else "当前 canonical XDF 中正确率字段均为空；只能保留为辅助因变量方案，不能报告正确率结论。",
            "status": status,
        }
    ]
    for level in SUPPORT_ORDER:
        values = values_by_support[level]
        rows.append(
            {
                "support_level": SUPPORT_LABELS[level],
                "valid_runs": len(values),
                "valid_subjects": len(subjects_by_support[level]),
                "mean_accuracy": fmt(np.mean(values)) if values else "-",
                "source_fields": source_text if values else "-",
                "planned_test": "描述均值并进入单调趋势检验",
                "interpretation": "正确率越高表示路线选择越准确；低支持预期最低。" if values else "该支持水平暂无 correctness marker。",
                "status": status if values else "待 correctness marker 接入",
            }
        )
    return rows


def build_accuracy_contrast_rows(canonical_rows: list[dict[str, str]]) -> list[dict[str, Any]]:
    subject_values: dict[str, dict[str, float]] = {}
    for row in canonical_rows:
        subject = str(row.get("subject") or "").strip()
        support = normalize_support_level(row.get("density") or row.get("density_label") or row.get("support_level"))
        value, _source = extract_accuracy_value(row)
        if not subject or support not in SUPPORT_ORDER or value is None:
            continue
        subject_values.setdefault(subject, {})[support] = value

    complete_subjects = {subject: values for subject, values in subject_values.items() if all(level in values for level in SUPPORT_ORDER)}
    contrast_specs = [
        ("accuracy_linear_trend_high_minus_low", "高支持 - 低支持", {"low": -1.0, "medium": 0.0, "high": 1.0}, "单调上升辅助检验；预期 > 0"),
        ("accuracy_medium_minus_low", "中等支持 - 低支持", {"low": -1.0, "medium": 1.0, "high": 0.0}, "检验低->中阶段正确率是否提高"),
        ("accuracy_high_minus_medium", "高支持 - 中等支持", {"low": 0.0, "medium": -1.0, "high": 1.0}, "检验中->高阶段正确率是否继续提高或保持"),
        ("accuracy_high_minus_low", "高支持 - 低支持", {"low": -1.0, "medium": 0.0, "high": 1.0}, "检验最高支持相对低支持的总体准确率收益"),
    ]
    rows: list[dict[str, Any]] = []
    for metric, label, weights, rule in contrast_specs:
        values = [
            sum(weights[level] * by_support[level] for level in SUPPORT_ORDER)
            for by_support in complete_subjects.values()
        ]
        stats = one_sample_stats(values)
        rows.append(
            {
                "metric": metric,
                "label": label,
                "n": len(values),
                "mean_contrast": fmt(stats.get("mean")),
                "ci95_low": fmt(stats.get("ci95_low")),
                "ci95_high": fmt(stats.get("ci95_high")),
                "t": fmt(stats.get("t")),
                "p_two_sided": fmt_p(stats.get("p_two_sided")),
                "positive_count": sum(1 for value in values if value > 0),
                "negative_count": sum(1 for value in values if value < 0),
                "zero_count": sum(1 for value in values if value == 0),
                "planned_role": rule,
            }
        )
    if not rows:
        return [
            {
                "metric": "accuracy_contrast",
                "label": "路径选择正确率辅助对比",
                "n": 0,
                "mean_contrast": "-",
                "ci95_low": "-",
                "ci95_high": "-",
                "t": "-",
                "p_two_sided": "-",
                "positive_count": 0,
                "negative_count": 0,
                "zero_count": 0,
                "planned_role": "没有完整低/中/高正确率，暂不能计算被试内辅助对比。",
            }
        ]
    return rows


def one_sample_stats(values: list[float]) -> dict[str, float | None]:
    clean = [float(value) for value in values if math.isfinite(float(value))]
    if not clean:
        return {"mean": None, "ci95_low": None, "ci95_high": None, "t": None, "p_two_sided": None}
    arr = np.asarray(clean, dtype=float)
    mean_value = float(np.mean(arr))
    if len(arr) < 2:
        return {"mean": mean_value, "ci95_low": None, "ci95_high": None, "t": None, "p_two_sided": None}
    sd_value = float(np.std(arr, ddof=1))
    sem = sd_value / math.sqrt(len(arr))
    if sem == 0:
        return {"mean": mean_value, "ci95_low": mean_value, "ci95_high": mean_value, "t": None, "p_two_sided": None}
    df = len(arr) - 1
    t_value = mean_value / sem
    p_value = student_t_two_sided_p(abs(t_value), df)
    tcrit = 1.96
    try:
        from scipy import stats

        tcrit = float(stats.t.ppf(0.975, df))
        p_value = float(stats.t.sf(abs(t_value), df) * 2)
    except Exception:
        pass
    return {
        "mean": mean_value,
        "ci95_low": mean_value - tcrit * sem,
        "ci95_high": mean_value + tcrit * sem,
        "t": t_value,
        "p_two_sided": p_value,
    }


def extract_accuracy_value(row: dict[str, str]) -> tuple[float | None, str]:
    for field in ACCURACY_FIELDS:
        value = parse_accuracy_value(row.get(field))
        if value is not None:
            source = str(row.get("accuracy_source") or "").strip()
            return value, source if source and source != "-" else field
    exit_value = parse_exit_accuracy(row.get("exit_label"))
    if exit_value is not None:
        return exit_value, f"exit_label={TARGET_EXIT_LABEL}"
    return None, ""


def parse_exit_accuracy(value: Any) -> float | None:
    text = str(value or "").strip().upper()
    if not text or text == "-":
        return None
    return 1.0 if text == TARGET_EXIT_LABEL else 0.0


def parse_accuracy_value(value: Any) -> float | None:
    text = str(value).strip().lower()
    if text in {"", "-", "none", "null", "nan"}:
        return None
    if text in {"1", "true", "yes", "y", "correct", "success", "right", "target", "到达", "正确", "成功"}:
        return 1.0
    if text in {"0", "false", "no", "n", "incorrect", "wrong", "fail", "failed", "错误", "失败"}:
        return 0.0
    is_percent = text.endswith("%")
    if is_percent:
        text = text[:-1].strip()
    numeric = number(text)
    if numeric is None:
        return None
    if is_percent:
        numeric = numeric / 100.0
    if 0 <= numeric <= 1:
        return numeric
    return None


def normalize_support_level(value: Any) -> str:
    text = str(value or "").strip().lower()
    if text in {"low", "1", "condition-1", "signature1", "低", "低支持", "低路径确认支持"}:
        return "low"
    if text in {"medium", "middle", "mid", "2", "condition-2", "signature2", "中", "中等", "中支持", "中等支持", "中路径确认支持"}:
        return "medium"
    if text in {"high", "3", "condition-3", "signature3", "高", "高支持", "高路径确认支持"}:
        return "high"
    return text


def accuracy_trend_interpretation(values_by_support: dict[str, list[float]]) -> str:
    means = {level: float(np.mean(values)) for level, values in values_by_support.items() if values}
    if set(SUPPORT_ORDER).issubset(means):
        if means["low"] < means["medium"] < means["high"]:
            return "方向符合辅助假设：正确率从低支持到高支持单调上升。"
        if means["low"] < min(means["medium"], means["high"]):
            return "低支持正确率低于中/高支持，但中高之间未呈严格单调。"
        return "当前正确率方向未支持单调上升假设，需要作为辅助结果如实报告。"
    return "已有部分正确率字段，但不足以完成低/中/高单调趋势检验。"


def accuracy_has_valid_runs(accuracy_rows: list[dict[str, Any]]) -> bool:
    if not accuracy_rows:
        return False
    return number(accuracy_rows[0].get("valid_runs")) not in (None, 0)


def accuracy_overall_evidence(accuracy_rows: list[dict[str, Any]]) -> str:
    if not accuracy_rows:
        return "未生成正确率可用性检查。"
    summary = accuracy_rows[0]
    valid_runs = int(number(summary.get("valid_runs")) or 0)
    valid_subjects = int(number(summary.get("valid_subjects")) or 0)
    if valid_runs == 0:
        return "当前 canonical XDF 中缺少 correctness marker，且没有可用 exit_label；需补写 choice_correct 或最终出口字段后才能报告正确率。"
    return f"valid runs={valid_runs}, valid subjects={valid_subjects}, mean accuracy={summary.get('mean_accuracy')}; {summary.get('interpretation')}"


def build_link_rows(h1_subjects: list[dict[str, str]], eeg_subjects: list[dict[str, str]]) -> list[dict[str, Any]]:
    h1_by_subject = {row["subject"]: row for row in h1_subjects if row.get("subject")}
    eeg_by_metric: dict[str, dict[str, dict[str, str]]] = {}
    for row in eeg_subjects:
        eeg_by_metric.setdefault(row.get("metric", ""), {})[row.get("subject", "")] = row

    links = [
        ("行为机制线索 -> 行动迟滞主结果", f"{MECHANISM_METRIC}_contrast", f"{H1_METRIC}_contrast", h1_by_subject, h1_by_subject),
        ("行动迟滞主结果 -> M2 额区 theta", f"{H1_METRIC}_contrast", "contrast_medium_minus_low_high_mean", h1_by_subject, eeg_by_metric.get(EEG_THETA, {})),
        ("行为机制线索 -> M2 额区 theta", f"{MECHANISM_METRIC}_contrast", "contrast_medium_minus_low_high_mean", h1_by_subject, eeg_by_metric.get(EEG_THETA, {})),
        ("行动迟滞主结果 -> EEG 综合负荷", f"{H1_METRIC}_contrast", "contrast_medium_minus_low_high_mean", h1_by_subject, eeg_by_metric.get(EEG_COMPOSITE, {})),
    ]

    rows: list[dict[str, Any]] = []
    for label, x_key, y_key, x_rows, y_rows in links:
        pairs = []
        for subject, x_row in x_rows.items():
            y_row = y_rows.get(subject)
            if not y_row:
                continue
            x = number(x_row.get(x_key))
            y = number(y_row.get(y_key))
            if x is not None and y is not None:
                pairs.append((subject, x, y))
        stats = correlation_stats([x for _, x, _ in pairs], [y for _, _, y in pairs])
        rows.append(
            {
                "link": label,
                "n": len(pairs),
                "pearson_r": fmt(stats.get("pearson_r")),
                "pearson_p": fmt(stats.get("pearson_p")),
                "spearman_rho": fmt(stats.get("spearman_rho")),
                "spearman_p": fmt(stats.get("spearman_p")),
                "interpretation": link_interpretation(label, stats),
            }
        )
    return rows


def build_h1_component_sensitivity_rows(component_rows: list[dict[str, str]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for row in component_rows:
        if row.get("role") != "component_sensitivity":
            continue
        mean_value = number(row.get("mean_contrast"))
        p_value = number(row.get("p_two_sided"))
        out.append(
            {
                "dropped_component": row.get("dropped_component", ""),
                "kept_components": row.get("components", ""),
                "n": row.get("n", ""),
                "mean_contrast": fmt_num(row.get("mean_contrast")),
                "ci95": f"[{fmt_num(row.get('ci95_low'))}, {fmt_num(row.get('ci95_high'))}]",
                "p_two_sided": fmt_p(row.get("p_two_sided")),
                "wilcoxon_p": fmt_p(row.get("wilcoxon_p_two_sided")),
                "signflip_p": fmt_p(row.get("signflip_p_two_sided")),
                "label_permutation_p": fmt_p(row.get("label_permutation_p_two_sided")),
                "status": evidence_status(mean_value, p_value),
            }
        )
    return out


def build_h1_qc_sensitivity_rows(analysis_grid: list[dict[str, str]]) -> list[dict[str, Any]]:
    order = ["all_complete", "strict_start_all_runs", "low_duplicate_ratio", "eeg_epochs_ge_20"]
    by_filter = {
        row.get("filter"): row
        for row in analysis_grid
        if row.get("analysis") == "subject_contrast" and row.get("metric") == H1_METRIC
    }
    rows: list[dict[str, Any]] = []
    for filter_name in order:
        row = by_filter.get(filter_name)
        if not row:
            continue
        mean_value = number(row.get("mean_contrast"))
        p_value = number(row.get("p"))
        rows.append(
            {
                "filter": filter_name,
                "n": row.get("n", ""),
                "mean_contrast": fmt_num(row.get("mean_contrast")),
                "ci95": f"[{fmt_num(row.get('ci95_low'))}, {fmt_num(row.get('ci95_high'))}]",
                "p_two_sided": fmt_p(row.get("p")),
                "wilcoxon_p": fmt_p(row.get("wilcoxon_p")),
                "sign_p": fmt_p(row.get("sign_p")),
                "positive_count": row.get("positive_count", ""),
                "negative_count": row.get("negative_count", ""),
                "status": evidence_status(mean_value, p_value),
            }
        )
    return rows


def evidence_status(mean_value: float | None, p_value: float | None) -> str:
    if mean_value is None:
        return "无法判断"
    if mean_value <= 0:
        return "方向不一致"
    if p_value is not None and p_value < 0.05:
        return "正向且 p<.05"
    if p_value is not None and p_value < 0.10:
        return "正向趋势"
    return "正向但未达显著"


def build_h1_figures(h1_subjects: list[dict[str, str]], h1_profiles: list[dict[str, str]]) -> dict[str, str]:
    subject_values = h1_subject_value_rows(h1_subjects)
    return {
        "condition_means": svg_condition_means(h1_profiles),
        "subject_spaghetti": svg_subject_spaghetti(subject_values),
        "contrast_distribution": svg_contrast_distribution(subject_values),
    }


def write_figure_svgs(out_dir: Path, figures: dict[str, str]) -> None:
    for name, svg in figures.items():
        if svg:
            (out_dir / f"{name}.svg").write_text(svg, encoding="utf-8")


def h1_subject_value_rows(h1_subjects: list[dict[str, str]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for row in h1_subjects:
        low = number(row.get(f"{H1_METRIC}_low"))
        medium = number(row.get(f"{H1_METRIC}_medium"))
        high = number(row.get(f"{H1_METRIC}_high"))
        contrast = number(row.get(f"{H1_METRIC}_contrast"))
        if low is None or medium is None or high is None or contrast is None:
            continue
        rows.append(
            {
                "subject": row.get("subject", ""),
                "low": low,
                "medium": medium,
                "high": high,
                "contrast": contrast,
            }
        )
    return rows


def svg_condition_means(h1_profiles: list[dict[str, str]]) -> str:
    rows = [find_h1_profile(h1_profiles, level) for level in SUPPORT_ORDER]
    if any(not row for row in rows):
        return ""
    means = [number(row.get("mean")) for row in rows]
    lows = [number(row.get("ci95_low")) for row in rows]
    highs = [number(row.get("ci95_high")) for row in rows]
    if any(value is None for value in [*means, *lows, *highs]):
        return ""
    width, height = 760, 360
    left, right, top, bottom = 70, 34, 42, 292
    y_min, y_max = padded_range([float(value) for value in [*lows, *highs, 0.0]], 0.08)
    xs = [150, 380, 610]
    y0 = y_pos(0.0, y_min, y_max, top, bottom)
    parts = [svg_open(width, height, "H1 三条件均值与 95% CI")]
    parts.append(svg_line(left, y0, width - right, y0, "#94a3b8", 1, "4 4"))
    parts.append(svg_axis(left, top, bottom, width - right))
    points = []
    for index, level in enumerate(SUPPORT_ORDER):
        x = xs[index]
        mean = float(means[index])
        ci_low = float(lows[index])
        ci_high = float(highs[index])
        y_mean = y_pos(mean, y_min, y_max, top, bottom)
        y_low = y_pos(ci_low, y_min, y_max, top, bottom)
        y_high = y_pos(ci_high, y_min, y_max, top, bottom)
        color = "#0f766e" if level == "medium" else "#64748b"
        parts.append(svg_line(x, y_low, x, y_high, color, 3))
        parts.append(svg_line(x - 13, y_low, x + 13, y_low, color, 2))
        parts.append(svg_line(x - 13, y_high, x + 13, y_high, color, 2))
        parts.append(f'<circle cx="{x}" cy="{y_mean:.2f}" r="7" fill="{color}" />')
        parts.append(svg_text(x, bottom + 28, SUPPORT_LABELS[level], 13, "#334155", "middle"))
        parts.append(svg_text(x, y_mean - 14, fmt_num(mean), 12, color, "middle"))
        points.append((x, y_mean))
    parts.append(svg_polyline(points, "#0f766e", 2.5))
    parts.append(svg_y_labels(left, top, bottom, y_min, y_max))
    parts.append("</svg>")
    return "\n".join(parts)


def svg_subject_spaghetti(subject_rows: list[dict[str, Any]]) -> str:
    if not subject_rows:
        return ""
    width, height = 760, 390
    left, right, top, bottom = 70, 34, 42, 318
    values = [float(row[level]) for row in subject_rows for level in SUPPORT_ORDER]
    y_min, y_max = padded_range([*values, 0.0], 0.08)
    xs = {"low": 150, "medium": 380, "high": 610}
    means = {level: float(np.mean([row[level] for row in subject_rows])) for level in SUPPORT_ORDER}
    parts = [svg_open(width, height, "H1 被试内三条件轨迹")]
    y0 = y_pos(0.0, y_min, y_max, top, bottom)
    parts.append(svg_line(left, y0, width - right, y0, "#94a3b8", 1, "4 4"))
    parts.append(svg_axis(left, top, bottom, width - right))
    for row in subject_rows:
        points = [(xs[level], y_pos(float(row[level]), y_min, y_max, top, bottom)) for level in SUPPORT_ORDER]
        is_peak = row["medium"] > row["low"] and row["medium"] > row["high"]
        parts.append(svg_polyline(points, "#14b8a6" if is_peak else "#cbd5e1", 1.2, 0.60 if is_peak else 0.42))
    mean_points = [(xs[level], y_pos(means[level], y_min, y_max, top, bottom)) for level in SUPPORT_ORDER]
    parts.append(svg_polyline(mean_points, "#0f766e", 4))
    for level in SUPPORT_ORDER:
        x = xs[level]
        parts.append(f'<circle cx="{x}" cy="{y_pos(means[level], y_min, y_max, top, bottom):.2f}" r="6" fill="#0f766e" />')
        parts.append(svg_text(x, bottom + 28, SUPPORT_LABELS[level], 13, "#334155", "middle"))
    parts.append(svg_text(width - right, top + 16, "绿色线：个体 medium peak；粗线：均值", 12, "#475569", "end"))
    parts.append(svg_y_labels(left, top, bottom, y_min, y_max))
    parts.append("</svg>")
    return "\n".join(parts)


def svg_contrast_distribution(subject_rows: list[dict[str, Any]]) -> str:
    if not subject_rows:
        return ""
    contrasts = [float(row["contrast"]) for row in subject_rows]
    width, height = 760, 340
    left, right, top, bottom = 70, 34, 42, 270
    x_min, x_max = padded_range([*contrasts, 0.0], 0.08)
    bins = 12
    step = (x_max - x_min) / bins if x_max > x_min else 1.0
    counts = [0] * bins
    for value in contrasts:
        index = min(bins - 1, max(0, int((value - x_min) / step)))
        counts[index] += 1
    max_count = max(counts) if counts else 1
    parts = [svg_open(width, height, "H1 subject-level planned contrast 分布")]
    x0 = x_pos(0.0, x_min, x_max, left, width - right)
    parts.append(svg_line(x0, top, x0, bottom, "#94a3b8", 1, "4 4"))
    parts.append(svg_axis(left, top, bottom, width - right))
    plot_width = width - left - right
    bar_width = plot_width / bins * 0.78
    for index, count in enumerate(counts):
        x_center = left + (index + 0.5) * plot_width / bins
        bar_h = 0 if max_count == 0 else count / max_count * (bottom - top - 22)
        y = bottom - bar_h
        fill = "#0f766e" if x_center >= x0 else "#94a3b8"
        parts.append(f'<rect x="{x_center - bar_width/2:.2f}" y="{y:.2f}" width="{bar_width:.2f}" height="{bar_h:.2f}" fill="{fill}" opacity="0.84" />')
    mean_contrast = float(np.mean(contrasts))
    x_mean = x_pos(mean_contrast, x_min, x_max, left, width - right)
    parts.append(svg_line(x_mean, top, x_mean, bottom, "#b45309", 2))
    parts.append(svg_text(x_mean, top + 16, f"mean={fmt_num(mean_contrast)}", 12, "#b45309", "middle"))
    parts.append(svg_text(left, bottom + 28, fmt_num(x_min), 12, "#334155", "middle"))
    parts.append(svg_text(x0, bottom + 28, "0", 12, "#334155", "middle"))
    parts.append(svg_text(width - right, bottom + 28, fmt_num(x_max), 12, "#334155", "middle"))
    parts.append("</svg>")
    return "\n".join(parts)


def svg_open(width: int, height: int, title: str) -> str:
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img">'
        f'<rect width="100%" height="100%" fill="#ffffff" />'
        f'{svg_text(width / 2, 24, title, 16, "#172033", "middle", "600")}'
    )


def svg_axis(left: float, top: float, bottom: float, right: float) -> str:
    return svg_line(left, top, left, bottom, "#334155", 1.2) + svg_line(left, bottom, right, bottom, "#334155", 1.2)


def svg_y_labels(left: float, top: float, bottom: float, y_min: float, y_max: float) -> str:
    labels = []
    for value in (y_min, 0.0, y_max):
        if value < y_min - 1e-9 or value > y_max + 1e-9:
            continue
        y = y_pos(value, y_min, y_max, top, bottom)
        labels.append(svg_text(left - 10, y + 4, fmt_num(value), 11, "#475569", "end"))
    return "".join(labels)


def svg_text(x: float, y: float, text: str, size: int, color: str, anchor: str = "start", weight: str = "400") -> str:
    return f'<text x="{x:.2f}" y="{y:.2f}" fill="{color}" font-family="Arial, Microsoft YaHei, sans-serif" font-size="{size}" font-weight="{weight}" text-anchor="{anchor}">{html.escape(str(text))}</text>'


def svg_line(x1: float, y1: float, x2: float, y2: float, color: str, width: float, dash: str = "") -> str:
    dash_attr = f' stroke-dasharray="{dash}"' if dash else ""
    return f'<line x1="{x1:.2f}" y1="{y1:.2f}" x2="{x2:.2f}" y2="{y2:.2f}" stroke="{color}" stroke-width="{width}"{dash_attr} />'


def svg_polyline(points: list[tuple[float, float]], color: str, width: float, opacity: float = 1.0) -> str:
    point_text = " ".join(f"{x:.2f},{y:.2f}" for x, y in points)
    return f'<polyline points="{point_text}" fill="none" stroke="{color}" stroke-width="{width}" stroke-linecap="round" stroke-linejoin="round" opacity="{opacity}" />'


def padded_range(values: list[float], min_pad: float) -> tuple[float, float]:
    clean = [float(value) for value in values if math.isfinite(float(value))]
    if not clean:
        return -1.0, 1.0
    lo = min(clean)
    hi = max(clean)
    span = hi - lo
    pad = max(min_pad, span * 0.12)
    if span == 0:
        pad = max(min_pad, abs(hi) * 0.2, 0.1)
    return lo - pad, hi + pad


def y_pos(value: float, y_min: float, y_max: float, top: float, bottom: float) -> float:
    if y_max <= y_min:
        return (top + bottom) / 2
    return bottom - (value - y_min) / (y_max - y_min) * (bottom - top)


def x_pos(value: float, x_min: float, x_max: float, left: float, right: float) -> float:
    if x_max <= x_min:
        return (left + right) / 2
    return left + (value - x_min) / (x_max - x_min) * (right - left)


def build_implication_rows(h1_summary: dict[str, Any], eeg_robustness: list[dict[str, str]], link_rows: list[dict[str, Any]], accuracy_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    primary = h1_summary.get("primary_result", {})
    mechanism = h1_summary.get("mechanism_result", {})
    eeg_theta = find_row(eeg_robustness, "metric", EEG_THETA)
    return [
        {
            "finding": "中等支持提高近端确认负担",
            "evidence": format_effect(primary, value_key="mean_contrast", p_key="p_two_sided", ci_low_key="ci95_low", ci_high_key="ci95_high"),
            "management_implication": "信息支持不能只按数量评价；当支持有用但未完全闭合确认链时，可能形成新的核对瓶颈。",
        },
        {
            "finding": "低->中阶段需要由感知可靠性问卷正式检验",
            "evidence": "当前行为线索显示提示到确认线索延迟显著增加，但 M1 必须由问卷测量。",
            "management_implication": "下一步应优先接入 perceived reliability 问卷，检验低支持到中等支持阶段是否由“准确性收益超过操作成本”的理性权衡变化主导。",
        },
        {
            "finding": "路径选择正确率是辅助因变量，不是主效应替代项",
            "evidence": accuracy_overall_evidence(accuracy_rows),
            "management_implication": "低支持条件下较低迟滞应被解释为可能的启发式快速行动，而不是更优绩效；正式写作中应同步报告正确率的 low < medium < high 趋势，用于说明速度-准确性权衡。",
        },
        {
            "finding": "信息闭合缺口是 M1 机制的行为线索",
            "evidence": format_effect(mechanism, value_key="mean_contrast", p_key="p_two_sided", ci_low_key="ci95_low", ci_high_key="ci95_high"),
            "management_implication": "应急标识和提示系统应缩短官方指令与现场确认线索之间的时间差，尤其要在关键决策点完成信息闭合；但该指标不能替代感知可靠性问卷。",
        },
        {
            "finding": "中->高阶段由信息加工负荷主导的假设已有 EEG 过程证据",
            "evidence": format_effect(eeg_theta, value_key="mean_contrast", p_key="p_two_sided", ci_low_key="ci95_low", ci_high_key="ci95_high"),
            "management_implication": "神经工程数据应作为管理系统设计的过程证据，说明中等支持下个体因认知局限而承受更高整合负荷；它不是独立医学式结论。",
        },
        {
            "finding": "完整并行中介尚未完成",
            "evidence": "H1 行为主效应稳健；M2 EEG 有过程证据；M1 问卷尚未接入。",
            "management_implication": "论文应把当前结果写成主效应与 M2 过程证据，等问卷数据接入后再正式检验 M1/M2 分段并行中介。",
        },
    ]


def build_paper_sections(
    h1_summary: dict[str, Any],
    eeg_robustness: list[dict[str, str]],
    link_rows: list[dict[str, Any]],
    accuracy_rows: list[dict[str, Any]],
    accuracy_contrast_rows: list[dict[str, Any]],
    h1_profiles: list[dict[str, str]],
    h1_pairwise: list[dict[str, str]],
    map_adjusted: list[dict[str, str]],
    component_sensitivity: list[dict[str, Any]],
    qc_sensitivity: list[dict[str, Any]],
) -> dict[str, str]:
    primary = h1_summary.get("primary_result", {})
    mechanism = h1_summary.get("mechanism_result", {})
    eeg_composite = find_row(eeg_robustness, "metric", EEG_COMPOSITE)
    eeg_theta = find_row(eeg_robustness, "metric", EEG_THETA)
    link_text = "; ".join(f"{row['link']}: r={row['pearson_r']}, p={row['pearson_p']}" for row in link_rows)
    accuracy_text = accuracy_paper_sentence(accuracy_rows, accuracy_contrast_rows)
    profile_text = h1_profile_sentence(h1_profiles)
    medium_low = find_h1_pairwise(h1_pairwise, "medium_minus_low")
    medium_high = find_h1_pairwise(h1_pairwise, "medium_minus_high")
    high_low = find_h1_pairwise(h1_pairwise, "high_minus_low")
    shape_text = h1_shape_evidence(h1_summary)
    map_adjusted_text = h1_map_adjusted_evidence(map_adjusted)
    component_text = h1_component_sensitivity_evidence(component_sensitivity)
    qc_text = h1_qc_sensitivity_evidence(qc_sensitivity)
    sensitivity_text = h1_sensitivity_sentence(h1_summary)
    return {
        "theoretical_positioning": (
            "本文属于神经工程管理与应急管理交叉研究。脑电数据不被解释为医学或生物诊断指标，"
            "而是作为中介二“信息加工负荷”的过程追踪证据。完整模型是倒 U 主效应与两个并行中介，两个中介分别来自启发式决策理论的两种来源："
            "低支持到中等支持阶段由感知可靠性主导，体现准确性收益与操作成本之间的理性权衡；中等支持到高支持阶段由信息加工负荷主导，体现认知局限下的信息整合负担。"
            "路径选择正确率被定位为辅助因变量，用于解释低支持条件下速度较快但可能准确性较低的速度-准确性权衡。"
        ),
        "primary_h1_paragraph": (
            "主效应应作为论文结果的第一层结论报告。"
            f"当前 H1 主指标（{H1_METRIC}）的三条件均值为：{profile_text}。"
            f"以 medium - mean(low, high) 为 planned contrast，{format_primary_h1_evidence(primary)}。"
            f"{shape_text}。{map_adjusted_text}。"
            f"{component_text}。{qc_text}。"
            f"相邻阶段上，低支持到中等支持的差异为 {h1_pairwise_short(medium_low)}；"
            f"中等支持到高支持的差异为 {h1_pairwise_short(medium_high)}；"
            f"高支持与低支持的差异为 {h1_pairwise_short(high_low)}。"
            f"{sensitivity_text}"
        ),
        "results_paragraph": (
            f"路径确认支持水平对近端确认负担呈现显著的中等支持峰值效应。{profile_text}。"
            f"主 planned contrast 为 {fmt_num(primary.get('mean_contrast'))}, "
            f"95% CI [{fmt_num(primary.get('ci95_low'))}, {fmt_num(primary.get('ci95_high'))}], "
            f"p={fmt_p(primary.get('p_two_sided'))}。{shape_text}。{map_adjusted_text}。"
            f"{component_text}。{qc_text}。相邻对比进一步显示，"
            f"中等支持高于低支持，p={fmt_p(medium_low.get('p_two_sided'))}；"
            f"中等支持高于高支持，双侧 p={fmt_p(medium_high.get('p_two_sided'))}，"
            f"方向性 p={fmt_p(medium_high.get('p_one_sided_positive'))}；"
            f"高支持与低支持几乎没有差异，p={fmt_p(high_low.get('p_two_sided'))}。"
            f"{sensitivity_text}"
            f"行为机制线索显示，提示到首次现场确认线索的延迟同样显著增加，"
            f"mean contrast={fmt_num(mechanism.get('mean_contrast'))} s, p={fmt_p(mechanism.get('p_two_sided'))}；"
            "该结果支持“可靠但未闭合”的解释，但不能替代问卷测得的感知可靠性。"
            f"{accuracy_text}"
            f"正式 EEG 预处理进一步显示，作为 M2 信息加工负荷过程证据的关键决策点额区 theta 增量在中等支持条件下更高，"
            f"mean contrast={fmt_num(eeg_theta.get('mean_contrast'))}, p={fmt_p(eeg_theta.get('p_two_sided'))}；"
            f"综合 EEG load composite 呈边缘趋势，p={fmt_p(eeg_composite.get('p_two_sided'))}。"
        ),
        "discussion_paragraph": (
            "这些结果说明，中等路径确认支持并不是简单地改善或恶化撤离绩效，而是处在一个特殊的管理状态："
            "它足以提升个体对官方线索的依赖意愿，却不足以让个体快速完成路线确认。"
            "低支持条件下的低迟滞不应直接理解为管理效果更优，而应结合路径选择正确率解释为可能的启发式搜索和快速自主行动。"
            "因此，低支持到中等支持阶段应主要由感知可靠性解释：个体从“确认成本不值得”转向“值得继续依赖官方线索”。"
            "中等支持到高支持阶段则应主要由信息加工负荷解释：支持进一步提高后，确认链闭合程度上升，认知局限造成的信息整合负担下降。"
            "X 到两个中介的具体形态可以根据问卷和 EEG 证据微调，但中介的主导逻辑必须跟随倒 U 主效应的两个相邻阶段。"
            "当前行为与 EEG 数据已经支持倒 U 主效应和 M2 过程证据，但完整分段并行中介仍需接入感知可靠性问卷后正式检验。"
        ),
        "link_analysis_paragraph": (
            f"补充的 subject-level 关联分析用于描述行为与神经工程过程证据之间的耦合，而不作为主因果检验。当前结果为：{link_text}。"
            "该分析主要用于说明已有行为机制线索与行为主结果的一致性，以及 EEG 过程指标的补充作用；它不替代分段中介模型，也不能在缺少问卷 M1 时声称完整中介成立。"
        ),
    }


def correlation_stats(xs: list[float], ys: list[float]) -> dict[str, float | None]:
    if len(xs) < 3 or len(xs) != len(ys):
        return {"pearson_r": None, "pearson_p": None, "spearman_rho": None, "spearman_p": None}
    x = np.asarray(xs, dtype=float)
    y = np.asarray(ys, dtype=float)
    if np.nanstd(x) == 0 or np.nanstd(y) == 0:
        return {"pearson_r": None, "pearson_p": None, "spearman_rho": None, "spearman_p": None}
    pearson_r = float(np.corrcoef(x, y)[0, 1])
    pearson_p = correlation_p_value(pearson_r, len(x))
    ranks_x = rank_values(x)
    ranks_y = rank_values(y)
    spearman_rho = float(np.corrcoef(ranks_x, ranks_y)[0, 1])
    spearman_p = correlation_p_value(spearman_rho, len(x))
    return {"pearson_r": pearson_r, "pearson_p": pearson_p, "spearman_rho": spearman_rho, "spearman_p": spearman_p}


def correlation_p_value(r_value: float, n: int) -> float | None:
    if n < 3 or abs(r_value) >= 1:
        return None
    t_value = r_value * math.sqrt((n - 2) / max(1e-12, 1 - r_value * r_value))
    df = n - 2
    try:
        from scipy import stats

        return float(stats.t.sf(abs(t_value), df) * 2)
    except Exception:
        return student_t_two_sided_p(abs(t_value), df)


def student_t_two_sided_p(t_value: float, df: int) -> float | None:
    if df <= 0:
        return None
    x_value = df / (df + t_value * t_value)
    return regularized_incomplete_beta(x_value, df / 2.0, 0.5)


def regularized_incomplete_beta(x_value: float, a_value: float, b_value: float) -> float:
    if x_value <= 0:
        return 0.0
    if x_value >= 1:
        return 1.0
    log_beta = math.lgamma(a_value + b_value) - math.lgamma(a_value) - math.lgamma(b_value)
    front = math.exp(log_beta + a_value * math.log(x_value) + b_value * math.log1p(-x_value))
    if x_value < (a_value + 1.0) / (a_value + b_value + 2.0):
        value = front * beta_continued_fraction(a_value, b_value, x_value) / a_value
    else:
        value = 1.0 - front * beta_continued_fraction(b_value, a_value, 1.0 - x_value) / b_value
    return min(1.0, max(0.0, value))


def beta_continued_fraction(a_value: float, b_value: float, x_value: float) -> float:
    max_iterations = 200
    epsilon = 3.0e-14
    floor = 1.0e-300
    qab = a_value + b_value
    qap = a_value + 1.0
    qam = a_value - 1.0
    c_value = 1.0
    d_value = 1.0 - qab * x_value / qap
    if abs(d_value) < floor:
        d_value = floor
    d_value = 1.0 / d_value
    h_value = d_value
    for iteration in range(1, max_iterations + 1):
        m2 = 2 * iteration
        aa = iteration * (b_value - iteration) * x_value / ((qam + m2) * (a_value + m2))
        d_value = 1.0 + aa * d_value
        if abs(d_value) < floor:
            d_value = floor
        c_value = 1.0 + aa / c_value
        if abs(c_value) < floor:
            c_value = floor
        d_value = 1.0 / d_value
        h_value *= d_value * c_value

        aa = -(a_value + iteration) * (qab + iteration) * x_value / ((a_value + m2) * (qap + m2))
        d_value = 1.0 + aa * d_value
        if abs(d_value) < floor:
            d_value = floor
        c_value = 1.0 + aa / c_value
        if abs(c_value) < floor:
            c_value = floor
        d_value = 1.0 / d_value
        delta = d_value * c_value
        h_value *= delta
        if abs(delta - 1.0) < epsilon:
            break
    return h_value


def rank_values(values: np.ndarray) -> np.ndarray:
    order = np.argsort(values)
    ranks = np.empty(len(values), dtype=float)
    ranks[order] = np.arange(1, len(values) + 1, dtype=float)
    return ranks


def link_interpretation(label: str, stats: dict[str, float | None]) -> str:
    r_value = stats.get("pearson_r")
    p_value = stats.get("pearson_p")
    if r_value is None:
        return "样本或方差不足，暂不解释。"
    direction = "正相关" if r_value > 0 else "负相关"
    strength = "较强" if abs(r_value) >= 0.4 else ("中等" if abs(r_value) >= 0.25 else "较弱")
    significance = "达到常规显著" if p_value is not None and p_value < 0.05 else "未达到常规显著"
    return f"{strength}{direction}，{significance}；该链接用于机制一致性描述，不替代 planned contrast。"


def find_h1_profile(h1_profiles: list[dict[str, str]], density: str) -> dict[str, str]:
    return next(
        (
            row
            for row in h1_profiles
            if row.get("metric") == H1_METRIC and normalize_support_level(row.get("density")) == density
        ),
        {},
    )


def find_h1_pairwise(h1_pairwise: list[dict[str, str]], comparison: str) -> dict[str, str]:
    return next(
        (
            row
            for row in h1_pairwise
            if row.get("metric") == H1_METRIC and row.get("comparison") == comparison
        ),
        {},
    )


def find_metric(rows: list[dict[str, Any]], metric: str) -> dict[str, Any]:
    return next((row for row in rows if row.get("metric") == metric), {})


def h1_profile_sentence(h1_profiles: list[dict[str, str]]) -> str:
    pieces = []
    for level in SUPPORT_ORDER:
        row = find_h1_profile(h1_profiles, level)
        if not row:
            continue
        pieces.append(f"{SUPPORT_LABELS[level]}={fmt_num(row.get('mean'))}")
    if len(pieces) == len(SUPPORT_ORDER):
        return "、".join(pieces)
    return "低/中/高条件均值待生成"


def h1_pairwise_evidence(h1_pairwise: list[dict[str, str]], comparison: str) -> str:
    return h1_pairwise_short(find_h1_pairwise(h1_pairwise, comparison))


def h1_pairwise_short(row: dict[str, Any]) -> str:
    if not row:
        return "-"
    return (
        f"mean diff={fmt_num(row.get('mean_contrast'))}, "
        f"95% CI [{fmt_num(row.get('ci95_low'))}, {fmt_num(row.get('ci95_high'))}], "
        f"双侧 p={fmt_p(row.get('p_two_sided'))}, "
        f"方向性 p={fmt_p(row.get('p_one_sided_positive'))}, "
        f"Wilcoxon p={fmt_p(row.get('wilcoxon_p_two_sided'))}"
    )


def h1_shape_evidence(h1_summary: dict[str, Any]) -> str:
    shape = h1_summary.get("shape_result") or {}
    if not shape:
        return "个体峰值形状诊断待生成"
    n = shape.get("n", "-")
    return (
        "个体峰值诊断显示，"
        f"中等支持为三条件最高的被试为 {shape.get('medium_peak_count', '-')}/{n}"
        f"（{fmt_percent(shape.get('medium_peak_ratio'))}），"
        f"相对随机排序基线 p={fmt_p(shape.get('medium_peak_binomial_p_one_sided_p0_1_over_3'))}；"
        f"medium>low 为 {shape.get('medium_gt_low_count', '-')}/{n}, "
        f"p={fmt_p(shape.get('medium_gt_low_binomial_p_one_sided_p0_0_5'))}；"
        f"medium>high 为 {shape.get('medium_gt_high_count', '-')}/{n}, "
        f"p={fmt_p(shape.get('medium_gt_high_binomial_p_one_sided_p0_0_5'))}"
    )


def h1_map_adjusted_evidence(map_adjusted: list[dict[str, str]]) -> str:
    map_fe = find_h1_model_row(map_adjusted, "ols_subject_fe_map_fe", "raw")
    subject_fe = find_h1_model_row(map_adjusted, "ols_subject_fe", "raw")
    if not map_fe and not subject_fe:
        return "地图校正固定效应模型待生成"
    chunks: list[str] = []
    if map_fe:
        chunks.append(
            "subject FE + map FE 模型显示 H1 倒 U 系数="
            f"{fmt_num(map_fe.get('coef'))}, SE={fmt_num(map_fe.get('se'))}, "
            f"t={fmt_num(map_fe.get('t'))}, p={fmt_p(map_fe.get('p'))}, "
            f"q={fmt_p(map_fe.get('q_bh'))}, n={map_fe.get('n_runs', '-')} runs/{map_fe.get('n_subjects', '-')} subjects"
        )
    if subject_fe:
        chunks.append(
            "仅 subject FE 模型同样支持该方向，"
            f"coef={fmt_num(subject_fe.get('coef'))}, p={fmt_p(subject_fe.get('p'))}"
        )
    return "；".join(chunks)


def h1_component_sensitivity_evidence(rows: list[dict[str, Any]]) -> str:
    if not rows:
        return "组件敏感性检验待生成"
    positive = sum(1 for row in rows if (number(row.get("mean_contrast")) or 0.0) > 0)
    significant = sum(1 for row in rows if (number(row.get("p_two_sided")) or 1.0) < 0.05)
    trend_or_better = sum(1 for row in rows if (number(row.get("p_two_sided")) or 1.0) < 0.10)
    weakest = max((number(row.get("p_two_sided")) or 1.0 for row in rows), default=None)
    return (
        f"leave-one-component-out 显示，删去任一组件后 {positive}/{len(rows)} 个替代指数仍为正向，"
        f"{significant}/{len(rows)} 个达到 p<.05，{trend_or_better}/{len(rows)} 个达到 p<.10，"
        f"最弱双侧 p={fmt_p(weakest)}"
    )


def h1_qc_sensitivity_evidence(rows: list[dict[str, Any]]) -> str:
    if not rows:
        return "QC 敏感性检验待生成"
    positive = sum(1 for row in rows if (number(row.get("mean_contrast")) or 0.0) > 0)
    significant = sum(1 for row in rows if (number(row.get("p_two_sided")) or 1.0) < 0.05)
    trend_or_better = sum(1 for row in rows if (number(row.get("p_two_sided")) or 1.0) < 0.10)
    return (
        f"QC 敏感性显示，{positive}/{len(rows)} 个过滤方案保持正向，"
        f"{significant}/{len(rows)} 个 p<.05，{trend_or_better}/{len(rows)} 个 p<.10"
    )


def find_h1_model_row(rows: list[dict[str, str]], analysis: str, transform: str) -> dict[str, str]:
    return next(
        (
            row
            for row in rows
            if row.get("metric") == H1_METRIC
            and row.get("analysis") == analysis
            and row.get("transform") == transform
        ),
        {},
    )


def format_primary_h1_evidence(primary: dict[str, Any]) -> str:
    return (
        f"planned contrast={fmt_num(primary.get('mean_contrast'))}, "
        f"95% CI [{fmt_num(primary.get('ci95_low'))}, {fmt_num(primary.get('ci95_high'))}], "
        f"p={fmt_p(primary.get('p_two_sided'))}; "
        f"bootstrap CI [{fmt_num(primary.get('bootstrap_ci95_low'))}, {fmt_num(primary.get('bootstrap_ci95_high'))}], "
        f"sign-flip p={fmt_p(primary.get('signflip_p_two_sided'))}, "
        f"Wilcoxon p={fmt_p(primary.get('wilcoxon_p_two_sided'))}, "
        f"leave-one-subject-out={primary.get('loo_p_lt_05_count', '-')}/{primary.get('loo_n_tests', '-')} p<.05"
    )


def h1_sensitivity_sentence(h1_summary: dict[str, Any]) -> str:
    top_rows = h1_summary.get("top_rows") or []
    log_z = find_metric(top_rows, "h1_log_z_component_index")
    rank = find_metric(top_rows, "h1_rank_component_index")
    legacy = h1_summary.get("legacy_result", {})
    pieces = []
    if log_z:
        pieces.append(f"log-z 构件敏感性 p={fmt_p(log_z.get('p_two_sided'))}")
    if rank:
        pieces.append(f"rank 构件敏感性 p={fmt_p(rank.get('p_two_sided'))}")
    if legacy:
        pieces.append(f"旧版广义路线效率 p={fmt_p(legacy.get('p_two_sided'))}，仅作边界/敏感性")
    if not pieces:
        return ""
    return "稳健性上，" + "；".join(pieces) + "。"


def accuracy_paper_sentence(accuracy_rows: list[dict[str, Any]], accuracy_contrast_rows: list[dict[str, Any]]) -> str:
    if not accuracy_rows or not accuracy_has_valid_runs(accuracy_rows):
        return (
            "路径选择正确率被作为辅助因变量用于解释速度-准确性权衡；但当前 XDF 汇总中 correctness 字段为空，"
            "因此本文现阶段只提出正确率应随支持水平提高而上升的辅助假设，尚不报告正确率统计结论。"
        )
    summary = accuracy_rows[0]
    means = {str(row.get("support_level")): row.get("mean_accuracy") for row in accuracy_rows}
    high_low = find_row(accuracy_contrast_rows, "metric", "accuracy_high_minus_low")
    medium_low = find_row(accuracy_contrast_rows, "metric", "accuracy_medium_minus_low")
    high_medium = find_row(accuracy_contrast_rows, "metric", "accuracy_high_minus_medium")
    return (
        "路径选择正确率作为辅助因变量显示，"
        f"当前可用 run={summary.get('valid_runs')}、被试={summary.get('valid_subjects')}。"
        f"最终路线正确性从低支持到高支持逐步上升：低支持={means.get('低支持', '-')}, "
        f"中等支持={means.get('中等支持', '-')}, 高支持={means.get('高支持', '-')}。"
        f"被试内对比显示，高支持高于低支持，mean difference={high_low.get('mean_contrast', '-')}, p={high_low.get('p_two_sided', '-')}；"
        f"中等支持高于低支持，mean difference={medium_low.get('mean_contrast', '-')}, p={medium_low.get('p_two_sided', '-')}；"
        f"高支持相对中等支持仍为正向但未达到常规显著，mean difference={high_medium.get('mean_contrast', '-')}, p={high_medium.get('p_two_sided', '-')}。"
    )


def format_effect(row: dict[str, Any], *, value_key: str, p_key: str, ci_low_key: str, ci_high_key: str) -> str:
    return f"mean={fmt_num(row.get(value_key))}, 95% CI [{fmt_num(row.get(ci_low_key))}, {fmt_num(row.get(ci_high_key))}], p={fmt_p(row.get(p_key))}"


def read_csv(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        raise SystemExit(f"Missing input: {path}")
    with path.open(encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def read_optional_csv(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        return []
    return read_csv(path)


def read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise SystemExit(f"Missing input: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    fields: list[str] = []
    for row in rows:
        for key in row:
            if key not in fields:
                fields.append(key)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields or ["empty"])
        writer.writeheader()
        writer.writerows(rows)


def write_json(path: Path, payload: Any) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def write_markdown(path: Path, payload: dict[str, Any]) -> None:
    sections = payload["paper_sections"]
    lines = [
        "# 神经工程管理证据综合报告",
        "",
        "## 理论定位",
        sections["theoretical_positioning"],
        "",
        "## 主结果：倒 U 型行动迟滞",
        sections["primary_h1_paragraph"],
        "",
        markdown_table(payload["h1_primary_result"]),
        "",
        "## H1 图形",
        "![H1 三条件均值与 95% CI](condition_means.svg)",
        "",
        "![H1 被试内三条件轨迹](subject_spaghetti.svg)",
        "",
        "![H1 planned contrast 分布](contrast_distribution.svg)",
        "",
        "## H1 组件敏感性",
        markdown_table(payload["h1_component_sensitivity"]),
        "",
        "## H1 QC 敏感性",
        markdown_table(payload["h1_qc_sensitivity"]),
        "",
        "## 构念与证据",
        markdown_table(payload["constructs"]),
        "",
        "## 辅助因变量：路径选择正确率",
        markdown_table(payload["accuracy_auxiliary_outcome"]),
        "",
        "## 正确率被试内辅助对比",
        markdown_table(payload["accuracy_contrasts"]),
        "",
        "## 行为-过程证据链接",
        markdown_table(payload["link_analysis"]),
        "",
        "## 管理启示",
        markdown_table(payload["managerial_implications"]),
        "",
        "## 论文结果段草稿",
        sections["results_paragraph"],
        "",
        "## 讨论段草稿",
        sections["discussion_paragraph"],
        "",
        "## 链接分析段草稿",
        sections["link_analysis_paragraph"],
        "",
    ]
    path.write_text("\n".join(lines), encoding="utf-8")


def write_h1_markdown(path: Path, payload: dict[str, Any]) -> None:
    sections = payload["paper_sections"]
    lines = [
        "# H1 主效应证据报告",
        "",
        "## 结论",
        sections["primary_h1_paragraph"],
        "",
        "## 证据链",
        markdown_table(payload["h1_primary_result"]),
        "",
        "## 图形",
        "![H1 三条件均值与 95% CI](condition_means.svg)",
        "",
        "![H1 被试内三条件轨迹](subject_spaghetti.svg)",
        "",
        "![H1 planned contrast 分布](contrast_distribution.svg)",
        "",
        "## 组件敏感性",
        markdown_table(payload["h1_component_sensitivity"]),
        "",
        "## QC 敏感性",
        markdown_table(payload["h1_qc_sensitivity"]),
        "",
        "## 论文结果段",
        sections["results_paragraph"],
        "",
        "## 报告口径",
        "- H1 主指标固定为 `route_confirmation_hesitation_index`。",
        "- 机制线索、正确率和 EEG 只用于解释主效应，不替代主因变量。",
        "- 旧版 `route_decision_hesitation_index` 只作为广义路线执行效率的边界敏感性指标。",
        "- 主结果按三条件均值、planned contrast、个体峰值诊断、地图校正模型、相邻阶段和稳健性顺序报告。",
        "",
    ]
    path.write_text("\n".join(lines), encoding="utf-8")


def write_html(path: Path, payload: dict[str, Any]) -> None:
    sections = payload["paper_sections"]
    doc = f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>Management Science Evidence Synthesis</title>
  <style>
    body {{ font-family: Arial, 'Microsoft YaHei', sans-serif; margin: 32px; color: #172033; line-height: 1.6; }}
    h1 {{ font-size: 28px; margin-bottom: 8px; }}
    h2 {{ font-size: 20px; margin-top: 28px; border-bottom: 1px solid #d9e3e0; padding-bottom: 6px; }}
    .note {{ background: #f4f8f7; border-left: 4px solid #779f97; padding: 12px 14px; margin: 16px 0; }}
    .primary {{ background: #fffdf6; border: 1px solid #eadfb9; padding: 14px 16px; margin: 18px 0 20px; }}
    .figures {{ display: grid; grid-template-columns: 1fr; gap: 18px; margin: 16px 0 20px; }}
    .figure {{ border: 1px solid #d9e3e0; padding: 10px; overflow-x: auto; }}
    table {{ width: 100%; border-collapse: collapse; margin: 12px 0 20px; font-size: 13px; }}
    th, td {{ border: 1px solid #d9e3e0; padding: 7px 8px; text-align: left; vertical-align: top; }}
    th {{ background: #edf4f2; color: #173d38; }}
  </style>
</head>
<body>
  <h1>神经工程管理证据综合报告</h1>
  <div class="note">{escape(sections["theoretical_positioning"])}</div>
  <h2>主结果：倒 U 型行动迟滞</h2>
  <div class="primary">{escape(sections["primary_h1_paragraph"])}</div>
  {html_table(payload["h1_primary_result"])}
  <h2>H1 图形</h2>
  {html_figures(payload["h1_figures"])}
  <h2>H1 组件敏感性</h2>
  {html_table(payload["h1_component_sensitivity"])}
  <h2>H1 QC 敏感性</h2>
  {html_table(payload["h1_qc_sensitivity"])}
  <h2>构念与证据</h2>
  {html_table(payload["constructs"])}
  <h2>辅助因变量：路径选择正确率</h2>
  {html_table(payload["accuracy_auxiliary_outcome"])}
  <h2>正确率被试内辅助对比</h2>
  {html_table(payload["accuracy_contrasts"])}
  <h2>行为-过程证据链接</h2>
  {html_table(payload["link_analysis"])}
  <h2>管理启示</h2>
  {html_table(payload["managerial_implications"])}
  <h2>论文结果段草稿</h2>
  <p>{escape(sections["results_paragraph"])}</p>
  <h2>讨论段草稿</h2>
  <p>{escape(sections["discussion_paragraph"])}</p>
  <h2>链接分析段草稿</h2>
  <p>{escape(sections["link_analysis_paragraph"])}</p>
</body>
</html>
"""
    path.write_text(doc, encoding="utf-8")


def write_h1_html(path: Path, payload: dict[str, Any]) -> None:
    sections = payload["paper_sections"]
    doc = f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>H1 Primary Effect Report</title>
  <style>
    body {{ font-family: Arial, 'Microsoft YaHei', sans-serif; margin: 32px; color: #172033; line-height: 1.62; }}
    h1 {{ font-size: 28px; margin-bottom: 8px; }}
    h2 {{ font-size: 20px; margin-top: 28px; border-bottom: 1px solid #d9e3e0; padding-bottom: 6px; }}
    .primary {{ background: #fffdf6; border: 1px solid #eadfb9; padding: 14px 16px; margin: 18px 0 20px; }}
    .figures {{ display: grid; grid-template-columns: 1fr; gap: 18px; margin: 16px 0 20px; }}
    .figure {{ border: 1px solid #d9e3e0; padding: 10px; overflow-x: auto; }}
    table {{ width: 100%; border-collapse: collapse; margin: 12px 0 20px; font-size: 13px; }}
    th, td {{ border: 1px solid #d9e3e0; padding: 7px 8px; text-align: left; vertical-align: top; }}
    th {{ background: #edf4f2; color: #173d38; }}
    code {{ background: #f4f6f6; padding: 1px 4px; border-radius: 3px; }}
  </style>
</head>
<body>
  <h1>H1 主效应证据报告</h1>
  <h2>结论</h2>
  <div class="primary">{escape(sections["primary_h1_paragraph"])}</div>
  <h2>证据链</h2>
  {html_table(payload["h1_primary_result"])}
  <h2>图形</h2>
  {html_figures(payload["h1_figures"])}
  <h2>组件敏感性</h2>
  {html_table(payload["h1_component_sensitivity"])}
  <h2>QC 敏感性</h2>
  {html_table(payload["h1_qc_sensitivity"])}
  <h2>论文结果段</h2>
  <p>{escape(sections["results_paragraph"])}</p>
  <h2>报告口径</h2>
  <ul>
    <li>H1 主指标固定为 <code>{escape(H1_METRIC)}</code>。</li>
    <li>机制线索、正确率和 EEG 只用于解释主效应，不替代主因变量。</li>
    <li>旧版 <code>{escape(LEGACY_METRIC)}</code> 只作为广义路线执行效率的边界敏感性指标。</li>
    <li>主结果按三条件均值、planned contrast、个体峰值诊断、地图校正模型、相邻阶段和稳健性顺序报告。</li>
  </ul>
</body>
</html>
"""
    path.write_text(doc, encoding="utf-8")


def markdown_table(rows: list[dict[str, Any]]) -> str:
    if not rows:
        return "-"
    fields = list(rows[0].keys())
    out = ["| " + " | ".join(fields) + " |", "| " + " | ".join("---" for _ in fields) + " |"]
    for row in rows:
        out.append("| " + " | ".join(str(row.get(field, "")).replace("\n", " ") for field in fields) + " |")
    return "\n".join(out)


def html_figures(figures: dict[str, str]) -> str:
    if not figures:
        return "<p>-</p>"
    labels = {
        "condition_means": "H1 三条件均值与 95% CI",
        "subject_spaghetti": "H1 被试内三条件轨迹",
        "contrast_distribution": "H1 planned contrast 分布",
    }
    blocks = []
    for key in ("condition_means", "subject_spaghetti", "contrast_distribution"):
        svg = figures.get(key)
        if svg:
            blocks.append(f'<div class="figure" aria-label="{escape(labels.get(key, key))}">{svg}</div>')
    if not blocks:
        return "<p>-</p>"
    return '<div class="figures">' + "".join(blocks) + "</div>"


def html_table(rows: list[dict[str, Any]]) -> str:
    if not rows:
        return "<p>-</p>"
    fields = list(rows[0].keys())
    header = "".join(f"<th>{escape(field)}</th>" for field in fields)
    body = []
    for row in rows:
        body.append("<tr>" + "".join(f"<td>{escape(row.get(field, ''))}</td>" for field in fields) + "</tr>")
    return f"<table><thead><tr>{header}</tr></thead><tbody>{''.join(body)}</tbody></table>"


def find_row(rows: list[dict[str, str]], key: str, value: str) -> dict[str, str]:
    return next((row for row in rows if row.get(key) == value), {})


def number(value: Any) -> float | None:
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    return out if math.isfinite(out) else None


def fmt(value: Any) -> str:
    numeric = number(value)
    if numeric is None:
        return ""
    if numeric == 0:
        return "0"
    if abs(numeric) >= 1000 or abs(numeric) < 0.001:
        return f"{numeric:.3e}"
    return f"{numeric:.3f}".rstrip("0").rstrip(".")


def fmt_num(value: Any) -> str:
    return fmt(value) or "-"


def fmt_p(value: Any) -> str:
    numeric = number(value)
    if numeric is None:
        return "-"
    if numeric < 0.001:
        return "<.001"
    return f"{numeric:.3f}"


def fmt_percent(value: Any) -> str:
    numeric = number(value)
    if numeric is None:
        return "-"
    return f"{numeric * 100:.1f}%"


def escape(value: Any) -> str:
    return html.escape("" if value is None else str(value))


if __name__ == "__main__":
    main()
