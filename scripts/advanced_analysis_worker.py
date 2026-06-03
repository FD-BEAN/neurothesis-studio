#!/usr/bin/env python
"""XDF-focused analysis worker for NeuroThesis Studio.

This worker is designed for LabRecorder files that contain a Mitsar/EEG stream
and a Unity LSL marker stream such as MetroRescueMarkers. It runs in GitHub
Actions, downloads one private Supabase Storage object, extracts deterministic
QC and feature summaries, and writes a JSON report to research_analysis_jobs.
"""

from __future__ import annotations

import argparse
import csv
import html as html_lib
import io
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
    "sign_visible_enter": 2.0,
    "sign_readable": 2.0,
    "decision_point_enter": 4.0,
    "audio_play": 2.0,
}
SIGNAGE_EVENTS = [
    "sign_visible_enter",
    "sign_readable",
    "sign_readable_exit",
    "sign_visible_exit",
]
DECISION_EVENTS = [
    "decision_point_enter",
    "decision_look_left",
    "decision_look_right",
    "decision_scan_both_sides",
    "decision_point_exit",
]
INEFFICIENCY_EVENTS = [
    "dwell_detected",
    "u_turn_detected",
    "route_backtrack_detected",
]
ACTION_START_EVENTS = (
    "movement_start",
    "move_start",
    "walking_start",
    "locomotion_start",
    "route_start",
    "player_move_start",
)
PROMPT_EVENTS = (
    "audio_play",
    "warning_play",
    "warning_message",
    "mobile_prompt_show",
    "popup_show",
    "instruction_start",
    "protective_action_prompt",
)
CONFIRMATION_EVENTS = (
    "sign_readable",
    "sign_visible_enter",
    "direction_cue_readable",
    "route_confirmation_cue",
)
BEHAVIOR_EVENTS = [
    "audio_play",
    "movement_start",
    "sign_visible_enter",
    "sign_readable",
    "sign_readable_exit",
    "sign_visible_exit",
    "decision_point_enter",
    "decision_look_left",
    "decision_look_right",
    "decision_scan_both_sides",
    "decision_point_exit",
    "dwell_detected",
    "u_turn_detected",
    "route_backtrack_detected",
]
SUPPORT_LEVEL_FIELDS = (
    "support_level",
    "density",
    "density_level",
    "condition",
    "support_condition",
    "route_confirmation_support",
)
SIGNATURE_FIELDS = ("signage", "signature", "signage_scene")
CHOICE_CORRECTNESS_FIELDS = (
    "first_choice_correct",
    "direction_correct",
    "decision_correct",
    "choice_correct",
    "route_choice_correct",
    "correct",
)
FINAL_CORRECTNESS_FIELDS = (
    "final_arrival_correct",
    "arrived_correct_exit",
    "route_correct",
    "target_reached",
    "reached_target",
    "success",
    "correct_exit",
)
INSTRUCTION_CLARITY_FIELDS = (
    "instruction_clarity",
    "clarity",
    "message_clarity",
    "prompt_clarity",
    "protective_action_instruction_clarity",
)
RELIABILITY_FIELDS = (
    "perceived_reliability",
    "reliability",
    "trust",
    "confidence",
    "information_reliability",
)
ANALYSIS_PIPELINE_VERSION = "metro-rescue-xdf-pipeline-2026-06-02"
UNITY_MARKER_DICTIONARY = [
    ("map_start", "实验时段", "必需", "确定 trial 起点；建议字段 subject/session/map/signature/support_level/run_order。"),
    ("evacuation_complete", "实验时段", "必需", "确定 trial 终点，并记录 exit/final_correct/success/horizontal_distance_m。"),
    ("audio_play", "指令与提醒", "建议", "标记官方目标提醒出现时间；用于计算提醒到首次现场确认线索的延迟。"),
    ("movement_start", "路径执行", "建议", "记录首次行动启动，用于计算行动启动延迟。"),
    ("sign_visible_enter", "标识确认", "建议", "标识进入可见范围，作为可见到可读延迟和可读比例分母。"),
    ("sign_readable", "标识确认", "必需", "核心路径确认线索，用于确认链连续性和 sign_readable EEG 事件窗。"),
    ("sign_readable_exit", "标识确认", "可选", "离开可读状态，用于估计标识可读停留时长。"),
    ("decision_point_enter", "决策点行为", "必需", "进入关键决策点，用于停留、扫描行为和 decision_point EEG 事件窗。"),
    ("decision_look_left", "决策点行为", "建议", "记录向左查看，用于计算查看总数和左右不平衡。"),
    ("decision_look_right", "决策点行为", "建议", "记录向右查看，用于计算查看总数和左右不平衡。"),
    ("decision_scan_both_sides", "决策点行为", "建议", "记录双侧扫描，作为反复核对和行动迟滞的行为证据。"),
    ("decision_point_exit", "决策点行为", "建议", "离开关键决策点，与 enter 配对计算停留时长。"),
    ("choice_made", "正确性", "建议", "记录 chosen_direction/correct_direction/choice_correct，区分快速但错误和快速且正确。"),
    ("dwell_detected", "路径执行", "可选", "记录停留，用于低效导航和行动迟滞代理指标。"),
    ("u_turn_detected", "路径执行", "可选", "记录掉头，用于识别路线修正。"),
    ("route_backtrack_detected", "路径执行", "可选", "记录回退，用于识别走回头路。"),
]
DENSITY_LEVELS = ("low", "medium", "high")
DENSITY_LABELS = {
    "low": "低路径确认支持",
    "medium": "中路径确认支持",
    "high": "高路径确认支持",
}
PRIMARY_CONTRAST_WEIGHTS = {"low": -1.0, "medium": 2.0, "high": -1.0}

PROJECT_MODEL_VARIABLES = [
    {
        "code": "X",
        "name": "路径确认支持水平",
        "definition": "官方目标提醒之后，现场路径确认线索在接近性、连续性、决策点覆盖和间距稳定性上的支持程度。",
        "xdf_mapping": "由 Signature/文件三连号推断低、中、高支持；同时用首次确认线索时间、可读标识比例、决策点覆盖和线索间隔作为操纵检查。",
    },
    {
        "code": "Y",
        "name": "行动迟滞",
        "definition": "等待、核对、犹豫、停顿和反复确认造成的行动启动延迟与决策点滞留。",
        "xdf_mapping": "启动延迟、完成时长、决策点停留、左右查看、双侧扫描、停留、掉头和回退。",
    },
    {
        "code": "auxY",
        "name": "路径判断准确率",
        "definition": "低迟滞需要与正确路径选择同时解释，避免把快速启发式判断误读为更优表现。",
        "xdf_mapping": "读取 Unity marker 中的 first_choice_correct、decision_correct、route_correct、success 或 reached_target 等字段；缺失时在报告中标注待补。",
    },
    {
        "code": "M1",
        "name": "感知信息可靠性",
        "definition": "被试认为官方路径确认线索一致、稳定、可追踪、值得继续依赖的程度。",
        "xdf_mapping": "问卷为主；XDF 仅提供线索连续性、决策点覆盖和确认链断点的操纵检查。",
    },
    {
        "code": "M2",
        "name": "信息加工负荷",
        "definition": "目标、线索与方向选择之间需要整合、核对和确认时产生的加工负荷。",
        "xdf_mapping": "frontal theta、posterior alpha、theta/alpha、EEG load proxy，以及 sign_readable / decision_point_enter 事件窗指标。",
    },
    {
        "code": "W",
        "name": "保护性行动指令清晰度",
        "definition": "警报是否明确说明目标、应依据的现场官方线索，以及关键决策点的确认规则。",
        "xdf_mapping": "由 audio/message/popup/clarity 字段推断；正式被试间或调节分析需要 subject/run metadata。",
    },
]

PROJECT_HYPOTHESES = [
    "H1：路径确认支持水平对行动迟滞呈倒 U 型影响，中等支持条件下行动迟滞最高。",
    "H2：低支持提高到中等支持时，感知信息可靠性增强，被试更愿意继续核对官方线索。",
    "H3：中等支持形成可依赖但未闭合的信息链，目标—线索—方向匹配负荷升高，并体现在 EEG 事件窗指标上。",
    "H4：保护性行动指令清晰度调节路径确认支持对可靠性感知和 EEG 信息加工负荷的影响。",
    "H5：路径确认支持水平应提高路径判断准确率，高支持条件应在较低迟滞下保持较高准确率。",
]


class SupabaseRest:
    def __init__(self, url: str, service_role_key: str):
        self.url = url.rstrip("/")
        base_headers = {
            "apikey": service_role_key,
            "Content-Type": "application/json",
            "User-Agent": "NeuroThesis-GitHub-Actions-Worker",
        }
        if is_legacy_jwt_key(service_role_key):
            base_headers["Authorization"] = f"Bearer {service_role_key}"
        self.headers = {
            **base_headers,
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

    def select_many(self, table: str, query: str) -> list[dict[str, Any]]:
        response = requests.get(
            f"{self.url}/rest/v1/{table}?{query}",
            headers={**self.headers, "Accept": "application/json"},
            timeout=30,
        )
        response.raise_for_status()
        return response.json()

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

    def upload_storage_object(self, storage_path: str, content: bytes, content_type: str) -> None:
        encoded_path = quote(storage_path, safe="/")
        response = requests.post(
            f"{self.url}/storage/v1/object/{BUCKET}/{encoded_path}",
            headers={
                **self.headers,
                "Content-Type": content_type,
                "x-upsert": "true",
            },
            data=content,
            timeout=90,
        )
        response.raise_for_status()


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
    job = client.select_one("research_analysis_jobs", f"id=eq.{job_id}&select=*")
    client.update_job(
        job_id,
        {
            "status": "running",
            "status_message": "XDF worker 正在下载文件并解析 EEG + Unity marker stream。",
            "github_run_url": run_url,
        },
    )

    if job.get("analysis_type") == "cohort_density_summary":
        report = run_cohort_density_job(client, job)
    elif job.get("analysis_type") == "subject_batch":
        report = run_subject_batch_job(client, job, run_url)
    else:
        document = client.select_one("research_documents", f"id=eq.{job['document_id']}&select=*")
        extension = get_extension(document["filename"])

        if extension != "xdf":
            raise RuntimeError("XDF 高级分析当前只面向 LabRecorder .xdf 文件。PDF/CSV 可用即时摘要，不进入 EEG+Unity marker 分析流水线。")

        with tempfile.TemporaryDirectory() as tmp_dir:
            local_file = Path(tmp_dir) / "input.xdf"
            client.download_storage_object(document["storage_path"], local_file)
            report = analyze_xdf(document, local_file)

    report = attach_html_report(client, job, report)

    client.update_job(
        job_id,
        {
            "status": "completed",
            "status_message": "XDF EEG + Unity marker 分析完成，HTML 报告已生成。",
            "result_json": report,
            "error_message": None,
            "completed_at": now_sql(),
            "github_run_url": run_url,
        },
    )


def attach_html_report(client: SupabaseRest, job: dict[str, Any], report: dict[str, Any]) -> dict[str, Any]:
    generated_at = now_sql()
    report_title = str(report.get("subjectId") or report.get("title") or "xdf-report")
    filename = f"{sanitize_filename(report_title)}-{job['id'][:8]}.html"
    storage_path = f"{job['user_id']}/analysis-products/{job['id']}/{filename}"
    report_with_audit = {
        **report,
        "auditTrail": build_audit_trail(job, report, generated_at),
    }
    html_text = render_html_report(report_with_audit, job, generated_at)
    content = html_text.encode("utf-8")
    client.upload_storage_object(storage_path, content, "text/html; charset=utf-8")
    return {
        **report_with_audit,
        "htmlReport": {
            "storagePath": storage_path,
            "filename": filename,
            "sizeBytes": len(content),
            "generatedAt": generated_at,
        },
    }


def render_html_report(report: dict[str, Any], job: dict[str, Any], generated_at: str) -> str:
    title = str(report.get("title") or "XDF analysis report")
    kind = str(report.get("kind") or "XDF")
    summary = str(report.get("summary") or "")
    metrics = report.get("metrics") if isinstance(report.get("metrics"), list) else []
    charts = report.get("charts") if isinstance(report.get("charts"), list) else []
    tables = report.get("tables") if isinstance(report.get("tables"), list) else []
    notes = report.get("notes") if isinstance(report.get("notes"), list) else []
    narrative_sections = report.get("narrativeSections") if isinstance(report.get("narrativeSections"), list) else []
    model_overview = report.get("modelOverview") if isinstance(report.get("modelOverview"), dict) else None
    audit_trail = report.get("auditTrail") if isinstance(report.get("auditTrail"), dict) else None

    parts = [
        "<!doctype html><html lang='zh-CN'><head><meta charset='utf-8'>",
        "<meta name='viewport' content='width=device-width, initial-scale=1'>",
        f"<title>{h(title)}</title>",
        HTML_REPORT_STYLE,
        "</head><body><main>",
        "<header class='hero'>",
        f"<p class='eyebrow'>{h(kind)}</p>",
        f"<h1>{h(title)}</h1>",
        f"<p class='muted'>生成时间 {h(generated_at)} · 任务 {h(job.get('id', ''))}</p>",
        "</header>",
    ]

    if summary:
        parts.extend(["<section class='card'><h2>报告摘要</h2>", f"<p>{h(summary)}</p>", "</section>"])

    if model_overview:
        parts.append(render_model_overview(model_overview))

    if narrative_sections:
        parts.append(render_narrative_sections(narrative_sections))

    if metrics:
        parts.append("<section class='metric-grid'>")
        for metric in metrics:
            if not isinstance(metric, dict):
                continue
            metric_text = metric.get("text")
            parts.append(
                "<article class='metric'>"
                f"<span>{h(metric.get('label', 'metric'))}</span>"
                f"<strong>{h(metric.get('value', '-'))}</strong>"
                f"{'<p>' + h(metric_text) + '</p>' if metric_text else ''}"
                "</article>"
            )
        parts.append("</section>")

    if charts:
        parts.append("<section class='grid two'>")
        for chart in charts:
            if not isinstance(chart, dict):
                continue
            article_class = "card chart-wide" if chart.get("wide") else "card"
            parts.append(f"<article class='{article_class}'>")
            parts.append(f"<h2>{h(chart.get('title', 'Chart'))}</h2>")
            parts.append(render_chart(chart))
            x_label = chart.get("xLabel")
            y_label = chart.get("yLabel")
            if x_label or y_label:
                parts.append(f"<p class='muted'>{h(x_label)} / {h(y_label)}</p>")
            if chart.get("caption"):
                parts.append(f"<p class='chart-caption'>{h(chart.get('caption'))}</p>")
            parts.append("</article>")
        parts.append("</section>")

    for table in tables:
        if isinstance(table, dict):
            parts.append(render_table(table))

    if audit_trail:
        parts.append(render_audit_trail(audit_trail))

    if notes:
        parts.append("<section class='card'><h2>分析说明与限制</h2><ul>")
        for note in notes:
            parts.append(f"<li>{h(note)}</li>")
        parts.append("</ul></section>")

    parts.extend(
        [
            "<section class='card'><h2>后续统计建模提醒</h2>",
            "<p>这份 HTML 用于检查 XDF、Unity marker、EEG 覆盖和 run-level 指标。正式论文结论需要把所有被试汇总为 subject-level / trial-level 表，再检验路径确认支持条件的组内主效应、主 planned contrast：中等支持 - 低/高支持平均，以及必要的被试间变量交互。</p>",
            "</section>",
            "<details class='card'><summary>JSON 摘要</summary>",
            f"<pre>{h(json.dumps(to_jsonable(report), ensure_ascii=False, indent=2))}</pre>",
            "</details>",
            "</main></body></html>",
        ]
    )
    return "".join(parts)


def render_model_overview(model: dict[str, Any]) -> str:
    variables = model.get("variables") if isinstance(model.get("variables"), list) else []
    hypotheses = model.get("hypotheses") if isinstance(model.get("hypotheses"), list) else []
    remarks = model.get("remarks") if isinstance(model.get("remarks"), list) else []
    parts = ["<section class='card model-card'><h2>研究模型与变量映射</h2>"]
    if model.get("purpose"):
        parts.append(f"<p>{h(model.get('purpose'))}</p>")
    if variables:
        parts.append("<div class='table-wrap'><table><thead><tr><th>变量</th><th>研究含义</th><th>XDF 对应信息</th></tr></thead><tbody>")
        for variable in variables:
            if not isinstance(variable, dict):
                continue
            label = f"{variable.get('code', '')} {variable.get('name', '')}".strip()
            parts.append(
                "<tr>"
                f"<td>{h(label)}</td>"
                f"<td>{h(variable.get('definition', ''))}</td>"
                f"<td>{h(variable.get('xdf_mapping', ''))}</td>"
                "</tr>"
            )
        parts.append("</tbody></table></div>")
    if hypotheses:
        parts.append("<h3>本报告关注的假设</h3><ul>")
        for item in hypotheses:
            parts.append(f"<li>{h(item)}</li>")
        parts.append("</ul>")
    if remarks:
        parts.append("<h3>报告边界</h3><ul>")
        for item in remarks:
            parts.append(f"<li>{h(item)}</li>")
        parts.append("</ul>")
    parts.append("</section>")
    return "".join(parts)


def build_audit_trail(job: dict[str, Any], report: dict[str, Any], generated_at: str) -> dict[str, Any]:
    source_document_ids = report.get("sourceDocumentIds")
    if not isinstance(source_document_ids, list):
        source_document_ids = [job.get("document_id")] if job.get("document_id") else []
    design = report.get("design") if isinstance(report.get("design"), dict) else {}
    return {
        "pipelineVersion": ANALYSIS_PIPELINE_VERSION,
        "generatedAt": generated_at,
        "jobId": job.get("id", ""),
        "analysisType": job.get("analysis_type", ""),
        "githubRunUrl": job.get("github_run_url") or os.environ.get("GITHUB_RUN_URL", ""),
        "githubSha": os.environ.get("GITHUB_SHA", ""),
        "sourceDocumentIds": source_document_ids,
        "subjectId": report.get("subjectId", ""),
        "withinSubjectFactor": design.get("within_subject_factor", "route-confirmation support level"),
        "primaryContrast": design.get("primary_contrast", "medium - mean(low, high)"),
        "signatureMapping": design.get("signature_mapping", {"Signature1": "low", "Signature2": "medium", "Signature3": "high"}),
    }


def build_marker_dictionary_table() -> dict[str, Any]:
    return {
        "title": "Unity marker 事件字典与写入规范",
        "columns": ["event", "事件类别", "要求", "分析用途"],
        "rows": [[event, family, required, purpose] for event, family, required, purpose in UNITY_MARKER_DICTIONARY],
    }


def render_audit_trail(audit: dict[str, Any]) -> str:
    rows = [
        ("分析管线版本", audit.get("pipelineVersion", "")),
        ("生成时间", audit.get("generatedAt", "")),
        ("任务 ID", audit.get("jobId", "")),
        ("分析类型", audit.get("analysisType", "")),
        ("被试/汇总对象", audit.get("subjectId", "")),
        ("组内因素", audit.get("withinSubjectFactor", "")),
        ("主 planned contrast", audit.get("primaryContrast", "")),
        ("源文件 ID", "; ".join(map(str, audit.get("sourceDocumentIds", []))) if isinstance(audit.get("sourceDocumentIds"), list) else ""),
        ("GitHub Actions", audit.get("githubRunUrl", "")),
        ("Git commit", audit.get("githubSha", "")),
    ]
    table = {
        "title": "复现审计记录",
        "columns": ["项目", "记录"],
        "rows": [[label, value] for label, value in rows if value],
    }
    return render_table(table)


def render_narrative_sections(sections: list[Any]) -> str:
    parts = ["<section class='grid two narrative-grid'>"]
    for section in sections:
        if not isinstance(section, dict):
            continue
        paragraphs = section.get("paragraphs") if isinstance(section.get("paragraphs"), list) else []
        if not paragraphs:
            continue
        parts.append("<article class='card narrative-card'>")
        parts.append(f"<h2>{h(section.get('title', '结果解读'))}</h2>")
        for paragraph in paragraphs:
            parts.append(f"<p>{h(paragraph)}</p>")
        parts.append("</article>")
    parts.append("</section>")
    return "".join(parts)


def render_chart(chart: dict[str, Any]) -> str:
    chart_type = str(chart.get("type") or "bar")
    if chart_type == "scatter":
        return render_scatter_chart(chart)
    if chart_type == "profile":
        return render_profile_chart(chart)
    if chart_type == "heatmap":
        return render_heatmap_chart(chart)
    if chart_type == "forest":
        return render_forest_chart(chart)
    if chart_type == "timeline":
        return render_timeline_chart(chart)
    return render_bar_chart(chart)


def render_bar_chart(chart: dict[str, Any]) -> str:
    data = chart.get("data") if isinstance(chart.get("data"), list) else []
    rows = []
    for item in data:
        if not isinstance(item, dict):
            continue
        value = to_float(item.get("value"))
        if value is not None:
            rows.append((str(item.get("label", "")), value))
    if not rows:
        return "<p class='muted'>没有可绘制数据。</p>"

    width, height = 760, 280
    left, right, top, bottom = 72, 24, 28, 58
    plot_w = width - left - right
    plot_h = height - top - bottom
    values = [value for _label, value in rows]
    min_value = min(0.0, min(values))
    max_value = max(0.0, max(values))
    span = max(1e-9, max_value - min_value)
    zero_y = top + plot_h - (0.0 - min_value) / span * plot_h
    gap = 12
    bar_w = max(14, (plot_w - gap * (len(rows) - 1)) / max(1, len(rows)))
    parts = [f"<svg class='chart' viewBox='0 0 {width} {height}' role='img'>"]
    parts.append(f"<line x1='{left}' y1='{zero_y:.1f}' x2='{left + plot_w}' y2='{zero_y:.1f}' stroke='#94a3b8'/>")
    for index, (label, value) in enumerate(rows):
        x = left + index * (bar_w + gap)
        value_y = top + plot_h - (value - min_value) / span * plot_h
        y = min(value_y, zero_y)
        bar_h = max(2, abs(zero_y - value_y))
        color = "#3f7f75" if value >= 0 else "#c95f4a"
        value_label_y = y - 7 if value >= 0 else y + bar_h + 15
        parts.append(f"<rect x='{x:.1f}' y='{y:.1f}' width='{bar_w:.1f}' height='{bar_h:.1f}' fill='{color}' rx='4'/>")
        parts.append(f"<text x='{x + bar_w / 2:.1f}' y='{value_label_y:.1f}' class='svg-label' text-anchor='middle'>{h(fmt(value))}</text>")
        parts.append(f"<text x='{x + bar_w / 2:.1f}' y='{height - 28}' class='svg-small' text-anchor='middle'>{h(short_label(label))}</text>")
    parts.append("</svg>")
    return "".join(parts)


def render_scatter_chart(chart: dict[str, Any]) -> str:
    data = chart.get("data") if isinstance(chart.get("data"), list) else []
    points = []
    for item in data:
        if not isinstance(item, dict):
            continue
        x_value = to_float(item.get("x"))
        y_value = to_float(item.get("y"))
        if x_value is not None and y_value is not None:
            points.append((str(item.get("label", "")), x_value, y_value, str(item.get("group") or "")))
    if not points:
        return "<p class='muted'>没有可绘制数据。</p>"

    width, height = 760, 320
    left, right, top, bottom = 72, 32, 28, 52
    plot_w = width - left - right
    plot_h = height - top - bottom
    x_values = [point[1] for point in points]
    y_values = [point[2] for point in points]
    min_x, max_x = min(x_values), max(x_values)
    min_y, max_y = min(y_values), max(y_values)
    x_pad = max(1e-9, (max_x - min_x) * 0.08)
    y_pad = max(1e-9, (max_y - min_y) * 0.08)
    min_x -= x_pad
    max_x += x_pad
    min_y -= y_pad
    max_y += y_pad

    def scale(value: float, low: float, high: float, size: float) -> float:
        if abs(high - low) < 1e-12:
            return size / 2
        return (value - low) / (high - low) * size

    group_colors: dict[str, str] = {}
    parts = [f"<svg class='chart' viewBox='0 0 {width} {height}' role='img'>"]
    parts.append(f"<rect x='{left}' y='{top}' width='{plot_w}' height='{plot_h}' fill='#fff' stroke='#d8e1df'/>")
    for label, x_value, y_value, group in points:
        if group and group not in group_colors:
            group_colors[group] = chart_color(len(group_colors))
        color = group_colors.get(group, "#3f7f75")
        x = left + scale(x_value, min_x, max_x, plot_w)
        y = top + plot_h - scale(y_value, min_y, max_y, plot_h)
        parts.append(f"<circle cx='{x:.1f}' cy='{y:.1f}' r='6' fill='{color}' opacity='0.88'><title>{h(label)}: {h(fmt(x_value))}, {h(fmt(y_value))}</title></circle>")
    parts.append(f"<text x='{left}' y='{height - 18}' class='svg-small'>{h(fmt(min_x))} → {h(fmt(max_x))}</text>")
    parts.append(f"<text x='{left}' y='{top - 8}' class='svg-small'>{h(fmt(min_y))} → {h(fmt(max_y))}</text>")
    parts.append("</svg>")
    return "".join(parts) + render_legend(group_colors)


def render_profile_chart(chart: dict[str, Any]) -> str:
    conditions = [str(item) for item in chart.get("conditions", []) if str(item)]
    series = chart.get("series") if isinstance(chart.get("series"), list) else []
    prepared = []
    all_values = []
    for item in series:
        if not isinstance(item, dict):
            continue
        values = [to_float(value) for value in item.get("values", [])]
        if len(values) != len(conditions):
            continue
        if not any(value is not None for value in values):
            continue
        prepared.append({"label": str(item.get("label", "")), "values": values})
        all_values.extend(value for value in values if value is not None and math.isfinite(value))
    if not conditions or not prepared or not all_values:
        return "<p class='muted'>没有可绘制数据。</p>"

    width, height = 760, 330
    left, right, top, bottom = 82, 28, 34, 66
    plot_w = width - left - right
    plot_h = height - top - bottom
    min_value = min(all_values)
    max_value = max(all_values)
    if min_value > 0:
        min_value = 0.0
    if max_value < 0:
        max_value = 0.0
    pad = max(0.2, (max_value - min_value) * 0.12)
    min_value -= pad
    max_value += pad

    def scale_y(value: float) -> float:
        if abs(max_value - min_value) < 1e-12:
            return top + plot_h / 2
        return top + plot_h - (value - min_value) / (max_value - min_value) * plot_h

    def scale_x(index: int) -> float:
        if len(conditions) == 1:
            return left + plot_w / 2
        return left + index / (len(conditions) - 1) * plot_w

    parts = [f"<svg class='chart' viewBox='0 0 {width} {height}' role='img'>"]
    parts.append(f"<rect x='{left}' y='{top}' width='{plot_w}' height='{plot_h}' fill='#fff' stroke='#d8e1df'/>")
    for tick in range(5):
        value = min_value + (max_value - min_value) * tick / 4
        y = scale_y(value)
        parts.append(f"<line x1='{left}' y1='{y:.1f}' x2='{left + plot_w}' y2='{y:.1f}' stroke='#edf2f1'/>")
        parts.append(f"<text x='{left - 8}' y='{y + 4:.1f}' class='svg-small' text-anchor='end'>{h(fmt(value))}</text>")
    zero_y = scale_y(0.0)
    parts.append(f"<line x1='{left}' y1='{zero_y:.1f}' x2='{left + plot_w}' y2='{zero_y:.1f}' stroke='#9aa8a5' stroke-dasharray='4 4'/>")
    for index, label in enumerate(conditions):
        x = scale_x(index)
        parts.append(f"<line x1='{x:.1f}' y1='{top}' x2='{x:.1f}' y2='{top + plot_h}' stroke='#f0f4f3'/>")
        parts.append(f"<text x='{x:.1f}' y='{height - 32}' class='svg-label' text-anchor='middle'>{h(short_label(label, 16))}</text>")

    legend: dict[str, str] = {}
    for series_index, item in enumerate(prepared):
        color = chart_color(series_index)
        label = str(item["label"])
        legend[label] = color
        points_for_line = []
        for index, value in enumerate(item["values"]):
            if value is None:
                continue
            points_for_line.append((scale_x(index), scale_y(value), value, conditions[index]))
        if len(points_for_line) >= 2:
            path = " ".join(f"{'M' if point_index == 0 else 'L'} {x:.1f} {y:.1f}" for point_index, (x, y, _value, _condition) in enumerate(points_for_line))
            parts.append(f"<path d='{path}' fill='none' stroke='{color}' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'/>")
        for x, y, value, condition in points_for_line:
            parts.append(f"<circle cx='{x:.1f}' cy='{y:.1f}' r='5.5' fill='{color}'><title>{h(label)} / {h(condition)}: {h(fmt(value))}</title></circle>")
    parts.append("</svg>")
    return "".join(parts) + render_legend(legend)


def render_heatmap_chart(chart: dict[str, Any]) -> str:
    columns = [str(item) for item in chart.get("columns", []) if str(item)]
    rows = chart.get("rows") if isinstance(chart.get("rows"), list) else []
    if not columns or not rows:
        return "<p class='muted'>没有可绘制数据。</p>"

    parts = ["<div class='heatmap-wrap'><table class='heatmap-table'><thead><tr><th>指标</th>"]
    for column in columns:
        parts.append(f"<th>{h(column)}</th>")
    parts.append("</tr></thead><tbody>")
    has_data = False
    for row in rows:
        if not isinstance(row, dict):
            continue
        label = str(row.get("label") or "")
        values = [to_float(value) for value in row.get("values", [])]
        if len(values) != len(columns):
            continue
        numeric = [value for value in values if value is not None and math.isfinite(value)]
        row_min = min(numeric) if numeric else None
        row_max = max(numeric) if numeric else None
        has_data = has_data or bool(numeric)
        parts.append(f"<tr><td class='heatmap-label'>{h(label)}</td>")
        for value in values:
            if value is None:
                parts.append("<td class='heatmap-empty'>-</td>")
                continue
            intensity = 0.45
            if row_min is not None and row_max is not None and abs(row_max - row_min) > 1e-12:
                intensity = (value - row_min) / (row_max - row_min)
            parts.append(f"<td class='heatmap-cell' style='background:{heat_color(intensity)}'>{h(fmt(value))}</td>")
        parts.append("</tr>")
    parts.append("</tbody></table></div>")
    if not has_data:
        return "<p class='muted'>没有可绘制数据。</p>"
    return "".join(parts)


def render_forest_chart(chart: dict[str, Any]) -> str:
    data = chart.get("data") if isinstance(chart.get("data"), list) else []
    rows = []
    for item in data:
        if not isinstance(item, dict):
            continue
        mean = to_float(item.get("mean"))
        ci_low = to_float(item.get("ciLow"))
        ci_high = to_float(item.get("ciHigh"))
        if mean is None:
            continue
        rows.append(
            {
                "label": str(item.get("label") or ""),
                "mean": mean,
                "ciLow": ci_low if ci_low is not None else mean,
                "ciHigh": ci_high if ci_high is not None else mean,
                "p": item.get("p"),
                "n": item.get("n"),
            }
        )
    if not rows:
        return "<p class='muted'>没有可绘制数据。</p>"

    width = 900
    row_h = 42
    height = 68 + row_h * len(rows)
    left, right, top = 248, 126, 34
    plot_w = width - left - right
    min_value = min(min(row["ciLow"], row["mean"]) for row in rows)
    max_value = max(max(row["ciHigh"], row["mean"]) for row in rows)
    min_value = min(min_value, 0.0)
    max_value = max(max_value, 0.0)
    pad = max(0.08, (max_value - min_value) * 0.12)
    min_value -= pad
    max_value += pad

    def scale_x(value: float) -> float:
        if abs(max_value - min_value) < 1e-12:
            return left + plot_w / 2
        return left + (value - min_value) / (max_value - min_value) * plot_w

    zero_x = scale_x(0.0)
    parts = [f"<svg class='chart' viewBox='0 0 {width} {height}' role='img'>"]
    parts.append(f"<line x1='{zero_x:.1f}' y1='{top - 10}' x2='{zero_x:.1f}' y2='{height - 32}' stroke='#9aa8a5' stroke-dasharray='4 4'/>")
    parts.append(f"<text x='{left}' y='{height - 12}' class='svg-small'>{h(fmt(min_value))}</text>")
    parts.append(f"<text x='{left + plot_w}' y='{height - 12}' class='svg-small' text-anchor='end'>{h(fmt(max_value))}</text>")
    for index, row in enumerate(rows):
        y = top + index * row_h + 18
        color = "#3f7f75" if row["mean"] >= 0 else "#c95f4a"
        x_low = scale_x(row["ciLow"])
        x_high = scale_x(row["ciHigh"])
        x_mean = scale_x(row["mean"])
        parts.append(f"<text x='18' y='{y + 4:.1f}' class='svg-label'>{h(short_label(row['label'], 34))}</text>")
        parts.append(f"<line x1='{left}' y1='{y:.1f}' x2='{left + plot_w}' y2='{y:.1f}' stroke='#f0f4f3'/>")
        parts.append(f"<line x1='{x_low:.1f}' y1='{y:.1f}' x2='{x_high:.1f}' y2='{y:.1f}' stroke='{color}' stroke-width='3' stroke-linecap='round'/>")
        parts.append(f"<circle cx='{x_mean:.1f}' cy='{y:.1f}' r='6' fill='{color}'><title>{h(row['label'])}: mean {h(fmt(row['mean']))}, 95% CI [{h(fmt(row['ciLow']))}, {h(fmt(row['ciHigh']))}], p={h(fmt_p(row['p']))}</title></circle>")
        parts.append(f"<text x='{width - 18}' y='{y + 4:.1f}' class='svg-small' text-anchor='end'>n={h(row['n'])} p={h(fmt_p(row['p']))}</text>")
    parts.append("</svg>")
    return "".join(parts)


def render_timeline_chart(chart: dict[str, Any]) -> str:
    data = chart.get("data") if isinstance(chart.get("data"), list) else []
    lanes = chart.get("lanes") if isinstance(chart.get("lanes"), list) else ["audio", "sign", "decision", "inefficiency", "completion"]
    lane_labels = chart.get("laneLabels") if isinstance(chart.get("laneLabels"), dict) else {}
    points = []
    for item in data:
        if not isinstance(item, dict):
            continue
        x_value = to_float(item.get("x"))
        lane = str(item.get("lane") or item.get("family") or "")
        if x_value is None or lane not in lanes:
            continue
        points.append({"label": str(item.get("label") or ""), "x": x_value, "lane": lane})
    if not points:
        return "<p class='muted'>没有可绘制数据。</p>"

    width, height = 900, max(300, 86 + len(lanes) * 48)
    left, right, top, bottom = 126, 38, 30, 50
    plot_w = width - left - right
    plot_h = height - top - bottom
    min_x = min(point["x"] for point in points)
    max_x = max(point["x"] for point in points)
    min_x = min(0.0, min_x)
    max_x = max(max_x, 1.0)

    def scale_x(value: float) -> float:
        if abs(max_x - min_x) < 1e-12:
            return left + plot_w / 2
        return left + (value - min_x) / (max_x - min_x) * plot_w

    def lane_y(lane: str) -> float:
        index = lanes.index(lane)
        if len(lanes) == 1:
            return top + plot_h / 2
        return top + index / (len(lanes) - 1) * plot_h

    lane_colors = {lane: chart_color(index) for index, lane in enumerate(lanes)}
    parts = [f"<svg class='chart' viewBox='0 0 {width} {height}' role='img'>"]
    for lane in lanes:
        y = lane_y(lane)
        label = str(lane_labels.get(lane) or lane)
        parts.append(f"<text x='18' y='{y + 4:.1f}' class='svg-label'>{h(label)}</text>")
        parts.append(f"<line x1='{left}' y1='{y:.1f}' x2='{left + plot_w}' y2='{y:.1f}' stroke='#d8e1df'/>")
    for point in points:
        x = scale_x(point["x"])
        y = lane_y(point["lane"])
        color = lane_colors[point["lane"]]
        parts.append(f"<circle cx='{x:.1f}' cy='{y:.1f}' r='5.5' fill='{color}' opacity='0.82'><title>{h(point['label'])}: {h(fmt(point['x']))} s</title></circle>")
    parts.append(f"<text x='{left}' y='{height - 18}' class='svg-small'>{h(fmt(min_x))} s</text>")
    parts.append(f"<text x='{left + plot_w}' y='{height - 18}' class='svg-small' text-anchor='end'>{h(fmt(max_x))} s</text>")
    parts.append("</svg>")
    return "".join(parts) + render_legend({str(lane_labels.get(lane) or lane): lane_colors[lane] for lane in lanes})


def render_legend(items: dict[str, str]) -> str:
    if not items:
        return ""
    parts = ["<div class='chart-legend'>"]
    for label, color in items.items():
        parts.append(f"<span><i style='background:{color}'></i>{h(label)}</span>")
    parts.append("</div>")
    return "".join(parts)


def chart_color(index: int) -> str:
    palette = ["#3f7f75", "#c95f4a", "#4467a8", "#b8892d", "#6f5aa8", "#3b8a9c", "#9a5b52", "#557a3d"]
    return palette[index % len(palette)]


def heat_color(intensity: float) -> str:
    intensity = max(0.0, min(1.0, float(intensity)))
    base = np.array([245, 248, 247], dtype=float)
    high = np.array([63, 127, 117], dtype=float)
    rgb = base * (1.0 - intensity) + high * intensity
    return f"rgb({int(rgb[0])}, {int(rgb[1])}, {int(rgb[2])})"


def render_table(table: dict[str, Any]) -> str:
    columns = table.get("columns") if isinstance(table.get("columns"), list) else []
    rows = table.get("rows") if isinstance(table.get("rows"), list) else []
    parts = ["<section class='card table-card'>", f"<h2>{h(table.get('title', 'Table'))}</h2>", "<div class='table-wrap'><table><thead><tr>"]
    for column in columns:
        parts.append(f"<th>{h(column)}</th>")
    parts.append("</tr></thead><tbody>")
    for row in rows:
        if not isinstance(row, list):
            continue
        parts.append("<tr>")
        for cell in row:
            parts.append(f"<td>{h(cell)}</td>")
        parts.append("</tr>")
    parts.append("</tbody></table></div></section>")
    return "".join(parts)


def build_model_overview(scope: str) -> dict[str, Any]:
    if scope == "single_xdf":
        purpose = "本报告把一个 LabRecorder XDF run 映射到路径确认信息链模型，用于检查 EEG stream、Unity marker 与关键行为/事件窗指标。"
        remarks = [
            "单个 run 只能用于质控和特征提取，不能支持显著性结论。",
            "准确率、可靠性感知和保护性行动指令清晰度如果没有写入 marker 或 metadata，需要在后续表格中补充。",
        ]
    elif scope == "subject_batch":
        purpose = "本报告把同一被试的低、中、高路径确认支持 run 作为一个组内单元，比较行动迟滞、准确率线索和 EEG 信息加工负荷。"
        remarks = [
            "被试内报告给出方向性 contrast，显著性需要进入全样本统计。",
            "主 contrast 为 medium - mean(low, high)，正值表示中等支持高于低/高支持平均。",
        ]
    else:
        purpose = "本报告汇总已完成被试批量报告，用于检验路径确认支持水平的组内主效应和主 planned contrast。"
        remarks = [
            "全样本结论应优先报告预先指定的主指标，再报告探索性指标。",
            "被试间或调节结论需要 subject/run metadata，例如保护性行动指令清晰度、提醒通道、VR 经验或专业背景。",
        ]

    return {
        "purpose": purpose,
        "variables": PROJECT_MODEL_VARIABLES,
        "hypotheses": PROJECT_HYPOTHESES,
        "remarks": remarks,
    }


def run_subject_batch_job(client: SupabaseRest, job: dict[str, Any], run_url: str) -> dict[str, Any]:
    batch = extract_batch_payload(job)
    document_ids = batch.get("documentIds", [])
    if len(document_ids) < 2:
        raise RuntimeError("subject_batch 任务缺少 documentIds；至少需要 2 个 XDF，正式数据推荐低/中/高路径确认支持 3 个 run。")

    id_filter = ",".join(document_ids)
    documents = client.select_many("research_documents", f"id=in.({id_filter})&select=*")
    documents_by_id = {document["id"]: document for document in documents}
    ordered_documents = [documents_by_id[document_id] for document_id in document_ids if document_id in documents_by_id]
    if len(ordered_documents) != len(document_ids):
        raise RuntimeError("subject_batch 中有 XDF 文件在 research_documents 中找不到。")

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        reports = []
        for index, document in enumerate(ordered_documents, start=1):
            if get_extension(document["filename"]) != "xdf":
                raise RuntimeError(f"subject_batch 只接受 XDF：{document['filename']} 的扩展名并非 .xdf。")
            local_file = tmp_path / f"run-{index:03d}.xdf"
            client.update_job(
                job["id"],
                {
                    "status": "running",
                    "status_message": f"正在分析被试 {batch.get('subjectId', 'unknown')} 的路径确认支持条件 run：{index}/{len(ordered_documents)} {document['filename']}",
                    "github_run_url": run_url,
                },
            )
            client.download_storage_object(document["storage_path"], local_file)
            reports.append(analyze_xdf(document, local_file))

    return analyze_subject_batch(batch, ordered_documents, reports)


def extract_batch_payload(job: dict[str, Any]) -> dict[str, Any]:
    payload = job.get("result_json") or {}
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except json.JSONDecodeError:
            payload = {}
    batch = payload.get("batch") if isinstance(payload, dict) else None
    if not isinstance(batch, dict):
        raise RuntimeError("subject_batch 任务缺少 batch payload。")
    return batch


def run_cohort_density_job(client: SupabaseRest, job: dict[str, Any]) -> dict[str, Any]:
    cohort_payload = extract_cohort_payload(job)
    group_variable = str(cohort_payload.get("groupVariable") or "group").strip() or "group"
    metadata_rows = parse_subject_metadata_csv(str(cohort_payload.get("subjectMetadataCsv") or ""))
    metadata_by_subject = build_metadata_by_subject(metadata_rows)
    rows = client.select_many(
        "research_analysis_jobs",
        f"user_id=eq.{job['user_id']}&analysis_type=eq.subject_batch&status=eq.completed&select=id,result_json,created_at,completed_at&limit=1000",
    )
    subject_rows = extract_subject_contrast_rows(rows)
    if not subject_rows:
        raise RuntimeError("还没有可汇总的已完成被试批量报告；请先为若干被试运行低/中/高路径确认支持 XDF 批量分析。")
    return analyze_cohort_density(subject_rows, metadata_by_subject, group_variable)


def extract_cohort_payload(job: dict[str, Any]) -> dict[str, Any]:
    payload = job.get("result_json") or {}
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except json.JSONDecodeError:
            payload = {}
    cohort = payload.get("cohort") if isinstance(payload, dict) else None
    return cohort if isinstance(cohort, dict) else {}


def parse_subject_metadata_csv(text: str) -> list[dict[str, str]]:
    if not text.strip():
        return []
    stream = io.StringIO(text.strip())
    try:
        reader = csv.DictReader(stream)
        return [
            {str(key).strip(): str(value or "").strip() for key, value in row.items() if key is not None}
            for row in reader
            if any(str(value or "").strip() for value in row.values())
        ]
    except csv.Error:
        return []


def build_metadata_by_subject(rows: list[dict[str, str]]) -> dict[str, dict[str, str]]:
    aliases = ("participant_id", "participant", "subject_id", "subject", "id", "被试编号", "被试", "participantId", "subjectId")
    metadata: dict[str, dict[str, str]] = {}
    for row in rows:
        raw_subject = ""
        for alias in aliases:
            if row.get(alias):
                raw_subject = row[alias]
                break
        subject_id = normalize_participant_id(raw_subject)
        if subject_id:
            metadata[subject_id] = row
    return metadata


def normalize_participant_id(value: Any) -> str:
    import re

    text = str(value or "").strip()
    if not text:
        return ""
    p_match = re.search(r"^p[-_\s]?0*(\d{1,3})$", text, re.IGNORECASE)
    if p_match:
        return f"P{int(p_match.group(1)):02d}"
    sub_match = re.search(r"^sub[-_\s]?0*(\d{1,4})$", text, re.IGNORECASE)
    if sub_match:
        value_int = int(sub_match.group(1))
        return f"P{math.ceil(value_int / 3):02d}"
    digits = re.search(r"^0*(\d{1,3})$", text)
    if digits:
        return f"P{int(digits.group(1)):02d}"
    return text


def extract_subject_contrast_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    extracted: list[dict[str, Any]] = []
    for row in rows:
        payload = row.get("result_json") or {}
        if isinstance(payload, str):
            try:
                payload = json.loads(payload)
            except json.JSONDecodeError:
                payload = {}
        if not isinstance(payload, dict):
            continue
        subject_id = str(payload.get("subjectId") or payload.get("title") or row.get("id", "subject-unknown"))
        contrasts = payload.get("supportContrasts") or payload.get("densityContrasts")
        if not isinstance(contrasts, list):
            continue
        for contrast in contrasts:
            if not isinstance(contrast, dict):
                continue
            estimate = to_float(contrast.get("estimate"))
            metric = str(contrast.get("metric") or "")
            if estimate is None or not metric:
                continue
            extracted.append(
                {
                    "subject": subject_id,
                    "metric": metric,
                    "metricLabel": str(contrast.get("metricLabel") or metric),
                    "estimate": estimate,
                    "direction": str(contrast.get("direction") or ""),
                    "jobId": row.get("id", ""),
                    "completedAt": row.get("completed_at") or row.get("created_at") or "",
                }
            )
    return extracted


def analyze_cohort_density(
    subject_rows: list[dict[str, Any]],
    metadata_by_subject: dict[str, dict[str, str]] | None = None,
    group_variable: str = "group",
) -> dict[str, Any]:
    metadata_by_subject = metadata_by_subject or {}
    subject_rows = attach_metadata_to_subject_rows(subject_rows, metadata_by_subject, group_variable)
    by_metric: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in subject_rows:
        by_metric[row["metric"]].append(row)

    summary_rows = []
    metric_charts = []
    metric_n_charts = []
    metric_p_charts = []
    forest_data = []
    primary_behavior_result = None
    primary_eeg_result = None
    fallback_eeg_result = None
    for metric, rows in sorted(by_metric.items(), key=lambda item: metric_priority(item[0])):
        values = [float(row["estimate"]) for row in rows]
        stats = one_sample_contrast_stats(values)
        metric_label = str(rows[0].get("metricLabel") or metric)
        conclusion = contrast_conclusion(stats, metric)
        result_payload = {**stats, "metricLabel": metric_label, "conclusion": conclusion}
        if metric == "route_decision_hesitation_index":
            primary_behavior_result = result_payload
        elif metric == "eeg_information_processing_load_index":
            primary_eeg_result = result_payload
        elif metric == "eeg_load_proxy":
            fallback_eeg_result = result_payload
        summary_rows.append(
            [
                metric_label,
                str(stats["n"]),
                fmt(stats["mean"]),
                format_ci(stats),
                fmt(stats["t"]),
                fmt_p(stats["p"]),
                fmt(stats["dz"]),
                conclusion,
            ]
        )
        metric_charts.append({"label": metric_label, "value": safe_chart_value(stats["mean"])})
        metric_n_charts.append({"label": metric_label, "value": safe_chart_value(stats["n"])})
        if stats["p"] is not None:
            metric_p_charts.append({"label": metric_label, "value": safe_chart_value(stats["p"])})
        forest_data.append(
            {
                "label": metric_label,
                "mean": stats["mean"],
                "ciLow": stats["ci_low"],
                "ciHigh": stats["ci_high"],
                "p": stats["p"],
                "n": stats["n"],
            }
        )

    subject_table_rows = [
        [
            str(row["subject"]),
            str(row.get("group") or "-"),
            str(row["metricLabel"]),
            fmt(row["estimate"]),
            str(row["direction"]),
            str(row["completedAt"])[:19],
        ]
        for row in sorted(subject_rows, key=lambda item: (str(item["subject"]), metric_priority(str(item["metric"]))))[:600]
    ]
    unique_subjects = sorted({str(row["subject"]) for row in subject_rows})
    metadata_subjects = sorted(set(metadata_by_subject))
    matched_metadata_subjects = sorted({str(row["subject"]) for row in subject_rows if row.get("metadataMatched")})
    group_levels = sorted({str(row.get("group")) for row in subject_rows if row.get("group")})
    between_rows, between_chart = build_between_subject_group_results(subject_rows, group_variable)
    primary_eeg_result = primary_eeg_result or fallback_eeg_result
    behavior_text = format_primary_result("H1 行动迟滞", primary_behavior_result)
    eeg_text = format_primary_result("H3 EEG 信息加工负荷", primary_eeg_result)

    notes = [
        "该报告只汇总已经完成的被试批量 XDF HTML/JSON 结果；未完成、失败或路径确认支持条件缺失的被试不会进入统计。",
        "主检验是每名被试的 medium - mean(low, high) contrast 是否显著大于 0；这是组内设计最直接的检验。",
        "没有 metadata 时，被试差异主要通过 Subject 随机效应处理；被试间分析使用 subject metadata 中的变量列，只比较已经完成三条件被试报告且能匹配 metadata 的被试。",
        "结论写作应优先报告预先指定的主指标，再把行为和其他 EEG 指标作为一致性证据或探索性结果。",
    ]
    if metadata_by_subject and not matched_metadata_subjects:
        notes.append("metadata 已提供，但没有被试编号与已完成批量报告匹配；请检查 participant_id 是否使用 P01、P02 这类分析层编号。")
    if group_levels and any(sum(1 for row in subject_rows if row.get("metric") == "route_decision_hesitation_index" and row.get("group") == group) < 2 for group in group_levels):
        notes.append("被试间变量的部分水平在主指标上少于 2 名被试；报告会保留描述性均值，暂不把被试间差异写成显著性结论。")

    return {
        "title": "全样本路径确认支持统计汇总",
        "kind": "Cohort Route-confirmation Support Summary",
        "subjectId": "cohort-density-summary",
        "summary": f"从 {len(unique_subjects)} 名被试的已完成批量报告中汇总低/中/高路径确认支持 planned contrast。{behavior_text}；{eeg_text}。{format_between_subject_summary(group_variable, group_levels, between_rows)}",
        "modelOverview": build_model_overview("cohort"),
        "narrativeSections": build_cohort_narrative(unique_subjects, primary_behavior_result, primary_eeg_result, summary_rows, group_variable, group_levels, between_rows),
        "design": {
            "expected_subjects": 90,
            "runs_per_subject": 3,
            "expected_total_runs": 270,
            "file_coding_rule": "001/002/003 = participant P01; 004/005/006 = P02; each triplet is one within-subject route-confirmation support set",
            "within_subject_factor": "route-confirmation support level",
            "signature_mapping": {"Signature1": "low", "Signature2": "medium", "Signature3": "high"},
            "primary_contrast": "medium - mean(low, high)",
        },
        "metrics": [
            {"label": "已纳入被试", "value": f"{len(unique_subjects)}/90"},
            {"label": "contrast 行", "value": str(len(subject_rows))},
            {"label": "metadata 匹配", "value": f"{len(matched_metadata_subjects)}/{len(metadata_subjects)}" if metadata_subjects else "未提供"},
            {"label": "被试间变量", "value": group_variable if group_levels else "未启用", "text": " / ".join(group_levels) if group_levels else ""},
            {"label": "H1 行动迟滞", "value": primary_behavior_result["conclusion"] if primary_behavior_result else "未形成", "text": behavior_text},
            {"label": "H3 EEG 负荷", "value": primary_eeg_result["conclusion"] if primary_eeg_result else "未形成", "text": eeg_text},
        ],
        "charts": [
            {
                "type": "forest",
                "title": "主 planned contrast 及 95% 置信区间",
                "xLabel": "medium - mean(low, high)",
                "yLabel": "metric",
                "data": forest_data,
                "wide": True,
                "caption": "零线右侧表示中等路径确认支持高于低/高支持平均；置信区间跨过零时，方向性结果仍需谨慎解释。",
            },
            between_chart,
            {
                "type": "bar",
                "title": "各指标主 contrast 均值",
                "xLabel": "metric",
                "yLabel": "medium - mean(low, high)",
                "data": metric_charts,
                "caption": "正值表示中等路径确认支持高于低/高支持平均，符合主假设方向；负值表示方向相反或不支持。",
            },
            {
                "type": "bar",
                "title": "各指标纳入被试数",
                "xLabel": "metric",
                "yLabel": "n",
                "data": metric_n_charts,
                "caption": "不同指标的可用被试数可能不同；正式写作时应报告主指标的 n，并说明缺失原因。",
            },
            {
                "type": "bar",
                "title": "各指标 p 值概览",
                "xLabel": "metric",
                "yLabel": "p value",
                "data": metric_p_charts,
                "caption": "该图仅用于快速检查，不替代多重比较控制和预注册主指标判断。",
            }
        ],
        "tables": [
            {
                "title": "组内 planned contrast 显著性汇总",
                "columns": ["metric", "n", "mean", "95% CI", "t", "p", "Cohen dz", "结论"],
                "rows": summary_rows,
            },
            {
                "title": f"被试间 metadata 描述与检验（变量列：{group_variable}）",
                "columns": ["metric", "变量水平", "test", "statistic", "p", "interpretation"],
                "rows": between_rows or [["-", "-", "-", "-", "-", "未提供可匹配的 subject metadata；当前报告只做总体组内汇总。"]],
            },
            {
                "title": "被试级 contrast 明细",
                "columns": ["subject", group_variable, "metric", "estimate", "direction", "completed_at"],
                "rows": subject_table_rows,
            },
            {
                "title": "正式统计模型与论文报告口径",
                "columns": ["目标", "推荐模型/检验", "论文写法边界"],
                "rows": [
                    ["组内主假设", "对每名被试计算 medium - mean(low, high)，再做 one-sample test；等价 mixed model contrast 可作为稳健性检验。", "只有主指标方向、置信区间和 p 值同时支持时，才写作支持中等路径确认支持最高负荷假设。"],
                    ["被试间差异", f"用 subject metadata 的 {group_variable} 比较 subject-level contrast；正式模型可写 Load ~ SupportLevel * {group_variable} + RunOrder + Map + (1 + SupportLevel | Subject)。", "2 名被试或变量水平样本过少时只描述趋势，不报告显著性结论。"],
                    ["指标层级", "行动迟滞和 EEG 信息加工负荷作为主指标；准确率、确认链不流畅、停留/扫描/回退作为机制和操纵检查。", "探索性指标需与主指标分开报告，避免把所有指标都写成主结果。"],
                    ["缺失与排除", "排除缺低/中/高条件、缺 completion marker、EEG 覆盖不足或事件窗过少的 run，并在审计记录中保留源文件。", "排除规则应在结果前说明，不能事后按显著性筛选。"],
                ],
            },
            {
                "title": "下一步被试间模型",
                "columns": ["需要字段", "模型", "用途"],
                "rows": [
                    ["subject_id, 被试间变量", "Load ~ SupportLevel * BetweenSubjectVariable + RunOrder + Map + (1 + SupportLevel | Subject)", "检验不同被试属性是否对应不同路径确认支持效应"],
                    ["order/counterbalance", "Load ~ SupportLevel + Order + SupportLevel:Order + (1 + SupportLevel | Subject)", "控制顺序、练习和疲劳效应"],
                    ["trial_features/event_features", "event-level 或 trial-level mixed model", "把 sign_readable、decision_point_enter 等事件窗指标纳入更细粒度模型"],
                ],
            },
        ],
        "notes": notes,
    }


def attach_metadata_to_subject_rows(
    subject_rows: list[dict[str, Any]],
    metadata_by_subject: dict[str, dict[str, str]],
    group_variable: str,
) -> list[dict[str, Any]]:
    enriched = []
    for row in subject_rows:
        subject = normalize_participant_id(row.get("subject")) or str(row.get("subject") or "")
        metadata = metadata_by_subject.get(subject, {})
        next_row = {**row, "subject": subject}
        if metadata:
            next_row["metadataMatched"] = True
            next_row["metadata"] = metadata
            next_row["group"] = metadata.get(group_variable) or metadata.get(group_variable.strip()) or ""
        else:
            next_row["metadataMatched"] = False
            next_row["group"] = ""
        enriched.append(next_row)
    return enriched


def build_between_subject_group_results(subject_rows: list[dict[str, Any]], group_variable: str) -> tuple[list[list[str]], dict[str, Any]]:
    metrics_for_chart = {
        "route_decision_hesitation_index",
        "route_confirmation_disfluency_index",
        "eeg_information_processing_load_index",
        "decision_choice_accuracy_ratio",
    }
    by_metric: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in subject_rows:
        if row.get("group"):
            by_metric[str(row["metric"])].append(row)

    table_rows: list[list[str]] = []
    heatmap_groups: list[str] = []
    heatmap_rows: list[dict[str, Any]] = []
    flat_data = []

    for metric, rows in sorted(by_metric.items(), key=lambda item: metric_priority(item[0])):
        metric_label = str(rows[0].get("metricLabel") or metric)
        grouped_values: dict[str, list[float]] = defaultdict(list)
        for row in rows:
            group = str(row.get("group") or "").strip()
            estimate = to_float(row.get("estimate"))
            if group and estimate is not None:
                grouped_values[group].append(float(estimate))
        if len(grouped_values) < 2:
            continue

        group_names = sorted(grouped_values)
        heatmap_groups = sorted(set(heatmap_groups) | set(group_names))
        group_summary = "; ".join(
            f"{name}: n={len(values)}, mean={fmt(float(np.mean(values)) if values else None)}"
            for name, values in ((name, grouped_values[name]) for name in group_names)
        )
        test_label, statistic, p_value, interpretation = compare_groups_for_metric(grouped_values, metric)
        table_rows.append(
            [
                metric_label,
                group_summary,
                test_label,
                statistic,
                fmt_p(p_value),
                interpretation,
            ]
        )

    if heatmap_groups:
        for metric, rows in sorted(by_metric.items(), key=lambda item: metric_priority(item[0])):
            if metric not in metrics_for_chart:
                continue
            metric_label = str(rows[0].get("metricLabel") or metric)
            grouped_values: dict[str, list[float]] = defaultdict(list)
            for row in rows:
                group = str(row.get("group") or "").strip()
                estimate = to_float(row.get("estimate"))
                if group and estimate is not None:
                    grouped_values[group].append(float(estimate))
            if len(grouped_values) < 2:
                continue
            values = [float(np.mean(grouped_values[group])) if grouped_values.get(group) else None for group in heatmap_groups]
            heatmap_rows.append({"label": metric_label, "values": values})
            for group, value in zip(heatmap_groups, values):
                if value is not None:
                    flat_data.append({"label": f"{metric_label} / {group}", "value": safe_chart_value(value)})

    chart = {
        "type": "heatmap",
        "title": f"被试间 contrast 均值矩阵（{group_variable}）",
        "columns": heatmap_groups,
        "rows": heatmap_rows,
        "data": flat_data,
        "wide": True,
        "xLabel": group_variable,
        "yLabel": "subject-level contrast",
        "caption": "每个单元格是该被试间变量水平下的 medium - mean(low, high) 平均值。样本量不足时，该图用于 pilot 趋势检查。",
    }
    return table_rows, chart


def compare_groups_for_metric(grouped_values: dict[str, list[float]], metric: str) -> tuple[str, str, Any, str]:
    groups = sorted(grouped_values)
    usable_groups = [group for group in groups if len(grouped_values[group]) >= 2]
    if len(usable_groups) < 2:
        return "descriptive only", "-", None, "每个变量水平至少需要 2 名被试才进行被试间显著性检验；当前只报告均值趋势。"

    if len(usable_groups) == 2:
        group_a, group_b = usable_groups
        values_a = np.asarray(grouped_values[group_a], dtype=float)
        values_b = np.asarray(grouped_values[group_b], dtype=float)
        try:
            from scipy import stats

            test = stats.ttest_ind(values_a, values_b, equal_var=False, nan_policy="omit")
            statistic = float(test.statistic)
            p_value = float(test.pvalue)
        except Exception:
            statistic, p_value = welch_t_fallback(values_a, values_b)
        diff = float(np.mean(values_b) - np.mean(values_a))
        interpretation = (
            f"{group_b} - {group_a} = {fmt(diff)}；"
            + ("达到常规显著性阈值。" if p_value is not None and p_value < 0.05 else "未达到常规显著性阈值或样本仍偏少。")
        )
        return "Welch two-sample t", fmt(statistic), p_value, interpretation

    try:
        from scipy import stats

        test = stats.f_oneway(*(np.asarray(grouped_values[group], dtype=float) for group in usable_groups))
        statistic = float(test.statistic)
        p_value = float(test.pvalue)
        interpretation = "检验不同被试间变量水平的 subject-level contrast 是否存在总体差异。"
        return "one-way ANOVA", fmt(statistic), p_value, interpretation
    except Exception:
        return "descriptive only", "-", None, "变量水平超过 2 且当前运行环境缺少可用 ANOVA；先报告各水平均值。"


def welch_t_fallback(values_a: np.ndarray, values_b: np.ndarray) -> tuple[float | None, float | None]:
    if len(values_a) < 2 or len(values_b) < 2:
        return None, None
    mean_a = float(np.mean(values_a))
    mean_b = float(np.mean(values_b))
    var_a = float(np.var(values_a, ddof=1))
    var_b = float(np.var(values_b, ddof=1))
    se = math.sqrt(var_a / len(values_a) + var_b / len(values_b))
    if se <= 0:
        return None, None
    t_value = (mean_a - mean_b) / se
    p_value = 2.0 * (1.0 - normal_cdf(abs(t_value)))
    return float(t_value), float(p_value)


def format_between_subject_summary(group_variable: str, group_levels: list[str], between_rows: list[list[str]]) -> str:
    if not group_levels:
        return "未提供可匹配的 subject metadata，本报告暂不进行被试间比较。"
    tested = sum(1 for row in between_rows if len(row) >= 3 and row[2] != "descriptive only")
    return f"被试间变量为 {group_variable}，当前识别到 {len(group_levels)} 个水平：{' / '.join(group_levels)}；{tested} 个指标具备被试间检验条件。"


def format_primary_result(label: str, result: dict[str, Any] | None) -> str:
    if not result:
        return f"{label}尚未形成完整汇总"
    return (
        f"{label}：{result['metricLabel']}，n={result['n']}，"
        f"mean contrast={fmt(result['mean'])}，95% CI={format_ci(result)}，"
        f"p={fmt_p(result['p'])}，{result['conclusion']}"
    )


def build_cohort_narrative(
    unique_subjects: list[str],
    primary_behavior_result: dict[str, Any] | None,
    primary_eeg_result: dict[str, Any] | None,
    summary_rows: list[list[str]],
    group_variable: str = "group",
    group_levels: list[str] | None = None,
    between_rows: list[list[str]] | None = None,
) -> list[dict[str, Any]]:
    n_subjects = len(unique_subjects)
    group_levels = group_levels or []
    between_rows = between_rows or []
    behavior_paragraph = format_primary_result("H1 行动迟滞", primary_behavior_result)
    eeg_paragraph = format_primary_result("H3 EEG 信息加工负荷", primary_eeg_result)
    supported_metrics = [row for row in summary_rows if len(row) >= 8 and ("符合" in row[7] or "高于" in row[7])]
    unsupported_metrics = [row for row in summary_rows if len(row) >= 8 and ("未呈现" in row[7] or "未高于" in row[7])]
    between_summary = format_between_subject_summary(group_variable, group_levels, between_rows)

    return [
        {
            "title": "全样本结果解读",
            "paragraphs": [
                f"当前全样本汇总纳入 {n_subjects} 名被试的已完成三条件报告。{behavior_paragraph}。",
                f"{eeg_paragraph}。",
                f"当前共有 {len(summary_rows)} 个指标进入 planned contrast 汇总，其中 {len(supported_metrics)} 个指标呈现预期方向，{len(unsupported_metrics)} 个指标未呈现预期方向。写作时应以预先指定主指标为核心，其他指标作为一致性证据或探索性补充。",
                between_summary,
            ],
        },
        {
            "title": "中文论文写作口径",
            "paragraphs": [
                "当行动迟滞和 EEG 信息加工负荷两个主指标均为正向且达到显著，可以写作：中等路径确认支持条件下，被试表现出更高的行动迟滞和信息加工负荷。若准确率指标同步改善或下降，需要分别讨论 accuracy–effort trade-off 的方向。",
                "当主指标未显著或方向不一致，结果部分应写为：当前数据尚未支持中等路径确认支持最高的主假设。讨论部分可进一步检查条件操纵、样本量、个体策略、marker 覆盖和 EEG 噪声。",
                "被试间结论需要建立在 subject metadata 和足够样本量上。报告中的被试间表使用每名被试的 subject-level contrast 做比较；完整论文可进一步用 trial-level mixed-effects model 检验 SupportLevel × 被试间变量交互。",
            ],
        },
    ]


def analyze_subject_batch(batch: dict[str, Any], documents: list[dict[str, Any]], reports: list[dict[str, Any]]) -> dict[str, Any]:
    subject_id = batch.get("subjectId") or infer_subject_id(documents[0]["filename"])
    run_rows = attach_subject_level_indices(
        sort_run_rows_by_density([extract_run_summary(document, report) for document, report in zip(documents, reports)])
    )
    maps = sorted({row.get("map", "") for row in run_rows if row.get("map")})
    signatures = sorted({row.get("signature", "") for row in run_rows if row.get("signature")})
    audio_levels = sorted({row.get("audio", "") for row in run_rows if row.get("audio")})
    clarity_levels = sorted({row.get("instruction_clarity", "") for row in run_rows if row.get("instruction_clarity") and row.get("instruction_clarity") != "-"})
    density_levels = sorted({row.get("density", "") for row in run_rows if row.get("density")}, key=density_sort_key)
    complete_density_set = set(DENSITY_LEVELS).issubset(set(density_levels))
    completed_runs = sum(1 for row in run_rows if row.get("has_completion") == "yes")
    durations = [to_float(row.get("duration_s")) for row in run_rows]
    durations = [value for value in durations if value is not None]
    contrast_rows, contrast_json = compute_density_planned_contrasts(run_rows)
    notes = []

    if len(run_rows) != 3:
        notes.append(f"当前被试批次包含 {len(run_rows)} 个 XDF；正式设计预期每名被试 3 个路径确认支持条件 run：低、中、高支持。")
    if not complete_density_set:
        notes.append(f"当前批次路径确认支持条件覆盖为 {format_density_coverage(run_rows)}；如果文件名或 Unity marker 没写 support_level/condition，需要补 subject-run 条件表。")
    if completed_runs != len(run_rows):
        notes.append("部分 run 缺少可识别的完成时长；正式统计前需要确认 map_start/trial_start 到 evacuation_complete 的窗口。")
    if not contrast_rows:
        notes.append("未能计算中等支持 planned contrast；通常是低/中/高路径确认支持没有全部识别，或对应指标缺失。")
    notes.append("单个被试报告只计算方向性 contrast，不报告显著性；显著性需要 90 名被试的 subject-level contrast 或 trial-level mixed-effects model。")
    notes.append("组内因素主轴为 route-confirmation support level；被试间变量需要额外上传 subject metadata，例如 group、sex、age、VR experience、专业背景、实验顺序或 counterbalance。")
    notes.append("正式主检验建议预注册为：中等路径确认支持下行动迟滞和信息加工负荷高于低/高支持平均，contrast weights = low:-1, medium:2, high:-1。")

    return {
        "title": f"{subject_id} 被试批量 XDF 分析",
        "kind": "Subject Batch XDF",
        "subjectId": subject_id,
        "sourceDocumentIds": [document["id"] for document in documents],
        "design": {
            "expected_subjects": 90,
            "runs_per_subject": 3,
            "expected_total_runs": 270,
            "file_coding_rule": "001/002/003 = participant P01; 004/005/006 = P02; each triplet is one within-subject route-confirmation support set",
            "within_subject_factor": "route-confirmation support level",
            "density_levels": list(DENSITY_LEVELS),
            "signature_mapping": {"Signature1": "low", "Signature2": "medium", "Signature3": "high"},
            "primary_hypothesis": "medium route-confirmation support produces the highest route-decision hesitation and information-processing load",
            "primary_contrast_weights": PRIMARY_CONTRAST_WEIGHTS,
        },
        "supportContrasts": contrast_json,
        "densityContrasts": contrast_json,
        "summary": "本报告把同一被试的低、中、高路径确认支持 XDF run 作为一个组内单元。报告先完成 EEG 与 Unity marker 质控，再汇总行动迟滞、路径判断准确率线索、确认链不流畅指标和 EEG 事件窗负荷，并计算主 planned contrast：中等支持 - 低/高支持平均。",
        "modelOverview": build_model_overview("subject_batch"),
        "narrativeSections": build_subject_batch_narrative(subject_id, run_rows, contrast_json, complete_density_set),
        "metrics": [
            {"label": "被试编号", "value": str(subject_id)},
            {"label": "XDF run", "value": f"{len(run_rows)}/3"},
            {"label": "完整 run", "value": f"{completed_runs}/{len(run_rows)}"},
            {"label": "路径确认支持条件", "value": f"{len(density_levels)}/3", "text": format_density_coverage(run_rows)},
            {"label": "地图条件", "value": str(len(maps)), "text": " / ".join(maps) or "-"},
            {"label": "标识版本", "value": str(len(signatures)), "text": " / ".join(signatures) or "-"},
            {"label": "附加条件", "value": str(len(audio_levels)), "text": " / ".join(audio_levels) or "-"},
            {"label": "指令清晰度", "value": str(len(clarity_levels)), "text": " / ".join(clarity_levels) or "待补 marker/metadata"},
            {"label": "平均时长", "value": fmt_seconds(float(np.mean(durations)) if durations else None)},
        ],
        "charts": build_subject_batch_charts(run_rows, contrast_json),
        "tables": [
            build_subject_batch_availability_table(run_rows),
            {
                "title": "被试内路径确认支持条件汇总",
                "columns": [
                    "file",
                    "support_level",
                    "subject",
                    "session",
                    "map",
                    "signage/version",
                    "extra_condition",
                    "instruction_clarity",
                    "duration_s",
                    "first_action_s",
                    "distance_m",
                    "exit",
                    "prompt_to_first_confirmation_s",
                    "first_sign_s",
                    "first_decision_s",
                    "decision_dwell_total_s",
                    "readable_signs",
                    "readable_ratio",
                    "max_confirmation_gap_s",
                    "decision_coverage",
                    "decision_points",
                    "look_count",
                    "look_balance",
                    "scan_both",
                    "u_turn",
                    "backtrack",
                    "inefficiency",
                    "decision_load",
                    "behavior_load_proxy",
                    "confirmation_disfluency",
                    "H1_hesitation_index",
                    "M1_disfluency_index",
                    "H3_eeg_load_index",
                    "eeg_load_proxy",
                    "theta_alpha_ratio",
                    "frontal_theta_4_7",
                    "posterior_alpha_8_12",
                    "sign_readable_event_load",
                    "decision_event_load",
                    "first_choice_correct",
                    "decision_accuracy",
                    "final_correct",
                    "accuracy_effort_profile",
                ],
                "rows": [
                    [
                        row["file"],
                        row["density_label"],
                        row["subject"],
                        row["session"],
                        row["map"],
                        row["signature"],
                        row["audio"],
                        row["instruction_clarity"],
                        row["duration_s"],
                        row["first_action_latency_s"],
                        row["horizontal_distance_m"],
                        row["exit_label"],
                        row["prompt_to_first_confirmation_s"],
                        row["time_to_first_sign_readable_s"],
                        row["time_to_first_decision_s"],
                        row["decision_dwell_total_s"],
                        row["sign_readable_count"],
                        row["sign_readable_ratio"],
                        row["sign_readable_max_gap_s"],
                        row["decision_point_coverage_proxy"],
                        row["decision_point_count"],
                        row["decision_total_look_count"],
                        row["decision_look_balance_abs"],
                        row["decision_scan_both_count"],
                        row["u_turn_count"],
                        row["backtrack_count"],
                        row["navigation_inefficiency_proxy"],
                        row["decision_load_proxy"],
                        row["behavior_load_proxy"],
                        row["route_confirmation_disfluency_proxy"],
                        row["route_decision_hesitation_index"],
                        row["route_confirmation_disfluency_index"],
                        row["eeg_information_processing_load_index"],
                        row["eeg_load_proxy"],
                        row["theta_alpha_ratio"],
                        row["frontal_theta_4_7"],
                        row["posterior_alpha_8_12"],
                        row["sign_readable_eeg_load_proxy"],
                        row["decision_point_enter_eeg_load_proxy"],
                        row["first_choice_correct"],
                        row["decision_choice_accuracy_ratio"],
                        row["final_arrival_correct"],
                        row["accuracy_effort_profile"],
                    ]
                    for row in run_rows
                ],
            },
            {
                "title": "主 planned contrast：中等支持是否最高",
                "columns": ["contrast", "metric", "low", "medium", "high", "estimate", "direction"],
                "rows": contrast_rows or [["medium - mean(low, high)", "-", "-", "-", "-", "-", "缺少完整路径确认支持条件或指标"]],
            },
            {
                "title": "90 被试全样本统计模型建议",
                "columns": ["分析层级", "模型/检验", "解释口径"],
                "rows": [
                    ["被试内主检验", "对每名被试计算 contrast = medium - (low + high) / 2，再对 90 个 contrast 做 one-sample test 或等价 mixed model contrast", "直接回答中等支持是否显著高于低/高支持平均"],
                    ["trial/run-level mixed model", "Load ~ SupportLevel + RunOrder + Map + (1 + SupportLevel | Subject)", "SupportLevel 是组内固定效应；Subject 是随机效应"],
                    ["被试间差异", "Load ~ SupportLevel * BetweenSubjectVariable + RunOrder + Map + (1 + SupportLevel | Subject)", "被试间变量需要来自 subject metadata；重点看 SupportLevel 与该变量的交互"],
                    ["多指标控制", "EEG load proxy、theta/alpha、frontal theta、posterior alpha、completion time、behavior_load_proxy 分开报告；主指标优先，其他作为 convergent evidence", "避免把多个探索性指标都写成主结论"],
                    ["结论判定", "先看主 contrast 的方向、置信区间和 p 值；再看 low vs medium、medium vs high 成对比较", "只有全样本显著后才能写成结果支持假设"],
                ],
            },
            build_marker_dictionary_table(),
        ],
        "notes": notes[:12],
    }


def build_subject_batch_availability_table(run_rows: list[dict[str, str]]) -> dict[str, Any]:
    rows_by_density = {row.get("density", ""): row for row in run_rows if row.get("density")}
    specs = [
        (
            "完成时长",
            ("duration_s",),
            "三条件都需要完成时长，才能进入行动迟滞主检验。",
        ),
        (
            "行动启动延迟",
            ("first_action_latency_s",),
            "用于区分起步犹豫和后续路径决策负担。",
        ),
        (
            "路径确认线索",
            ("sign_readable_count", "sign_readable_ratio", "sign_readable_max_gap_s"),
            "用于描述标识可读、线索连续性和确认链断点。",
        ),
        (
            "决策点查看/扫描",
            ("decision_point_count", "decision_total_look_count", "decision_scan_both_count"),
            "用于估计关键节点上的方向核对和行动迟滞。",
        ),
        (
            "低效导航代理",
            ("navigation_inefficiency_proxy", "behavior_load_proxy", "u_turn_count", "backtrack_count"),
            "由停留、扫描、掉头和回退共同构成；缺少回退 marker 时按代理指标解释。",
        ),
        (
            "EEG 事件窗负荷",
            ("sign_readable_eeg_load_proxy", "decision_point_enter_eeg_load_proxy", "eeg_load_proxy", "theta_alpha_ratio"),
            "用于检验中等路径确认支持是否伴随更高信息加工负荷。",
        ),
        (
            "路径判断准确率",
            ("decision_choice_accuracy_ratio", "final_arrival_correct", "first_choice_correct"),
            "用于判断行动速度与正确性是否存在权衡；缺失时不做准确率结论。",
        ),
        (
            "指令清晰度/被试间元数据",
            ("instruction_clarity", "audio"),
            "用于后续 SupportLevel × 被试间变量 或 SupportLevel × Clarity 分析；正式被试间变量仍以 metadata 为准。",
        ),
    ]

    table_rows = []
    for label, keys, handling in specs:
        table_rows.append(
            [
                label,
                batch_condition_status(rows_by_density.get("low"), keys),
                batch_condition_status(rows_by_density.get("medium"), keys),
                batch_condition_status(rows_by_density.get("high"), keys),
                handling,
            ]
        )

    return {
        "title": "三条件指标可用性",
        "columns": ["指标", "低支持", "中支持", "高支持", "组内分析口径"],
        "rows": table_rows,
    }


def batch_condition_status(row: dict[str, str] | None, keys: tuple[str, ...]) -> str:
    if not row:
        return "缺 run"
    available = []
    for key in keys:
        value = row.get(key)
        if value not in (None, "", "-", "待补 marker/metadata"):
            available.append(key)
    if len(available) == len(keys):
        return "完整"
    if available:
        return "部分"
    return "缺失"


def build_subject_core_profile_chart(run_rows: list[dict[str, str]]) -> dict[str, Any]:
    series_specs = [
        ("H1 行动迟滞", "route_decision_hesitation_index"),
        ("M1 确认链不流畅", "route_confirmation_disfluency_index"),
        ("H3 EEG 加工负荷", "eeg_information_processing_load_index"),
    ]
    conditions = [density_display(level) for level in DENSITY_LEVELS]
    series = []
    flat_data = []
    for label, metric in series_specs:
        values = condition_metric_values(run_rows, metric)
        if any(value is not None for value in values):
            series.append({"label": label, "values": values})
            for condition, value in zip(conditions, values):
                if value is not None:
                    flat_data.append({"label": f"{label} / {condition}", "value": safe_chart_value(value)})
    return {
        "type": "profile",
        "title": "低/中/高路径确认支持的核心指标剖面",
        "conditions": conditions,
        "series": series,
        "data": flat_data,
        "wide": True,
        "xLabel": "路径确认支持条件",
        "yLabel": "被试内标准化指数",
        "caption": "用于直接观察主假设方向：中等支持条件下，行动迟滞和 EEG 加工负荷是否高于低/高支持。该图显示单名被试的方向性模式，全样本显著性需要汇总 90 名被试后检验。",
    }


def build_subject_metric_heatmap(run_rows: list[dict[str, str]]) -> dict[str, Any]:
    row_specs = [
        ("首次行动启动", "first_action_latency_s"),
        ("提示到首次确认", "prompt_to_first_confirmation_s"),
        ("决策点停留总时长", "decision_dwell_total_s"),
        ("确认线索最大间隔", "sign_readable_max_gap_s"),
        ("决策点覆盖代理", "decision_point_coverage_proxy"),
        ("左右查看总次数", "decision_total_look_count"),
        ("双侧扫描次数", "decision_scan_both_count"),
        ("回退/掉头/停留", "navigation_inefficiency_proxy"),
        ("路径判断准确率", "decision_choice_accuracy_ratio"),
        ("decision-point EEG load", "decision_point_enter_eeg_load_proxy"),
    ]
    columns = [density_display(level) for level in DENSITY_LEVELS]
    rows = []
    flat_data = []
    for label, metric in row_specs:
        values = condition_metric_values(run_rows, metric)
        if not any(value is not None for value in values):
            continue
        rows.append({"label": label, "values": values})
        for column, value in zip(columns, values):
            if value is not None:
                flat_data.append({"label": f"{label} / {column}", "value": safe_chart_value(value)})
    return {
        "type": "heatmap",
        "title": "路径确认链指标矩阵",
        "columns": columns,
        "rows": rows,
        "data": flat_data,
        "wide": True,
        "xLabel": "路径确认支持条件",
        "yLabel": "行为与 EEG 指标",
        "caption": "每一行按本指标自身范围着色，便于看出同一被试在三种支持条件中的相对高低。颜色深浅不用于跨指标比较。",
    }


def build_accuracy_effort_scatter(run_rows: list[dict[str, str]]) -> dict[str, Any]:
    data = []
    for row in run_rows:
        x_value = to_float(row.get("route_decision_hesitation_index"))
        y_value = to_float(row.get("decision_choice_accuracy_ratio"))
        if y_value is None:
            y_value = to_float(row.get("sign_readable_ratio"))
        if x_value is None or y_value is None:
            continue
        condition = density_display(row.get("density", ""))
        data.append(
            {
                "label": condition_label(row),
                "x": safe_chart_value(x_value),
                "y": safe_chart_value(y_value),
                "group": condition,
            }
        )
    return {
        "type": "scatter",
        "title": "迟滞与准确率/确认线索关系",
        "xLabel": "H1 行动迟滞指数",
        "yLabel": "路径判断准确率；缺失时用可读标识覆盖率",
        "data": data,
        "caption": "用于检查 accuracy-effort trade-off：较高迟滞是否伴随更高正确率或更充分的路径确认。若准确率字段缺失，图中会退回到可读标识覆盖率。",
    }


def condition_metric_values(run_rows: list[dict[str, str]], metric: str) -> list[float | None]:
    values = []
    for level in DENSITY_LEVELS:
        level_values = [to_float(row.get(metric)) for row in run_rows if row.get("density") == level]
        clean = [value for value in level_values if value is not None and math.isfinite(value)]
        values.append(float(np.mean(clean)) if clean else None)
    return values


def build_subject_batch_charts(run_rows: list[dict[str, str]], contrast_json: list[dict[str, Any]]) -> list[dict[str, Any]]:
    charts = [
        build_subject_core_profile_chart(run_rows),
        build_subject_metric_heatmap(run_rows),
        build_accuracy_effort_scatter(run_rows),
        build_run_metric_chart(run_rows, "H1 行动迟滞指数", "route_decision_hesitation_index", "within-subject z index", "该指数整合完成时长、启动延迟、决策点停留、左右查看、双侧扫描、停留、掉头和回退。"),
        build_run_metric_chart(run_rows, "M1 确认链不流畅指数", "route_confirmation_disfluency_index", "within-subject z index", "该指数用于检查官方目标提醒之后，现场确认线索是否连续、及时并覆盖决策点。问卷中的感知可靠性仍需单独收集。"),
        build_run_metric_chart(run_rows, "H3 EEG 信息加工负荷指数", "eeg_information_processing_load_index", "within-subject z index", "该指数整合 trial-level 与事件窗 EEG 负荷指标，用于检验目标—线索—方向匹配负荷。"),
        build_run_metric_chart(run_rows, "路径确认支持条件完成时长", "duration_s", "seconds", "完成时长用于检查行动迟滞的总体趋势，但正式结论应优先结合决策点停留、扫描和 EEG 事件窗。"),
        build_run_metric_chart(run_rows, "首次行动启动时间", "first_action_latency_s", "seconds", "该指标对应行动迟滞中的启动延迟；需要 Unity marker 写入 movement_start 或同义事件。"),
        build_run_metric_chart(run_rows, "提示到首次确认线索", "prompt_to_first_confirmation_s", "seconds", "该指标对应官方目标提醒到现场确认线索之间的匹配成本。"),
        build_run_metric_chart(run_rows, "决策点停留总时长", "decision_dwell_total_s", "seconds", "该指标直接对应分岔、转向和出口选择点的滞留。"),
        build_run_metric_chart(run_rows, "可读标识覆盖率", "sign_readable_ratio", "ratio", "可读比例越高，通常代表现场线索更容易被确认；若中等支持仍表现出较高迟滞，需要结合连续性和关键决策点覆盖解释。"),
        build_run_metric_chart(run_rows, "确认线索最大间隔", "sign_readable_max_gap_s", "seconds", "最大间隔用于识别确认链断点。间隔越长，被试越可能需要自行维持路径预期。"),
        build_run_metric_chart(run_rows, "决策点覆盖代理指标", "decision_point_coverage_proxy", "ratio", "该指标用可读确认线索与决策点数量的比例近似决策点覆盖；正式操纵检查仍建议使用场景配置表。"),
        build_run_metric_chart(run_rows, "路径判断准确率线索", "decision_choice_accuracy_ratio", "ratio", "如果 Unity marker 写入 choice_correct 或 route_correct，本图用于检查低迟滞是否伴随准确率下降。"),
        build_run_metric_chart(run_rows, "首次可读标识时间", "time_to_first_sign_readable_s", "seconds", "首次可读时间反映官方目标提醒后，个体多久能在环境中获得第一处可确认线索。"),
        build_run_metric_chart(run_rows, "首次决策点时间", "time_to_first_decision_s", "seconds", "首次决策点时间有助于区分早期路径搜索负担和后续决策确认负担。"),
        build_run_metric_chart(run_rows, "左右查看总次数", "decision_total_look_count", "count", "左右查看次数用于刻画路径确认过程中的主动扫描行为，是行动迟滞的行为侧证据。"),
        build_run_metric_chart(run_rows, "双侧扫描次数", "decision_scan_both_count", "count", "双侧扫描次数越多，越可能说明个体在关键节点反复核对方向。"),
        build_run_metric_chart(run_rows, "回退/掉头/停留低效事件", "navigation_inefficiency_proxy", "count", "该指标汇总停留、掉头和回退，用于描述路径执行中的低效行为，不应单独解释为认知负荷。"),
        build_run_metric_chart(run_rows, "导航行为负荷代理指标", "behavior_load_proxy", "count", "行为负荷代理指标把停留、扫描、掉头和回退合并，用于与 EEG 指标互相印证。"),
        build_run_metric_chart(run_rows, "决策扫描与回退代理指标", "decision_load_proxy", "index", "该指标对双侧扫描、停留、掉头和回退赋予更高权重，更贴近行动迟滞的决策过程。"),
        build_run_metric_chart(run_rows, "EEG load proxy", "eeg_load_proxy", "index", "EEG load proxy 是基于额区 theta、后部 alpha 和 theta/alpha 的探索性负荷指标，正式论文中需说明其代理性质。"),
        build_run_metric_chart(run_rows, "sign_readable 事件窗 EEG load", "sign_readable_eeg_load_proxy", "event-window index", "该图聚焦看清标识附近的 EEG 负荷，适合解释路径确认线索被读取时的信息加工。"),
        build_run_metric_chart(run_rows, "decision_point_enter 事件窗 EEG load", "decision_point_enter_eeg_load_proxy", "event-window index", "该图聚焦进入决策点后的 EEG 负荷，最贴近行动迟滞和方向确认。"),
        build_contrast_estimate_chart(contrast_json),
    ]
    return [chart for chart in charts if chart and chart.get("data")]


def build_run_metric_chart(run_rows: list[dict[str, str]], title: str, metric: str, y_label: str, caption: str = "") -> dict[str, Any]:
    data = []
    for row in run_rows:
        value = to_float(row.get(metric))
        if value is None:
            continue
        data.append({"label": condition_label(row), "value": safe_chart_value(value)})
    return {
        "type": "bar",
        "title": title,
        "xLabel": "路径确认支持条件 / run",
        "yLabel": y_label,
        "data": data,
        "caption": caption,
    }


def build_contrast_estimate_chart(contrast_json: list[dict[str, Any]]) -> dict[str, Any]:
    priority_metrics = {
        "route_decision_hesitation_index",
        "route_confirmation_disfluency_index",
        "eeg_information_processing_load_index",
        "eeg_load_proxy",
        "decision_point_enter_eeg_load_proxy",
        "sign_readable_eeg_load_proxy",
        "decision_load_proxy",
        "behavior_load_proxy",
        "navigation_inefficiency_proxy",
        "decision_choice_accuracy_ratio",
        "duration_s",
    }
    rows = [
        item
        for item in contrast_json
        if isinstance(item, dict) and str(item.get("metric", "")) in priority_metrics and to_float(item.get("estimate")) is not None
    ]
    rows = sorted(rows, key=lambda item: metric_priority(str(item.get("metric", ""))))[:10]
    return {
        "type": "bar",
        "title": "主 planned contrast 估计值",
        "xLabel": "metric",
        "yLabel": "medium - mean(low, high)",
        "data": [{"label": str(item.get("metricLabel") or item.get("metric")), "value": safe_chart_value(item.get("estimate"))} for item in rows],
        "caption": "正值表示中等路径确认支持高于低/高支持平均，符合主假设方向；单被试报告只能看方向，不能报告显著性。",
    }


def build_subject_batch_narrative(subject_id: str, run_rows: list[dict[str, str]], contrast_json: list[dict[str, Any]], complete_density_set: bool) -> list[dict[str, Any]]:
    hesitation_contrast = find_contrast(contrast_json, "route_decision_hesitation_index")
    disfluency_contrast = find_contrast(contrast_json, "route_confirmation_disfluency_index")
    eeg_index_contrast = find_contrast(contrast_json, "eeg_information_processing_load_index")
    eeg_contrast = find_contrast(contrast_json, "eeg_load_proxy")
    behavior_contrast = find_contrast(contrast_json, "behavior_load_proxy")
    decision_contrast = find_contrast(contrast_json, "decision_load_proxy")
    accuracy_contrast = find_contrast(contrast_json, "decision_choice_accuracy_ratio")
    duration_contrast = find_contrast(contrast_json, "duration_s")
    coverage_text = format_density_coverage(run_rows)
    condition_count = len({row.get("density", "") for row in run_rows if row.get("density")})
    clarity_levels = sorted({row.get("instruction_clarity", "") for row in run_rows if row.get("instruction_clarity") and row.get("instruction_clarity") != "-"})

    return [
        {
            "title": "被试内结果解读",
            "paragraphs": [
                f"本报告将 {subject_id} 的 {len(run_rows)} 个 XDF run 作为同一被试的组内数据处理，当前识别到的路径确认支持条件为：{coverage_text}。{'三种条件已完整覆盖，可以计算主 planned contrast。' if complete_density_set else f'当前只覆盖 {condition_count}/3 个条件，因此部分 contrast 只能作为检查结果。'}",
                f"H1 行动迟滞指数的 contrast 为 {contrast_sentence(hesitation_contrast)}。同时参考完成时长 {contrast_sentence(duration_contrast)}、导航行为负荷 {contrast_sentence(behavior_contrast)} 和决策扫描/回退代理指标 {contrast_sentence(decision_contrast)}。",
                f"M1 相关的确认链不流畅指数为 {contrast_sentence(disfluency_contrast)}。该指数来自提示到首次确认线索、可读标识间隔、决策点覆盖和低效行为，可作为感知信息可靠性问卷的操纵检查线索。",
                f"H3 EEG 信息加工负荷指数的 contrast 为 {contrast_sentence(eeg_index_contrast)}；旧版 EEG load proxy 的 contrast 为 {contrast_sentence(eeg_contrast)}。若行为负荷和 EEG 负荷方向一致，论文可讨论神经和行为指标的一致性；若方向分离，应讨论策略差异或 EEG 噪声。",
            ],
        },
        {
            "title": "论文写作口径",
            "paragraphs": [
                "单个被试报告只能用于质控、特征检查和方向性观察，不能直接写成统计显著。正式结果应在 90 名被试层面汇总每人的 medium - mean(low, high) contrast，并进行 one-sample test 或 mixed-effects contrast。",
                f"路径判断准确率的 contrast 为 {contrast_sentence(accuracy_contrast)}。低支持条件下如果迟滞较低且准确率较低，可作为 accuracy–effort trade-off 的结果线索；如果准确率字段缺失，需要在 Unity marker 中补写 choice_correct 或 route_correct。",
                f"保护性行动指令清晰度当前识别为：{' / '.join(clarity_levels) if clarity_levels else '待补 marker/metadata'}。后续加入 VR 经验、专业背景、性别或指令清晰度时，应在 subject metadata 中显式记录，再检验 SupportLevel × 被试间变量 或 SupportLevel × Clarity 交互。",
            ],
        },
    ]


def find_contrast(contrast_json: list[dict[str, Any]], metric: str) -> dict[str, Any] | None:
    for item in contrast_json:
        if isinstance(item, dict) and item.get("metric") == metric:
            return item
    return None


def contrast_sentence(item: dict[str, Any] | None) -> str:
    if not item:
        return "尚未形成，通常是低/中/高条件不完整或该指标缺失"
    estimate = to_float(item.get("estimate"))
    direction = str(item.get("direction") or "")
    means = item.get("means") if isinstance(item.get("means"), dict) else {}
    mean_text = ""
    if means:
        mean_text = f"（低={fmt(means.get('low'))}，中={fmt(means.get('medium'))}，高={fmt(means.get('high'))}）"
    return f"{fmt(estimate)}，{direction}{mean_text}"


def extract_run_summary(document: dict[str, Any], report: dict[str, Any]) -> dict[str, str]:
    metrics = {metric.get("label"): metric.get("value") for metric in report.get("metrics", [])}
    session_parts = parse_session_label(str(metrics.get("主 trial", "")))
    behavior = extract_metric_table(
        report,
        [
            "prompt_channel",
            "protective_action_instruction_clarity",
            "trial_duration_s",
            "horizontal_distance_m",
            "exit_label",
            "first_action_latency_s",
            "time_to_first_sign_readable_s",
            "prompt_to_first_confirmation_s",
            "time_to_first_decision_s",
            "decision_dwell_total_s",
            "decision_dwell_mean_s",
            "decision_dwell_episode_count",
            "sign_readable_count",
            "sign_readable_ratio",
            "sign_readable_mean_gap_s",
            "sign_readable_max_gap_s",
            "decision_point_count",
            "decision_point_coverage_proxy",
            "decision_total_look_count",
            "decision_look_balance_abs",
            "decision_scan_both_count",
            "u_turn_count",
            "backtrack_count",
            "navigation_inefficiency_proxy",
            "decision_load_proxy",
            "behavior_load_proxy",
            "route_confirmation_disfluency_proxy",
            "first_choice_correct",
            "decision_choice_accuracy_ratio",
            "decision_choice_correct_count",
            "decision_choice_total_count",
            "final_arrival_correct",
        ],
    )
    eeg = extract_metric_table(
        report,
        [
            "eeg_load_proxy",
            "theta_alpha_ratio",
            "frontal_theta_4_7",
            "posterior_alpha_8_12",
            "sign_visible_enter_eeg_load_proxy",
            "sign_readable_eeg_load_proxy",
            "decision_point_enter_eeg_load_proxy",
            "sign_readable_theta_alpha_ratio",
            "decision_point_enter_theta_alpha_ratio",
        ],
    )
    file = document["filename"]
    density = infer_density_level(
        file,
        session_parts.get("session", ""),
        session_parts.get("map", ""),
        session_parts.get("signature", ""),
        session_parts.get("audio", ""),
        metrics.get("主 trial", ""),
    )
    return {
        "file": file,
        "run_label": infer_run_label(file),
        "subject": infer_subject_id(session_parts.get("subject") or file, fallback_filename=file),
        "session": session_parts.get("session", ""),
        "map": session_parts.get("map", ""),
        "signature": session_parts.get("signature", ""),
        "audio": session_parts.get("audio", "") or behavior.get("prompt_channel", ""),
        "instruction_clarity": behavior.get("protective_action_instruction_clarity", "-"),
        "density": density,
        "density_label": density_display(density) if density else "待标注",
        "duration_s": behavior.get("trial_duration_s", "-"),
        "horizontal_distance_m": behavior.get("horizontal_distance_m", "-"),
        "exit_label": behavior.get("exit_label", "-"),
        "first_action_latency_s": behavior.get("first_action_latency_s", "-"),
        "time_to_first_sign_readable_s": behavior.get("time_to_first_sign_readable_s", "-"),
        "prompt_to_first_confirmation_s": behavior.get("prompt_to_first_confirmation_s", "-"),
        "time_to_first_decision_s": behavior.get("time_to_first_decision_s", "-"),
        "decision_dwell_total_s": behavior.get("decision_dwell_total_s", "-"),
        "decision_dwell_mean_s": behavior.get("decision_dwell_mean_s", "-"),
        "decision_dwell_episode_count": behavior.get("decision_dwell_episode_count", "-"),
        "sign_readable_count": behavior.get("sign_readable_count", "-"),
        "sign_readable_ratio": behavior.get("sign_readable_ratio", "-"),
        "sign_readable_mean_gap_s": behavior.get("sign_readable_mean_gap_s", "-"),
        "sign_readable_max_gap_s": behavior.get("sign_readable_max_gap_s", "-"),
        "decision_point_count": behavior.get("decision_point_count", "-"),
        "decision_point_coverage_proxy": behavior.get("decision_point_coverage_proxy", "-"),
        "decision_total_look_count": behavior.get("decision_total_look_count", "-"),
        "decision_look_balance_abs": behavior.get("decision_look_balance_abs", "-"),
        "decision_scan_both_count": behavior.get("decision_scan_both_count", "-"),
        "u_turn_count": behavior.get("u_turn_count", "-"),
        "backtrack_count": behavior.get("backtrack_count", "-"),
        "navigation_inefficiency_proxy": behavior.get("navigation_inefficiency_proxy", "-"),
        "decision_load_proxy": behavior.get("decision_load_proxy", "-"),
        "behavior_load_proxy": behavior.get("behavior_load_proxy", "-"),
        "route_confirmation_disfluency_proxy": behavior.get("route_confirmation_disfluency_proxy", "-"),
        "first_choice_correct": behavior.get("first_choice_correct", "-"),
        "decision_choice_accuracy_ratio": behavior.get("decision_choice_accuracy_ratio", "-"),
        "decision_choice_correct_count": behavior.get("decision_choice_correct_count", "-"),
        "decision_choice_total_count": behavior.get("decision_choice_total_count", "-"),
        "final_arrival_correct": behavior.get("final_arrival_correct", "-"),
        "eeg_load_proxy": eeg.get("eeg_load_proxy", "-"),
        "theta_alpha_ratio": eeg.get("theta_alpha_ratio", "-"),
        "frontal_theta_4_7": eeg.get("frontal_theta_4_7", "-"),
        "posterior_alpha_8_12": eeg.get("posterior_alpha_8_12", "-"),
        "sign_visible_enter_eeg_load_proxy": eeg.get("sign_visible_enter_eeg_load_proxy", "-"),
        "sign_readable_eeg_load_proxy": eeg.get("sign_readable_eeg_load_proxy", "-"),
        "decision_point_enter_eeg_load_proxy": eeg.get("decision_point_enter_eeg_load_proxy", "-"),
        "sign_readable_theta_alpha_ratio": eeg.get("sign_readable_theta_alpha_ratio", "-"),
        "decision_point_enter_theta_alpha_ratio": eeg.get("decision_point_enter_theta_alpha_ratio", "-"),
        "has_completion": "yes" if behavior.get("trial_duration_s") not in (None, "", "-") else "no",
    }


def extract_metric_table(report: dict[str, Any], wanted: list[str]) -> dict[str, str]:
    values: dict[str, str] = {}
    wanted_set = set(wanted)
    for table in report.get("tables", []):
        for row in table.get("rows", []):
            if not row:
                continue
            key = str(row[0])
            if key in wanted_set and len(row) > 1:
                values[key] = str(row[1])
    return values


def infer_density_level(*values: Any) -> str:
    import re

    text = " ".join(str(value or "") for value in values).lower()
    compact = text.replace("_", "-")

    if re.search(r"signature[-\s_]?2\b", compact):
        return "medium"
    if re.search(r"signature[-\s_]?1\b", compact):
        return "low"
    if re.search(r"signature[-\s_]?3\b", compact):
        return "high"

    if re.search(r"中等?密度|中密度|medium[-\s_]?density|density[-\s_]?medium|density[-\s_]?mid|condition[-\s_]?medium|level[-\s_]?2", compact):
        return "medium"
    if re.search(r"低密度|low[-\s_]?density|density[-\s_]?low|condition[-\s_]?low|level[-\s_]?1", compact):
        return "low"
    if re.search(r"高密度|high[-\s_]?density|density[-\s_]?high|condition[-\s_]?high|level[-\s_]?3", compact):
        return "high"

    tokens = set(re.findall(r"[a-z0-9]+|[\u4e00-\u9fff]+", compact))
    if tokens & {"medium", "mid", "med", "middle", "中", "中等"}:
        return "medium"
    if tokens & {"low", "lo", "sparse", "light", "低"}:
        return "low"
    if tokens & {"high", "hi", "dense", "heavy", "高"}:
        return "high"
    run_position = infer_run_position(*values)
    if run_position == 1:
        return "low"
    if run_position == 2:
        return "medium"
    if run_position == 3:
        return "high"
    return ""


def density_display(level: str) -> str:
    return DENSITY_LABELS.get(level, level or "待标注")


def density_sort_key(level: str) -> int:
    try:
        return DENSITY_LEVELS.index(level)
    except ValueError:
        return len(DENSITY_LEVELS)


def sort_run_rows_by_density(rows: list[dict[str, str]]) -> list[dict[str, str]]:
    if any(row.get("density") for row in rows):
        return sorted(rows, key=lambda row: (density_sort_key(row.get("density", "")), infer_sequence_index(row.get("file", "")) or 999999, row.get("run_label", ""), row.get("file", "")))
    return sorted(rows, key=lambda row: (infer_sequence_index(row.get("file", "")) or 999999, row.get("run_label", ""), row.get("file", "")))


def attach_subject_level_indices(rows: list[dict[str, str]]) -> list[dict[str, str]]:
    composite_specs = [
        (
            "route_decision_hesitation_index",
            [
                ("duration_s", 1.0),
                ("first_action_latency_s", 1.0),
                ("time_to_first_decision_s", 0.5),
                ("decision_dwell_total_s", 1.0),
                ("decision_total_look_count", 0.8),
                ("decision_scan_both_count", 1.0),
                ("navigation_inefficiency_proxy", 1.0),
            ],
        ),
        (
            "route_confirmation_disfluency_index",
            [
                ("prompt_to_first_confirmation_s", 1.0),
                ("sign_readable_max_gap_s", 1.0),
                ("route_confirmation_disfluency_proxy", 1.0),
                ("sign_readable_ratio", -1.0),
                ("decision_point_coverage_proxy", -1.0),
            ],
        ),
        (
            "eeg_information_processing_load_index",
            [
                ("eeg_load_proxy", 1.0),
                ("decision_point_enter_eeg_load_proxy", 1.0),
                ("sign_readable_eeg_load_proxy", 0.8),
                ("theta_alpha_ratio", 0.6),
                ("posterior_alpha_8_12", -0.4),
            ],
        ),
    ]
    for row in rows:
        row.setdefault("route_decision_hesitation_index", "-")
        row.setdefault("route_confirmation_disfluency_index", "-")
        row.setdefault("eeg_information_processing_load_index", "-")
        row.setdefault("accuracy_effort_profile", "-")

    z_cache: dict[str, list[float | None]] = {}
    for _name, components in composite_specs:
        for metric, _direction in components:
            if metric not in z_cache:
                z_cache[metric] = zscores([to_float(row.get(metric)) for row in rows])

    for target, components in composite_specs:
        for index, row in enumerate(rows):
            values = []
            for metric, direction in components:
                metric_z = z_cache.get(metric, [None] * len(rows))[index]
                if metric_z is not None:
                    values.append(metric_z * direction)
            if values:
                row[target] = fmt(float(np.mean(values)))

    for row in rows:
        accuracy = to_float(row.get("decision_choice_accuracy_ratio"))
        hesitation = to_float(row.get("route_decision_hesitation_index"))
        if accuracy is None or hesitation is None:
            continue
        if hesitation > 0 and accuracy < 0.5:
            row["accuracy_effort_profile"] = "高迟滞 / 低准确"
        elif hesitation <= 0 and accuracy < 0.5:
            row["accuracy_effort_profile"] = "低迟滞 / 低准确"
        elif hesitation > 0 and accuracy >= 0.5:
            row["accuracy_effort_profile"] = "高迟滞 / 较高准确"
        else:
            row["accuracy_effort_profile"] = "低迟滞 / 较高准确"
    return rows


def zscores(values: list[float | None]) -> list[float | None]:
    clean = np.asarray([value for value in values if value is not None and math.isfinite(value)], dtype=float)
    if len(clean) < 2:
        return [None for _ in values]
    mean = float(np.mean(clean))
    sd = float(np.std(clean, ddof=1))
    if sd <= 0:
        return [0.0 if value is not None and math.isfinite(value) else None for value in values]
    return [((float(value) - mean) / sd) if value is not None and math.isfinite(value) else None for value in values]


def condition_label(row: dict[str, str]) -> str:
    density = row.get("density", "")
    if density:
        return density_display(density)
    return row.get("run_label") or row.get("file", "")[:18]


def format_density_coverage(rows: list[dict[str, str]]) -> str:
    levels = [row.get("density", "") for row in rows if row.get("density")]
    if not levels:
        return "未识别"
    unique = sorted(set(levels), key=density_sort_key)
    return " / ".join(density_display(level) for level in unique)


def compute_density_planned_contrasts(rows: list[dict[str, str]]) -> tuple[list[list[str]], list[dict[str, Any]]]:
    metrics = [
        ("route_decision_hesitation_index", "route-decision hesitation index"),
        ("route_confirmation_disfluency_index", "confirmation-chain disfluency index"),
        ("eeg_information_processing_load_index", "EEG information-processing load index"),
        ("eeg_load_proxy", "EEG load proxy"),
        ("decision_point_enter_eeg_load_proxy", "decision-point EEG load"),
        ("sign_readable_eeg_load_proxy", "sign-readable EEG load"),
        ("theta_alpha_ratio", "theta/alpha ratio"),
        ("frontal_theta_4_7", "frontal theta"),
        ("posterior_alpha_8_12", "posterior alpha"),
        ("decision_load_proxy", "decision/scan load proxy"),
        ("behavior_load_proxy", "behavior load proxy"),
        ("navigation_inefficiency_proxy", "navigation inefficiency"),
        ("decision_total_look_count", "left/right look count"),
        ("decision_look_balance_abs", "left-right imbalance"),
        ("decision_scan_both_count", "both-side scans"),
        ("decision_dwell_total_s", "decision dwell total"),
        ("first_action_latency_s", "first action latency"),
        ("prompt_to_first_confirmation_s", "prompt to first confirmation"),
        ("route_confirmation_disfluency_proxy", "route confirmation disfluency proxy"),
        ("sign_readable_ratio", "readable sign ratio"),
        ("decision_point_coverage_proxy", "decision-point coverage proxy"),
        ("time_to_first_sign_readable_s", "time to first readable sign"),
        ("time_to_first_decision_s", "time to first decision point"),
        ("decision_choice_accuracy_ratio", "decision choice accuracy"),
        ("duration_s", "completion time"),
    ]
    table_rows: list[list[str]] = []
    json_rows: list[dict[str, Any]] = []

    for metric_key, metric_label in metrics:
        values_by_density: dict[str, list[float]] = {level: [] for level in DENSITY_LEVELS}
        for row in rows:
            density = row.get("density", "")
            value = to_float(row.get(metric_key))
            if density in values_by_density and value is not None:
                values_by_density[density].append(value)

        if not all(values_by_density[level] for level in DENSITY_LEVELS):
            continue

        means = {level: float(np.mean(values_by_density[level])) for level in DENSITY_LEVELS}
        estimate = means["medium"] - (means["low"] + means["high"]) / 2.0
        direction = contrast_direction_label(metric_key, estimate)
        table_rows.append(
            [
                "medium - mean(low, high)",
                metric_label,
                fmt(means["low"]),
                fmt(means["medium"]),
                fmt(means["high"]),
                fmt(estimate),
                direction,
            ]
        )
        json_rows.append(
            {
                "contrast": "medium - mean(low, high)",
                "metric": metric_key,
                "metricLabel": metric_label,
                "means": means,
                "estimate": estimate,
                "direction": direction,
                "weights": PRIMARY_CONTRAST_WEIGHTS,
            }
        )

    return table_rows, json_rows


def metric_priority(metric: str) -> tuple[int, str]:
    order = {
        "route_decision_hesitation_index": 0,
        "eeg_information_processing_load_index": 1,
        "route_confirmation_disfluency_index": 2,
        "eeg_load_proxy": 3,
        "decision_point_enter_eeg_load_proxy": 4,
        "sign_readable_eeg_load_proxy": 5,
        "theta_alpha_ratio": 6,
        "frontal_theta_4_7": 7,
        "posterior_alpha_8_12": 8,
        "decision_load_proxy": 9,
        "behavior_load_proxy": 10,
        "navigation_inefficiency_proxy": 11,
        "decision_total_look_count": 12,
        "decision_look_balance_abs": 13,
        "decision_scan_both_count": 14,
        "decision_dwell_total_s": 15,
        "first_action_latency_s": 16,
        "prompt_to_first_confirmation_s": 17,
        "route_confirmation_disfluency_proxy": 18,
        "sign_readable_ratio": 19,
        "decision_point_coverage_proxy": 20,
        "decision_choice_accuracy_ratio": 21,
        "time_to_first_sign_readable_s": 22,
        "time_to_first_decision_s": 23,
        "duration_s": 24,
    }
    return (order.get(metric, 99), metric)


def contrast_direction_label(metric: str, estimate: float) -> str:
    negative_load_metrics = {"posterior_alpha_8_12"}
    descriptive_metrics = {"sign_readable_ratio", "decision_point_coverage_proxy", "decision_choice_accuracy_ratio"}
    if metric in negative_load_metrics:
        return "符合负荷升高方向" if estimate < 0 else "未呈现负荷升高方向"
    if metric in descriptive_metrics:
        return "中等条件高于低/高平均" if estimate > 0 else "中等条件未高于低/高平均"
    return "符合中等最高方向" if estimate > 0 else "未呈现中等最高方向"


def one_sample_contrast_stats(values: list[float]) -> dict[str, Any]:
    clean = np.asarray([value for value in values if math.isfinite(value)], dtype=float)
    n = int(clean.size)
    if n == 0:
        return {"n": 0, "mean": None, "sd": None, "se": None, "t": None, "p": None, "ci_low": None, "ci_high": None, "dz": None}
    mean = float(np.mean(clean))
    sd = float(np.std(clean, ddof=1)) if n > 1 else 0.0
    se = sd / math.sqrt(n) if n > 1 else None
    if n < 2 or not se or se <= 0:
        return {"n": n, "mean": mean, "sd": sd, "se": se, "t": None, "p": None, "ci_low": None, "ci_high": None, "dz": None}

    t_value = mean / se
    p_value = None
    ci_low = mean - 1.96 * se
    ci_high = mean + 1.96 * se

    try:
        from scipy import stats

        test = stats.ttest_1samp(clean, popmean=0.0, nan_policy="omit")
        p_value = float(test.pvalue)
        interval = stats.t.interval(0.95, df=n - 1, loc=mean, scale=se)
        ci_low = float(interval[0])
        ci_high = float(interval[1])
    except Exception:
        p_value = 2.0 * (1.0 - normal_cdf(abs(t_value)))

    return {
        "n": n,
        "mean": mean,
        "sd": sd,
        "se": se,
        "t": float(t_value),
        "p": p_value,
        "ci_low": ci_low,
        "ci_high": ci_high,
        "dz": mean / sd if sd > 0 else None,
    }


def normal_cdf(value: float) -> float:
    return 0.5 * (1.0 + math.erf(value / math.sqrt(2.0)))


def contrast_conclusion(stats: dict[str, Any], metric: str = "") -> str:
    mean = stats.get("mean")
    p_value = stats.get("p")
    n = int(stats.get("n") or 0)
    if n < 10:
        return "样本量不足，仅供检查"
    if mean is None or p_value is None:
        return "统计量不足"
    direction = contrast_direction_label(metric, float(mean))
    if p_value < 0.05 and ("符合" in direction or "高于" in direction):
        return f"显著，{direction}"
    if p_value < 0.05:
        return f"显著，{direction}"
    return f"未达显著，{direction}"


def format_ci(stats: dict[str, Any]) -> str:
    low = stats.get("ci_low")
    high = stats.get("ci_high")
    if low is None or high is None:
        return "-"
    return f"[{fmt(low)}, {fmt(high)}]"


def fmt_p(value: Any) -> str:
    numeric = to_float(value)
    if numeric is None:
        return "-"
    if numeric < 0.001:
        return "<0.001"
    return f"{numeric:.3f}"


def parse_session_label(label: str) -> dict[str, str]:
    parts = [part.strip() for part in label.split(" / ") if part.strip()]
    keys = ["subject", "session", "map", "signature", "audio"]
    return {key: parts[index] for index, key in enumerate(keys) if index < len(parts)}


def infer_sequence_index(*values: Any) -> int | None:
    import re

    text = " ".join(str(value or "") for value in values)
    patterns = [
        r"(?:^|[^A-Za-z0-9])sub-?p?0*(\d{1,4})(?=[^0-9]|$)",
        r"(?:^|[^A-Za-z0-9])(?:subject|subj|participant|p)[-_\s]?0*(\d{1,4})(?=[^0-9]|$)",
        r"^0*(\d{1,4})$",
    ]
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            value = int(match.group(1))
            if value > 0:
                return value
    return None


def infer_run_position(*values: Any) -> int | None:
    sequence_index = infer_sequence_index(*values)
    if not sequence_index:
        return None
    return ((sequence_index - 1) % 3) + 1


def infer_subject_id(filename: str, fallback_filename: str = "") -> str:
    import re

    sequence_index = infer_sequence_index(filename, fallback_filename)
    if sequence_index:
        return f"P{math.ceil(sequence_index / 3):02d}"

    match = re.search(r"sub-([A-Za-z0-9]+)", f"{filename} {fallback_filename}", re.IGNORECASE)
    if match:
        token = match.group(1)
        participant_match = re.search(r"p?0*(\d{1,3})$", token, re.IGNORECASE)
        if participant_match:
            return f"P{int(participant_match.group(1)):02d}"
        return f"P-{token}"
    return "P-unknown"


def infer_run_label(filename: str) -> str:
    import re

    sequence_index = infer_sequence_index(filename)
    run_position = infer_run_position(filename)
    if sequence_index and run_position:
        return f"file-{sequence_index:03d} / condition-{run_position}"

    run = re.search(r"run-([A-Za-z0-9]+)", filename, re.IGNORECASE)
    if run:
        return f"run-{run.group(1)}"
    signature = re.search(r"signature[-_]?([A-Za-z0-9]+)", filename, re.IGNORECASE)
    if signature:
        return f"signature-{signature.group(1)}"
    return filename[:24]


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
    raw_primary_rows = select_primary_session(marker_rows)
    primary_rows, duplicate_primary_marker_count = deduplicate_marker_rows(raw_primary_rows)
    trial_window = get_trial_window(primary_rows)
    event_counts = Counter(row.get("event", "<no_event>") for row in marker_rows)

    if marker_rows:
        charts.append(build_event_count_chart(event_counts))
        tables.append(build_session_table(sessions))
    if primary_rows:
        tables.append(build_behavior_table(primary_rows, trial_window))
        tables.append(build_marker_availability_table(primary_rows, marker_rows, len(eeg_streams), eeg_report=None, duplicate_count=duplicate_primary_marker_count))
        charts.extend(build_single_behavior_charts(primary_rows, trial_window))
        primary_events = {row.get("event", "") for row in primary_rows}
        if duplicate_primary_marker_count:
            notes.append(f"主 trial 中检测到 {duplicate_primary_marker_count} 条疑似重复 Unity marker，行为计数和事件窗已使用去重后的 marker。")
        if not set(START_EVENTS) & primary_events:
            notes.append("主 trial 缺少 map_start / trial_start / session_start，报告只能用该 session 的第一条 marker 估计开始时间。")
        if END_EVENT not in primary_events:
            notes.append("主 trial 缺少 evacuation_complete，报告只能用该 session 的最后一条 marker 估计结束时间。")
    else:
        notes.append("未能从 marker 中选出可分析 trial；需要检查 subject/session/map/signage/audio 字段和开始/完成事件。")

    eeg_report = analyze_eeg_stream(eeg_stream, primary_rows, trial_window) if eeg_stream else empty_eeg_report()
    replace_marker_availability_table(tables, build_marker_availability_table(primary_rows, marker_rows, len(eeg_streams), eeg_report, duplicate_primary_marker_count))
    charts.extend(eeg_report["charts"])
    tables.extend(eeg_report["tables"])
    notes.extend(eeg_report["notes"])

    valid_event_epochs = eeg_report["metrics"].get("valid_event_epochs", 0)
    session_label = format_session_label(primary_rows[0]) if primary_rows else "-"
    trial_duration = trial_window["duration_s"] if trial_window else None

    summary = (
        "报告围绕路径确认信息链模型整理一个 LabRecorder XDF run：先检查 stream、session 和 trial 完整性，"
        "再提取行动迟滞、路径判断准确率线索、确认链不流畅指标、EEG 覆盖、通道质控、"
        "theta/alpha/beta 频带摘要，以及 sign_readable 和 decision_point_enter 附近的事件窗 EEG 特征。"
    )

    if not notes:
        notes.append("当前输出是 QC 与特征提取报告，不直接给出显著性结论；正式论文结果需要多被试 trial_features/event_features 后再做混合效应模型和 planned contrast。")

    return {
        "title": f"{document['filename']} XDF EEG + Unity marker 分析",
        "kind": "XDF EEG+Marker",
        "summary": summary,
        "modelOverview": build_model_overview("single_xdf"),
        "narrativeSections": build_single_xdf_narrative(document, streams, marker_rows, primary_rows, trial_window, eeg_report, notes, duplicate_primary_marker_count),
        "metrics": [
            {"label": "stream 数", "value": str(len(streams))},
            {"label": "marker 数", "value": str(len(marker_rows))},
            {"label": "主 trial 去重", "value": f"{len(primary_rows)}/{len(raw_primary_rows)}"},
            {"label": "主 trial", "value": session_label},
            {"label": "trial 时长", "value": fmt_seconds(trial_duration)},
            {"label": "EEG stream", "value": str(len(eeg_streams))},
            {"label": "有效事件窗", "value": str(valid_event_epochs)},
        ],
        "charts": [chart for chart in charts if chart and chart["data"]][:12],
        "tables": (tables + [build_marker_dictionary_table()])[:14],
        "notes": notes[:12],
    }


def build_single_behavior_charts(rows: list[dict[str, Any]], window: dict[str, float] | None) -> list[dict[str, Any]]:
    counts = Counter(row.get("event", "<no_event>") for row in rows)
    charts = [
        {
            "type": "bar",
            "title": "标识可见/可读事件",
            "xLabel": "marker",
            "yLabel": "count",
            "data": [{"label": event, "value": int(counts.get(event, 0))} for event in SIGNAGE_EVENTS],
            "caption": "用于检查被试是否经历了足够的现场路径确认线索，以及可见标识是否真正进入可读范围。",
        },
        {
            "type": "bar",
            "title": "决策点查看与扫描事件",
            "xLabel": "marker",
            "yLabel": "count",
            "data": [{"label": event, "value": int(counts.get(event, 0))} for event in DECISION_EVENTS],
            "caption": "左右查看和双侧扫描越多，越可能反映关键节点上的方向确认负担。",
        },
        {
            "type": "bar",
            "title": "停留、掉头与回退事件",
            "xLabel": "marker",
            "yLabel": "count",
            "data": [{"label": event, "value": int(counts.get(event, 0))} for event in INEFFICIENCY_EVENTS],
            "caption": "这些事件用于辅助描述导航低效和行动迟滞，但不能单独作为认知负荷结论。",
        },
        build_event_timeline_chart(rows, window),
    ]
    return [chart for chart in charts if chart and chart.get("data")]


def build_event_timeline_chart(rows: list[dict[str, Any]], window: dict[str, float] | None) -> dict[str, Any]:
    start_ts = window.get("start_ts") if window else None
    if start_ts is None and rows:
        start_ts = rows[0].get("_xdf_ts")
    data = []
    for row in rows:
        event = str(row.get("event", ""))
        ts = to_float(row.get("_xdf_ts"))
        if ts is None or start_ts is None:
            continue
        family = event_family(event)
        if not family:
            continue
        data.append({"label": event, "x": round(ts - float(start_ts), 3), "lane": family, "family": family})
    return {
        "type": "timeline",
        "title": "主 trial 事件时间线",
        "xLabel": "trial time (s)",
        "yLabel": "audio / sign / decision / inefficiency / completion",
        "lanes": ["audio", "sign", "decision", "inefficiency", "completion"],
        "laneLabels": {
            "audio": "官方提醒",
            "sign": "路径确认线索",
            "decision": "决策点行为",
            "inefficiency": "低效行为",
            "completion": "完成",
        },
        "data": data[:300],
        "wide": True,
        "caption": "时间线用于检查音频、标识可读、决策点和低效行为是否出现在合理顺序中；若开始/结束 marker 缺失，时间零点仅为估计。",
    }


def event_family(event: str) -> str:
    if event == "audio_play":
        return "audio"
    if event in SIGNAGE_EVENTS:
        return "sign"
    if event in DECISION_EVENTS:
        return "decision"
    if event in INEFFICIENCY_EVENTS:
        return "inefficiency"
    if event == END_EVENT:
        return "completion"
    return ""


def build_single_xdf_narrative(
    document: dict[str, Any],
    streams: list[dict[str, Any]],
    marker_rows: list[dict[str, Any]],
    primary_rows: list[dict[str, Any]],
    trial_window: dict[str, float] | None,
    eeg_report: dict[str, Any],
    notes: list[str],
    duplicate_primary_marker_count: int = 0,
) -> list[dict[str, Any]]:
    counts = Counter(row.get("event", "<no_event>") for row in primary_rows)
    duration = fmt_seconds(trial_window.get("duration_s") if trial_window else None)
    readable_count = counts.get("sign_readable", 0)
    decision_count = counts.get("decision_point_enter", 0)
    scan_count = counts.get("decision_scan_both_sides", 0)
    inefficiency_count = sum(counts.get(event, 0) for event in INEFFICIENCY_EVENTS)
    valid_epochs = eeg_report.get("metrics", {}).get("valid_event_epochs", 0) if isinstance(eeg_report.get("metrics"), dict) else 0
    first_action = fmt_seconds(first_event_latency_any(primary_rows, ACTION_START_EVENTS, trial_window))
    prompt_to_confirmation = fmt_seconds(latency_between_event_groups(primary_rows, PROMPT_EVENTS, CONFIRMATION_EVENTS))
    dwell_total, dwell_mean, dwell_n = event_interval_stats(primary_rows, "decision_point_enter", "decision_point_exit", trial_window)
    sign_gap_mean, sign_gap_max = event_gap_stats(primary_rows, "sign_readable")
    completion = find_first_event(primary_rows, (END_EVENT,))
    accuracy = marker_accuracy_summary(primary_rows, completion)
    prompt_channel = infer_prompt_channel(primary_rows)
    instruction_clarity = infer_instruction_clarity(primary_rows)

    return [
        {
            "title": "本 run 的数据完整性",
            "paragraphs": [
                f"文件 {document.get('filename', '')} 中共识别到 {len(streams)} 条 stream、{len(marker_rows)} 条 marker。主 trial 使用 {len(primary_rows)} 条去重后 marker，疑似重复 marker {duplicate_primary_marker_count} 条。主 trial 时长为 {duration}，其中 sign_readable 事件 {readable_count} 次，decision_point_enter 事件 {decision_count} 次。",
                f"EEG 事件窗当前有效数量为 {valid_epochs}。如果该数字较低，应优先检查 EEG stream 覆盖、marker 时间戳是否落在 EEG 范围内，以及 LabRecorder 是否完整记录了任务过程。",
            ],
        },
        {
            "title": "路径确认过程",
            "paragraphs": [
                f"提醒通道识别为 {prompt_channel}，保护性行动指令清晰度识别为 {instruction_clarity}。如果这里显示待补，后续需要在 Unity marker 或 subject-run metadata 中写入提醒通道和清晰度条件。",
                f"首次行动启动时间为 {first_action}，提示到首次确认线索为 {prompt_to_confirmation}。决策点停留共 {fmt_seconds(dwell_total)}，平均 {fmt_seconds(dwell_mean)}，可识别停留段 {dwell_n} 个。",
                f"本 run 中双侧扫描事件为 {scan_count} 次，停留/掉头/回退类低效事件合计 {inefficiency_count} 次。可读标识最大间隔为 {fmt_seconds(sign_gap_max)}，平均间隔为 {fmt_seconds(sign_gap_mean)}。这些指标共同描述路径确认链的连续性和行动迟滞。",
                f"路径判断准确率线索：首次选择 {accuracy['first_choice_correct']}，决策选择正确率 {accuracy['decision_choice_accuracy_ratio']}，最终到达正确性 {accuracy['final_arrival_correct']}。如果这些字段为空，说明当前 marker 尚未写入准确率信息。",
            ],
        },
        {
            "title": "EEG 事件窗",
            "paragraphs": [
                "EEG 频带和事件窗指标用于描述任务期间的信息加工负荷。报告优先关注 sign_readable 和 decision_point_enter 附近的事件窗，因为它们最接近目标—线索—方向匹配过程。",
                "正式分析应在同一被试的低、中、高路径确认支持条件之间比较这些指标，再进入 90 名被试层面的 planned contrast 或 mixed-effects model。",
            ],
        },
        {
            "title": "写作时的限制",
            "paragraphs": [
                "单文件报告主要用于质控和特征提取。它可以写入方法部分作为数据处理流程示例，也可以用于排查异常 run；研究假设是否成立需要全样本统计支持。",
                "报告中的“指标可用性与适配口径”用于标注真实 marker、代理指标和待补元数据。缺少开始/完成 marker、多个 EEG stream、EEG 覆盖不足或事件窗过少时，应在正式分析前建立排除或降级规则。",
            ],
        },
    ]


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
    sign_visible_count = counts.get("sign_visible_enter", 0)
    sign_readable_count = counts.get("sign_readable", 0)
    decision_count = counts.get("decision_point_enter", 0)
    left_looks = counts.get("decision_look_left", 0)
    right_looks = counts.get("decision_look_right", 0)
    scan_both = counts.get("decision_scan_both_sides", 0)
    dwell_count = counts.get("dwell_detected", 0)
    u_turn_count = counts.get("u_turn_detected", 0)
    backtrack_count = counts.get("route_backtrack_detected", 0)
    look_total = left_looks + right_looks
    look_balance_abs = abs(left_looks - right_looks)
    behavior_load_proxy = dwell_count + u_turn_count + backtrack_count + scan_both
    decision_load_proxy = look_total + 2 * scan_both + 2 * dwell_count + 3 * (u_turn_count + backtrack_count)
    navigation_inefficiency_proxy = u_turn_count + backtrack_count + dwell_count
    duration_minutes = (window["duration_s"] / 60.0) if window and window.get("duration_s") else None
    behavior_load_rate = behavior_load_proxy / duration_minutes if duration_minutes else None
    decision_rate = decision_count / duration_minutes if duration_minutes else None
    readable_rate = sign_readable_count / duration_minutes if duration_minutes else None
    look_rate = look_total / duration_minutes if duration_minutes else None
    readable_ratio = safe_ratio(sign_readable_count, sign_visible_count)
    first_action_latency = first_event_latency_any(rows, ACTION_START_EVENTS, window)
    prompt_to_confirmation = latency_between_event_groups(rows, PROMPT_EVENTS, CONFIRMATION_EVENTS)
    decision_dwell_total, decision_dwell_mean, decision_dwell_n = event_interval_stats(rows, "decision_point_enter", "decision_point_exit", window)
    sign_gap_mean, sign_gap_max = event_gap_stats(rows, "sign_readable")
    decision_coverage_proxy = safe_ratio(sign_readable_count, decision_count)
    disfluency_proxy = route_confirmation_disfluency_proxy(
        readable_ratio=readable_ratio,
        prompt_to_confirmation=prompt_to_confirmation,
        max_confirmation_gap=sign_gap_max,
        decision_dwell_total=decision_dwell_total,
        scan_both=scan_both,
        inefficiency=navigation_inefficiency_proxy,
    )
    accuracy = marker_accuracy_summary(rows, completion)
    prompt_channel = infer_prompt_channel(rows)
    instruction_clarity = infer_instruction_clarity(rows)
    metrics = [
        ["prompt_channel", prompt_channel],
        ["protective_action_instruction_clarity", instruction_clarity],
        ["trial_duration_s", fmt(window["duration_s"]) if window else "-"],
        ["exit_label", completion.get("exit", "") if completion else "-"],
        ["horizontal_distance_m", fmt(to_float(completion.get("horizontal_distance_m"))) if completion else "-"],
        ["first_action_latency_s", fmt(first_action_latency)],
        ["time_to_first_sign_readable_s", fmt(first_event_latency(rows, "sign_readable", window))],
        ["prompt_to_first_confirmation_s", fmt(prompt_to_confirmation)],
        ["time_to_first_decision_s", fmt(first_event_latency(rows, "decision_point_enter", window))],
        ["decision_dwell_total_s", fmt(decision_dwell_total)],
        ["decision_dwell_mean_s", fmt(decision_dwell_mean)],
        ["decision_dwell_episode_count", str(decision_dwell_n)],
        ["sign_readable_latency_from_visible_s", fmt(mean_sign_readable_latency(rows))],
        ["sign_visible_count", str(sign_visible_count)],
        ["sign_readable_count", str(sign_readable_count)],
        ["sign_readable_ratio", fmt(readable_ratio)],
        ["sign_readable_per_min", fmt(readable_rate)],
        ["sign_readable_mean_gap_s", fmt(sign_gap_mean)],
        ["sign_readable_max_gap_s", fmt(sign_gap_max)],
        ["decision_point_count", str(decision_count)],
        ["decision_point_coverage_proxy", fmt(decision_coverage_proxy)],
        ["decision_left_look_count", str(left_looks)],
        ["decision_right_look_count", str(right_looks)],
        ["decision_total_look_count", str(look_total)],
        ["decision_look_balance_abs", str(look_balance_abs)],
        ["decision_scan_both_count", str(scan_both)],
        ["decision_points_per_min", fmt(decision_rate)],
        ["decision_looks_per_min", fmt(look_rate)],
        ["dwell_count", str(dwell_count)],
        ["u_turn_count", str(u_turn_count)],
        ["backtrack_count", str(backtrack_count)],
        ["navigation_inefficiency_proxy", str(navigation_inefficiency_proxy)],
        ["decision_load_proxy", str(decision_load_proxy)],
        ["behavior_load_proxy", str(behavior_load_proxy)],
        ["behavior_load_proxy_per_min", fmt(behavior_load_rate)],
        ["route_confirmation_disfluency_proxy", fmt(disfluency_proxy)],
        ["first_choice_correct", accuracy["first_choice_correct"]],
        ["decision_choice_accuracy_ratio", accuracy["decision_choice_accuracy_ratio"]],
        ["decision_choice_correct_count", accuracy["decision_choice_correct_count"]],
        ["decision_choice_total_count", accuracy["decision_choice_total_count"]],
        ["final_arrival_correct", accuracy["final_arrival_correct"]],
    ]
    metrics.extend([[event, str(counts.get(event, 0))] for event in BEHAVIOR_EVENTS])

    return {
        "title": "trial-level Unity 行为 marker 指标",
        "columns": ["metric", "value"],
        "rows": metrics,
    }


def build_marker_availability_table(
    primary_rows: list[dict[str, Any]],
    marker_rows: list[dict[str, Any]],
    eeg_stream_count: int,
    eeg_report: dict[str, Any] | None,
    duplicate_count: int,
) -> dict[str, Any]:
    rows = primary_rows or marker_rows
    valid_event_epochs = 0
    if isinstance(eeg_report, dict) and isinstance(eeg_report.get("metrics"), dict):
        valid_event_epochs = int(to_float(eeg_report["metrics"].get("valid_event_epochs")) or 0)

    has_start = marker_has_event(rows, START_EVENTS)
    has_complete = marker_has_event(rows, (END_EVENT,))
    support_fields = present_fields(rows, SUPPORT_LEVEL_FIELDS)
    signature_fields = present_fields(rows, SIGNATURE_FIELDS)
    sign_events = present_events(rows, SIGNAGE_EVENTS)
    decision_events = present_events(rows, DECISION_EVENTS)
    inefficiency_events = present_events(rows, INEFFICIENCY_EVENTS)
    action_events = present_events(rows, ACTION_START_EVENTS)
    prompt_events = present_events(rows, PROMPT_EVENTS)
    choice_fields = present_fields(rows, CHOICE_CORRECTNESS_FIELDS)
    final_fields = present_fields(rows, FINAL_CORRECTNESS_FIELDS)
    clarity_fields = present_fields(rows, INSTRUCTION_CLARITY_FIELDS)
    reliability_fields = present_fields(rows, RELIABILITY_FIELDS)
    has_position_fields = bool(present_fields(rows, ("root_x", "root_y", "root_z", "view_yaw", "distance_m", "horizontal_distance_m")))

    table_rows: list[list[str]] = [
        [
            "trial 时间窗与完成时长",
            "真实 marker" if has_start and has_complete else "部分可用",
            format_basis(present_events(rows, START_EVENTS + (END_EVENT,))),
            "优先使用 map_start/trial_start/session_start 到 evacuation_complete；缺少起止点时用该 session 的首末 marker 估计，并在报告说明。",
        ],
        [
            "低/中/高路径确认支持条件",
            "真实字段" if support_fields else ("marker 推导" if signature_fields else "元数据待补"),
            format_basis(support_fields or signature_fields),
            "有 support_level 时直接读取；否则按 Signature1/2/3 或文件三连号映射为低/中/高条件。",
        ],
        [
            "路径确认线索接触与可读",
            "真实 marker" if {"sign_visible_enter", "sign_readable"} & set(sign_events) else "不可用",
            format_basis(sign_events),
            "用于计算可见/可读次数、可读比例、首次可读时间、可读标识间隔，并作为 sign_readable EEG 事件窗。",
        ],
        [
            "决策点行为",
            "真实 marker" if "decision_point_enter" in signless_set(decision_events) else ("部分可用" if decision_events else "不可用"),
            format_basis(decision_events),
            "用于计算决策点次数、首次决策点、左右查看、双侧扫描和决策点 EEG 事件窗。",
        ],
        [
            "行动启动",
            "真实 marker" if action_events else "不可用",
            format_basis(action_events),
            "用于计算从 trial 起点到首次 movement_start 的启动延迟；没有该事件时不推断启动时间。",
        ],
        [
            "提示到现场确认链",
            "真实 marker + 推导" if prompt_events and sign_events else ("部分可用" if prompt_events or sign_events else "不可用"),
            format_basis(prompt_events + sign_events),
            "使用 audio_play 等提示事件到 sign_visible_enter/sign_readable 的间隔，刻画官方提醒到现场确认线索的衔接。",
        ],
        [
            "停留、掉头、回退与低效导航",
            "真实 marker" if inefficiency_events else ("代理指标" if decision_events else "不可用"),
            format_basis(inefficiency_events or decision_events),
            "优先使用 dwell_detected、u_turn_detected、route_backtrack_detected；缺少回退 marker 时只保留决策扫描和停留代理，论文中不能写成真实回头路次数。",
        ],
        [
            "路径判断准确率",
            "真实字段" if choice_fields or final_fields else "不可用",
            format_basis(choice_fields + final_fields),
            "需要 choice_correct/route_correct/success 等字段；缺失时只报告行动迟滞和负荷，不能判断速度与正确性的权衡。",
        ],
        [
            "EEG 信息加工负荷",
            "真实 EEG + marker 对齐" if eeg_stream_count and valid_event_epochs else ("部分可用" if eeg_stream_count else "不可用"),
            f"EEG stream={eeg_stream_count}; 有效事件窗={valid_event_epochs}",
            "使用任务期频带功率与 sign_readable、decision_point_enter 事件窗；事件窗不足时只作为 EEG 质控或探索性结果。",
        ],
        [
            "M1 感知信息可靠性",
            "真实字段" if reliability_fields else "元数据/问卷待补",
            format_basis(reliability_fields),
            "可靠性感知应来自问卷或显式评分字段；XDF 行为线索只能作为操纵检查和机制解释材料。",
        ],
        [
            "保护性行动指令清晰度与被试间变量",
            "真实字段" if clarity_fields else ("代理字段" if prompt_events else "元数据待补"),
            format_basis(clarity_fields or prompt_events),
            "正式被试间或调节分析需要 subject/run metadata；仅凭 audio_play 只能确认提示出现，不能确认清晰度等级。",
        ],
        [
            "位置与朝向辅助信息",
            "真实字段" if has_position_fields else "不可用",
            format_basis(present_fields(rows, ("root_x", "root_y", "root_z", "view_yaw", "distance_m", "horizontal_distance_m"))),
            "可用于解释路径距离、视角和标识距离；若只有离散 marker 时刻，不能替代连续轨迹日志。",
        ],
        [
            "重复 marker 处理",
            "已处理" if duplicate_count else "无需处理",
            f"疑似重复 {duplicate_count} 条",
            "session 切分表保留原始计数；行为指标和 EEG 事件窗使用去重后的主 trial marker。",
        ],
    ]

    return {
        "title": "现有 Unity marker 指标可用性与适配口径",
        "columns": ["分析目标", "状态", "现有依据", "当前处理"],
        "rows": table_rows,
    }


def replace_marker_availability_table(tables: list[dict[str, Any]], table: dict[str, Any]) -> None:
    for index, existing in enumerate(tables):
        if existing.get("title") == table.get("title"):
            tables[index] = table
            return
    tables.append(table)


def marker_has_event(rows: list[dict[str, Any]], events: tuple[str, ...] | list[str]) -> bool:
    event_set = {event.lower() for event in events}
    return any(str(row.get("event", "")).lower() in event_set for row in rows)


def present_events(rows: list[dict[str, Any]], events: tuple[str, ...] | list[str]) -> list[str]:
    event_set = {event.lower() for event in events}
    present = {str(row.get("event", "")).lower(): str(row.get("event", "")) for row in rows if str(row.get("event", "")).lower() in event_set}
    return [present[event.lower()] for event in events if event.lower() in present]


def present_fields(rows: list[dict[str, Any]], fields: tuple[str, ...] | list[str]) -> list[str]:
    field_set = {field.lower() for field in fields}
    present: dict[str, str] = {}
    for row in rows:
        for key, value in row.items():
            key_text = str(key).lower()
            if key_text in field_set and value not in (None, ""):
                present[key_text] = str(key)
    return [present[field.lower()] for field in fields if field.lower() in present]


def format_basis(items: list[str]) -> str:
    if not items:
        return "-"
    return ", ".join(items[:8]) + (" 等" if len(items) > 8 else "")


def signless_set(values: list[str]) -> set[str]:
    return {str(value).lower() for value in values}


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
        tables.append(event_report["metricsTable"])
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
        frontal_theta = float(np.nanmean(theta[frontal_indices]))
        posterior_alpha = float(np.nanmean(alpha[posterior_indices]))
        theta_alpha_ratio = safe_ratio(float(np.nanmean(theta)), float(np.nanmean(alpha)))
        eeg_event_load_proxy = (
            math.log10(frontal_theta + 1e-12)
            - math.log10(posterior_alpha + 1e-12)
            + math.log10((theta_alpha_ratio or 0.0) + 1e-12)
        )
        feature_rows.append(
            {
                "event": event,
                "window_s": duration,
                "xdf_time": start_ts,
                "samples": len(epoch),
                "frontal_theta": frontal_theta,
                "posterior_alpha": posterior_alpha,
                "theta_alpha_ratio": theta_alpha_ratio,
                "eeg_event_load_proxy": eeg_event_load_proxy,
                "near_audio": has_nearby_event(rows, start_ts, "audio_play", radius_s=2.0),
                "near_inefficiency": any(has_nearby_event(rows, start_ts, event_name, radius_s=4.0) for event_name in INEFFICIENCY_EVENTS),
            }
        )

    if not feature_rows:
        return None

    summary = []
    metrics_rows = []
    chart_data = []
    load_chart_data = []
    for event in EVENT_WINDOWS:
        event_rows = [row for row in feature_rows if row["event"] == event]
        if not event_rows:
            continue
        mean_theta = mean_numeric([row["frontal_theta"] for row in event_rows])
        mean_alpha = mean_numeric([row["posterior_alpha"] for row in event_rows])
        mean_ratio = mean_numeric([row["theta_alpha_ratio"] for row in event_rows])
        mean_load = mean_numeric([row["eeg_event_load_proxy"] for row in event_rows])
        near_audio = sum(row["near_audio"] for row in event_rows)
        near_inefficiency = sum(row["near_inefficiency"] for row in event_rows)
        summary.append(
            [
                event,
                str(len(event_rows)),
                fmt(mean_theta),
                fmt(mean_alpha),
                fmt(mean_ratio),
                fmt(mean_load),
                str(near_audio),
                str(near_inefficiency),
            ]
        )
        metrics_rows.extend(
            [
                [f"{event}_epochs", str(len(event_rows))],
                [f"{event}_frontal_theta", fmt(mean_theta)],
                [f"{event}_posterior_alpha", fmt(mean_alpha)],
                [f"{event}_theta_alpha_ratio", fmt(mean_ratio)],
                [f"{event}_eeg_load_proxy", fmt(mean_load)],
                [f"{event}_near_audio_epochs", str(near_audio)],
                [f"{event}_near_navigation_inefficiency_epochs", str(near_inefficiency)],
            ]
        )
        chart_data.append({"label": event, "value": safe_chart_value(mean_ratio)})
        load_chart_data.append({"label": event, "value": safe_chart_value(mean_load)})

    return {
        "valid_event_epochs": len(feature_rows),
        "metricsTable": {
            "title": "事件窗 EEG 指标（run-level）",
            "columns": ["metric", "value"],
            "rows": metrics_rows,
        },
        "table": {
            "title": "事件锁定 EEG 特征摘要",
            "columns": [
                "event",
                "epochs",
                "mean_frontal_theta",
                "mean_posterior_alpha",
                "mean_theta_alpha_ratio",
                "mean_eeg_event_load_proxy",
                "near_audio_epochs",
                "near_navigation_inefficiency_epochs",
            ],
            "rows": summary,
        },
        "chart": {
            "type": "bar",
            "title": "事件窗 EEG load proxy",
            "xLabel": "event",
            "yLabel": "load proxy",
            "data": load_chart_data or chart_data,
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


def deduplicate_marker_rows(rows: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], int]:
    deduped: list[dict[str, Any]] = []
    seen: set[tuple[Any, ...]] = set()
    duplicate_count = 0
    for row in sorted(rows, key=lambda item: item["_xdf_ts"]):
        key = marker_duplicate_key(row)
        if key in seen:
            duplicate_count += 1
            continue
        seen.add(key)
        deduped.append(row)
    return deduped, duplicate_count


def marker_duplicate_key(row: dict[str, Any]) -> tuple[Any, ...]:
    key_fields = (
        "event",
        "subject",
        "session",
        "map",
        "signage",
        "signature",
        "audio",
        "unity_frame",
        "session_time_s",
        "root_x",
        "root_y",
        "root_z",
        "view_yaw",
        "distance_m",
        "horizontal_distance_m",
    )
    values: list[Any] = []
    for field in key_fields:
        value = row.get(field, "")
        numeric = to_float(value)
        if numeric is not None:
            values.append((field, round(numeric, 3)))
        else:
            values.append((field, str(value).strip().lower()))
    if not row.get("unity_frame") and not row.get("session_time_s"):
        values.append(("_xdf_ts", round(float(row.get("_xdf_ts", 0.0)), 3)))
    return tuple(values)


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


def first_event_latency_any(rows: list[dict[str, Any]], events: tuple[str, ...], window: dict[str, float] | None) -> float | None:
    if not window:
        return None
    event_set = {event.lower() for event in events}
    for row in sorted(rows, key=lambda item: item["_xdf_ts"]):
        if str(row.get("event", "")).lower() in event_set:
            return float(row["_xdf_ts"]) - window["start_ts"]
    return None


def latency_between_event_groups(rows: list[dict[str, Any]], start_events: tuple[str, ...], end_events: tuple[str, ...]) -> float | None:
    start_set = {event.lower() for event in start_events}
    end_set = {event.lower() for event in end_events}
    start_ts: float | None = None
    for row in sorted(rows, key=lambda item: item["_xdf_ts"]):
        event = str(row.get("event", "")).lower()
        if start_ts is None and event in start_set:
            start_ts = float(row["_xdf_ts"])
            continue
        if start_ts is not None and event in end_set and float(row["_xdf_ts"]) >= start_ts:
            return float(row["_xdf_ts"]) - start_ts
    return None


def event_interval_stats(
    rows: list[dict[str, Any]],
    enter_event: str,
    exit_event: str,
    window: dict[str, float] | None,
) -> tuple[float | None, float | None, int]:
    intervals: list[float] = []
    open_ts: float | None = None
    for row in sorted(rows, key=lambda item: item["_xdf_ts"]):
        event = str(row.get("event", ""))
        ts = float(row["_xdf_ts"])
        if event == enter_event:
            open_ts = ts
        elif event == exit_event and open_ts is not None and ts >= open_ts:
            intervals.append(ts - open_ts)
            open_ts = None
    if not intervals:
        duration_values = []
        for row in rows:
            event = str(row.get("event", ""))
            if event in {"dwell_detected", enter_event}:
                value = first_numeric_field(row, ("duration_s", "dwell_s", "stay_s", "pause_s"))
                if value is not None and value >= 0:
                    duration_values.append(value)
        intervals = duration_values
    if not intervals:
        return None, None, 0
    return float(np.sum(intervals)), float(np.mean(intervals)), len(intervals)


def event_gap_stats(rows: list[dict[str, Any]], event: str) -> tuple[float | None, float | None]:
    timestamps = [float(row["_xdf_ts"]) for row in sorted(rows, key=lambda item: item["_xdf_ts"]) if row.get("event") == event]
    if len(timestamps) < 2:
        return None, None
    gaps = np.diff(np.asarray(timestamps, dtype=float))
    return float(np.mean(gaps)), float(np.max(gaps))


def route_confirmation_disfluency_proxy(
    *,
    readable_ratio: float | None,
    prompt_to_confirmation: float | None,
    max_confirmation_gap: float | None,
    decision_dwell_total: float | None,
    scan_both: int,
    inefficiency: int,
) -> float | None:
    parts = []
    if readable_ratio is not None:
        parts.append(max(0.0, 1.0 - readable_ratio) * 4.0)
    if prompt_to_confirmation is not None:
        parts.append(math.log1p(max(0.0, prompt_to_confirmation)))
    if max_confirmation_gap is not None:
        parts.append(math.log1p(max(0.0, max_confirmation_gap)))
    if decision_dwell_total is not None:
        parts.append(math.log1p(max(0.0, decision_dwell_total)))
    parts.append(float(scan_both))
    parts.append(float(inefficiency))
    return float(np.sum(parts)) if parts else None


def first_numeric_field(row: dict[str, Any], keys: tuple[str, ...]) -> float | None:
    for key in keys:
        value = to_float(row.get(key))
        if value is not None:
            return value
    return None


def marker_accuracy_summary(rows: list[dict[str, Any]], completion: dict[str, Any] | None) -> dict[str, str]:
    decision_values: list[bool] = []
    first_choice: bool | None = None
    for row in sorted(rows, key=lambda item: item["_xdf_ts"]):
        value = marker_bool_value(
            row,
            (
                "first_choice_correct",
                "direction_correct",
                "decision_correct",
                "choice_correct",
                "route_choice_correct",
                "correct",
            ),
        )
        if value is None:
            continue
        if first_choice is None:
            first_choice = value
        decision_values.append(value)

    final_correct = marker_bool_value(
        completion or {},
        (
            "final_arrival_correct",
            "arrived_correct_exit",
            "route_correct",
            "target_reached",
            "reached_target",
            "success",
            "correct_exit",
        ),
    )
    correct_count = sum(1 for value in decision_values if value)
    total_count = len(decision_values)
    return {
        "first_choice_correct": bool_label(first_choice),
        "decision_choice_accuracy_ratio": fmt(safe_ratio(correct_count, total_count)) if total_count else "-",
        "decision_choice_correct_count": str(correct_count) if total_count else "-",
        "decision_choice_total_count": str(total_count) if total_count else "-",
        "final_arrival_correct": bool_label(final_correct),
    }


def marker_bool_value(row: dict[str, Any], keys: tuple[str, ...]) -> bool | None:
    normalized_keys = {key.lower() for key in keys}
    for key, value in row.items():
        key_text = str(key).lower()
        if key_text not in normalized_keys:
            continue
        parsed = parse_boolish(value)
        if parsed is not None:
            return parsed
    return None


def parse_boolish(value: Any) -> bool | None:
    text = str(value).strip().lower()
    if text in {"1", "true", "yes", "y", "correct", "success", "right", "target", "到达", "正确", "成功"}:
        return True
    if text in {"0", "false", "no", "n", "incorrect", "wrong", "fail", "failed", "错误", "失败"}:
        return False
    return None


def bool_label(value: bool | None) -> str:
    if value is True:
        return "yes"
    if value is False:
        return "no"
    return "-"


def infer_prompt_channel(rows: list[dict[str, Any]]) -> str:
    text = marker_text(rows)
    if any(keyword in text for keyword in ("mobile", "popup", "phone", "handheld", "text_message", "visual_message", "手机", "弹窗")):
        return "mobile_visual"
    if any(keyword in text for keyword in ("audio", "broadcast", "voice", "sound", "广播", "语音", "听觉")):
        return "auditory_broadcast"
    return "待补 marker/metadata"


def infer_instruction_clarity(rows: list[dict[str, Any]]) -> str:
    text = marker_text(rows)
    if any(keyword in text for keyword in ("clarity=high", "instruction_clarity=high", "clear", "高清晰", "高明确")):
        return "high"
    if any(keyword in text for keyword in ("clarity=low", "instruction_clarity=low", "unclear", "低清晰", "低明确")):
        return "low"
    return "待补 marker/metadata"


def marker_text(rows: list[dict[str, Any]]) -> str:
    return " ".join(str(value).lower() for row in rows for value in row.values() if value is not None)


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


def mean_numeric(values: list[Any]) -> float | None:
    clean = [value for value in (to_float(item) for item in values) if value is not None]
    return float(np.mean(clean)) if clean else None


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


def is_legacy_jwt_key(key: str) -> bool:
    return key.startswith("eyJ")


def h(value: Any) -> str:
    return html_lib.escape("" if value is None else str(value), quote=True)


def short_label(value: str, limit: int = 18) -> str:
    text = str(value)
    return text if len(text) <= limit else f"{text[: limit - 1]}…"


def sanitize_filename(value: str) -> str:
    cleaned = "".join(ch.lower() if ("a" <= ch.lower() <= "z" or "0" <= ch <= "9") else "-" for ch in value)
    cleaned = "-".join(part for part in cleaned.split("-") if part)
    return (cleaned or "xdf-report")[:90]


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


HTML_REPORT_STYLE = """
<style>
:root {
  --bg: #f7faf9;
  --card: #ffffff;
  --ink: #12201d;
  --muted: #65736f;
  --line: #d8e1df;
  --green: #3f7f75;
  --coral: #c95f4a;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font: 15px/1.58 -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", Arial, sans-serif;
}
main { max-width: 1180px; margin: 0 auto; padding: 30px; }
.hero { margin-bottom: 18px; }
.eyebrow {
  margin: 0 0 8px;
  color: var(--green);
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0;
  text-transform: uppercase;
}
h1 { margin: 0 0 8px; font-size: 30px; line-height: 1.18; }
h2 { margin: 0 0 14px; font-size: 20px; }
p { margin: 8px 0; }
.muted { color: var(--muted); }
.card {
  margin: 18px 0;
  padding: 18px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--card);
  box-shadow: 0 1px 2px rgba(18, 32, 29, 0.04);
}
.grid.two {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}
.chart-wide { grid-column: 1 / -1; }
.metric-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 12px;
  margin: 18px 0;
}
.metric {
  padding: 14px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #fff;
}
.metric span { display: block; color: var(--muted); font-size: 12px; font-weight: 800; }
.metric strong { display: block; margin-top: 6px; font-size: 24px; }
.metric p { color: var(--muted); font-size: 13px; }
.narrative-grid { align-items: stretch; }
.narrative-card p {
  margin: 10px 0;
  color: #31403d;
  text-align: justify;
}
.chart-caption {
  margin-top: 10px;
  color: #4f625e;
  font-size: 13px;
}
.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th, td {
  padding: 8px 9px;
  border-bottom: 1px solid var(--line);
  text-align: left;
  vertical-align: top;
}
th { background: #edf4f2; font-weight: 800; }
pre {
  max-height: 440px;
  overflow: auto;
  padding: 14px;
  border-radius: 8px;
  background: #17211f;
  color: #eef6f3;
  white-space: pre-wrap;
}
code { font-family: Consolas, "SFMono-Regular", monospace; }
.chart {
  width: 100%;
  height: auto;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #fff;
}
.chart-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
  margin-top: 10px;
  color: #40504c;
  font-size: 12px;
  font-weight: 700;
}
.chart-legend span { display: inline-flex; align-items: center; gap: 6px; }
.chart-legend i {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
}
.heatmap-wrap {
  overflow-x: auto;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #fff;
}
.heatmap-table {
  min-width: 680px;
  border-collapse: separate;
  border-spacing: 0;
}
.heatmap-table th,
.heatmap-table td {
  border-bottom: 1px solid #e6eeeb;
  border-right: 1px solid #e6eeeb;
}
.heatmap-table tr:last-child td { border-bottom: 0; }
.heatmap-table th:last-child,
.heatmap-table td:last-child { border-right: 0; }
.heatmap-label {
  width: 220px;
  background: #fbfdfc;
  color: #263632;
  font-weight: 800;
}
.heatmap-cell {
  min-width: 130px;
  color: #10201d;
  font-weight: 800;
  text-align: center;
}
.heatmap-empty {
  color: var(--muted);
  text-align: center;
  background: #f6f8f8;
}
.svg-label { font: 12px "Segoe UI", Arial, sans-serif; fill: #33423f; font-weight: 800; }
.svg-small { font: 11px "Segoe UI", Arial, sans-serif; fill: #65736f; }
@media (max-width: 860px) {
  main { padding: 18px; }
  .grid.two { grid-template-columns: 1fr; }
}
</style>
"""


if __name__ == "__main__":
    main()
