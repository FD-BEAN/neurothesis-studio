#!/usr/bin/env python
"""Advanced online analysis worker for NeuroThesis Studio.

This script is intended to run in GitHub Actions. It reads one analysis job from
Supabase, downloads the private research file with a service role key, performs
deterministic scientific summaries, and writes a JSON report back to
research_analysis_jobs.result_json.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import tempfile
import traceback
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any
from urllib.parse import quote

import numpy as np
import pandas as pd
import requests


BUCKET = "research-files"


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
                "status_message": "Python worker failed.",
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
            "status_message": "Python worker 正在下载文件并运行分析。",
            "github_run_url": run_url,
        },
    )

    job = client.select_one("research_analysis_jobs", f"id=eq.{job_id}&select=*")
    document = client.select_one("research_documents", f"id=eq.{job['document_id']}&select=*")

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        extension = get_extension(document["filename"])
        local_file = tmp_path / f"input.{extension or 'dat'}"
        client.download_storage_object(document["storage_path"], local_file)
        report = analyze_file(document, local_file, extension)

    client.update_job(
        job_id,
        {
            "status": "completed",
            "status_message": "高级 Python 分析完成。",
            "result_json": report,
            "error_message": None,
            "completed_at": now_sql(),
            "github_run_url": run_url,
        },
    )


def analyze_file(document: dict[str, Any], path: Path, extension: str) -> dict[str, Any]:
    if extension in {"csv", "tsv"}:
        sep = "\t" if extension == "tsv" else ","
        frame = pd.read_csv(path, sep=sep)
        return analyze_dataframe(document, frame, extension.upper())

    if extension in {"json", "jsonl"}:
        if extension == "jsonl":
            frame = pd.read_json(path, lines=True)
        else:
            raw = json.loads(path.read_text(encoding="utf-8"))
            frame = pd.json_normalize(raw if isinstance(raw, list) else [raw])
        return analyze_dataframe(document, frame, extension.upper())

    if extension == "xdf":
        return analyze_xdf(document, path)

    if extension == "svg":
        return analyze_svg(document, path.read_text(encoding="utf-8", errors="replace"))

    return analyze_text(document, path.read_text(encoding="utf-8", errors="replace"), extension or "TEXT")


def analyze_dataframe(document: dict[str, Any], frame: pd.DataFrame, kind: str) -> dict[str, Any]:
    clean = frame.copy()
    clean.columns = [str(col).strip() for col in clean.columns]
    numeric = clean.apply(pd.to_numeric, errors="coerce")
    numeric_columns = [col for col in clean.columns if numeric[col].notna().sum() >= max(3, len(clean) * 0.3)]
    categorical_columns = get_categorical_columns(clean)

    charts: list[dict[str, Any]] = []
    tables: list[dict[str, Any]] = []
    notes: list[str] = []

    if categorical_columns:
        column = categorical_columns[0]
        counts = value_counts(clean[column], limit=16)
        charts.append(
            {
                "type": "bar",
                "title": f"{column} 分布",
                "xLabel": column,
                "yLabel": "记录数",
                "data": [{"label": label, "value": value} for label, value in counts],
            }
        )

    scatter = build_scatter(clean)
    if scatter:
        charts.append(
            {
                "type": "scatter",
                "title": "平面坐标分布",
                "xLabel": "x",
                "yLabel": "z",
                "data": scatter,
            }
        )

    numeric_rows = []
    for column in numeric_columns[:20]:
        series = numeric[column].dropna()
        numeric_rows.append(
            [
                column,
                str(int(series.count())),
                fmt(series.min()),
                fmt(series.max()),
                fmt(series.mean()),
                fmt(series.std(ddof=1) if series.count() > 1 else 0),
            ]
        )
    if numeric_rows:
        tables.append(
            {
                "title": "数值变量描述统计",
                "columns": ["变量", "有效值", "最小值", "最大值", "均值", "标准差"],
                "rows": numeric_rows,
            }
        )

    categorical_rows = []
    for column in categorical_columns[:12]:
        counts = value_counts(clean[column], limit=4)
        categorical_rows.append(
            [
                column,
                str(clean[column].dropna().astype(str).nunique()),
                "；".join(f"{label} ({value})" for label, value in counts),
            ]
        )
    if categorical_rows:
        tables.append(
            {
                "title": "分类变量概览",
                "columns": ["变量", "不同取值数", "最高频取值"],
                "rows": categorical_rows,
            }
        )

    signage_notes = summarize_signage_table(clean)
    notes.extend(signage_notes)

    event_report = summarize_event_table(clean)
    if event_report:
        charts.extend(event_report["charts"])
        tables.extend(event_report["tables"])
        notes.extend(event_report["notes"])

    model_report = run_model_if_possible(clean)
    if model_report:
        tables.extend(model_report["tables"])
        notes.extend(model_report["notes"])

    return {
        "title": f"{document['filename']} 高级 Python 分析",
        "kind": kind,
        "summary": f"Python worker 已读取该表格，共 {len(clean)} 行、{len(clean.columns)} 个字段。报告包含描述统计、条件分布、实验口径检查和可用时的统计模型。",
        "metrics": [
            {"label": "记录数", "value": str(len(clean))},
            {"label": "字段数", "value": str(len(clean.columns))},
            {"label": "数值字段", "value": str(len(numeric_columns))},
            {"label": "分类字段", "value": str(len(categorical_columns))},
        ],
        "charts": charts[:6],
        "tables": tables[:8],
        "notes": notes or ["未发现特定实验字段；当前报告以通用描述统计为主。"],
    }


def analyze_xdf(document: dict[str, Any], path: Path) -> dict[str, Any]:
    import pyxdf

    streams, _header = pyxdf.load_xdf(str(path), dejitter_timestamps=True, verbose=False)
    stream_rows = []
    marker_streams = []
    eeg_streams = []

    for stream in streams:
        info = stream["info"]
        name = meta_value(info, "name")
        stream_type = meta_value(info, "type")
        srate = float(meta_value(info, "nominal_srate", 0) or 0)
        channels = int(meta_value(info, "channel_count", 0) or 0)
        timestamps = np.asarray(stream.get("time_stamps", []), dtype=float)
        duration = float(timestamps[-1] - timestamps[0]) if len(timestamps) > 1 else 0.0
        samples = int(len(timestamps))
        stream_rows.append([name, stream_type, fmt(srate), str(channels), str(samples), fmt(duration)])

        lower = f"{name} {stream_type}".lower()
        if "marker" in lower:
            marker_streams.append(stream)
        if "eeg" in lower or "mitsar" in lower:
            eeg_streams.append((stream, duration, samples, channels, srate))

    tables = [
        {
            "title": "XDF stream 摘要",
            "columns": ["name", "type", "srate", "channels", "samples", "duration_s"],
            "rows": stream_rows,
        }
    ]
    charts: list[dict[str, Any]] = [
        {
            "type": "bar",
            "title": "stream 时长",
            "xLabel": "stream",
            "yLabel": "seconds",
            "data": [
                {"label": f"{row[0]} ({index + 1})", "value": round(float(row[5]), 3)}
                for index, row in enumerate(stream_rows)
            ],
        }
    ]
    notes: list[str] = []

    marker_count = 0
    valid_sessions = 0
    if marker_streams:
        marker_report = summarize_markers(marker_streams[0])
        marker_count = marker_report["marker_count"]
        valid_sessions = marker_report["valid_sessions"]
        charts.extend(marker_report["charts"])
        tables.extend(marker_report["tables"])
        notes.extend(marker_report["notes"])
    else:
        notes.append("没有发现 marker stream，无法进行事件锁定分析。")

    if len(eeg_streams) > 1:
        notes.append("发现多个 EEG/Mitsar stream，正式预处理前需要确定使用哪一条。")
    elif not eeg_streams:
        notes.append("没有发现明显 EEG/Mitsar stream。")

    return {
        "title": f"{document['filename']} XDF 高级质控",
        "kind": "XDF",
        "summary": "Python worker 已解析 LabRecorder XDF，输出 stream、marker session、event count 与 EEG 可用性摘要。",
        "metrics": [
            {"label": "stream 数", "value": str(len(streams))},
            {"label": "marker 数", "value": str(marker_count)},
            {"label": "EEG stream", "value": str(len(eeg_streams))},
            {"label": "完整 session", "value": str(valid_sessions)},
        ],
        "charts": charts[:6],
        "tables": tables[:8],
        "notes": notes,
    }


def summarize_markers(stream: dict[str, Any]) -> dict[str, Any]:
    rows = []
    for timestamp, row in zip(stream.get("time_stamps", []), stream.get("time_series", [])):
        raw = row[0] if isinstance(row, (list, tuple, np.ndarray)) and len(row) else row
        parsed = parse_marker(raw)
        parsed["_xdf_ts"] = float(timestamp)
        rows.append(parsed)

    event_counts = Counter(row.get("event", "<no_event>") for row in rows)
    grouped: dict[tuple[str, str, str, str, str], list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        grouped[
            (
                row.get("subject", ""),
                row.get("session", ""),
                row.get("map", ""),
                row.get("signage", ""),
                row.get("audio", ""),
            )
        ].append(row)

    session_rows = []
    valid_sessions = 0
    notes = []
    for key, items in sorted(grouped.items(), key=lambda item: len(item[1]), reverse=True)[:12]:
        events = {item.get("event", "") for item in items}
        times = [
            float(item["session_time_s"])
            for item in items
            if item.get("session_time_s") not in (None, "", "-1")
            and is_number(item.get("session_time_s"))
        ]
        has_start = bool({"session_start", "trial_start", "map_start"} & events)
        has_complete = "evacuation_complete" in events
        if has_start and has_complete:
            valid_sessions += 1
        session_rows.append(
            [
                key[0] or "-",
                key[1] or "-",
                key[2] or "-",
                key[3] or "-",
                key[4] or "-",
                str(len(items)),
                "yes" if has_start else "no",
                "yes" if has_complete else "no",
                fmt(min(times)) if times else "-",
                fmt(max(times)) if times else "-",
            ]
        )

    if not valid_sessions:
        notes.append("没有找到同时包含开始 marker 和 evacuation_complete 的完整 session。")

    return {
        "marker_count": len(rows),
        "valid_sessions": valid_sessions,
        "charts": [
            {
                "type": "bar",
                "title": "事件计数",
                "xLabel": "event",
                "yLabel": "markers",
                "data": [
                    {"label": label, "value": int(value)}
                    for label, value in event_counts.most_common(16)
                ],
            }
        ],
        "tables": [
            {
                "title": "marker session 切分",
                "columns": [
                    "subject",
                    "session",
                    "map",
                    "signature",
                    "audio",
                    "markers",
                    "start",
                    "complete",
                    "time_min",
                    "time_max",
                ],
                "rows": session_rows,
            }
        ],
        "notes": notes,
    }


def analyze_svg(document: dict[str, Any], text: str) -> dict[str, Any]:
    circle_count = len(re.findall(r"<circle\b", text, re.I))
    text_count = len(re.findall(r"<text\b", text, re.I))
    title_count = len(re.findall(r"<title\b", text, re.I))
    legend_ok = bool(re.search(r"0-8m|8-12m|blur/fade|clear", text, re.I))
    return {
        "title": f"{document['filename']} SVG 高级检查",
        "kind": "SVG",
        "summary": "Python worker 已检查 SVG 元素、图例和可读范围口径。",
        "metrics": [
            {"label": "circle", "value": str(circle_count)},
            {"label": "text", "value": str(text_count)},
            {"label": "title", "value": str(title_count)},
            {"label": "图例口径", "value": "已识别" if legend_ok else "需核对"},
        ],
        "charts": [
            {
                "type": "bar",
                "title": "SVG 元素数量",
                "xLabel": "元素",
                "yLabel": "数量",
                "data": [
                    {"label": "circle", "value": circle_count},
                    {"label": "text", "value": text_count},
                    {"label": "title", "value": title_count},
                ],
            }
        ],
        "tables": [],
        "notes": [
            "图例中包含 0-8m / 8-12m 或 clear / blur-fade 口径。" if legend_ok else "未识别到明确可读范围图例，建议人工核对。"
        ],
    }


def analyze_text(document: dict[str, Any], text: str, kind: str) -> dict[str, Any]:
    keywords = ["EEG", "VR", "Unity", "LSL", "marker", "Signature", "Metro", "cognitive load"]
    counts = [
        {"label": keyword, "value": len(re.findall(re.escape(keyword), text, re.I))}
        for keyword in keywords
    ]
    lines = text.splitlines()
    return {
        "title": f"{document['filename']} 文本高级摘要",
        "kind": kind.upper(),
        "summary": "Python worker 已统计文本规模和研究关键词频次。",
        "metrics": [
            {"label": "字符数", "value": str(len(text))},
            {"label": "行数", "value": str(len(lines))},
            {"label": "非空行", "value": str(sum(bool(line.strip()) for line in lines))},
            {"label": "词段数", "value": str(len(text.split()))},
        ],
        "charts": [
            {
                "type": "bar",
                "title": "关键词出现次数",
                "xLabel": "keyword",
                "yLabel": "count",
                "data": counts,
            }
        ],
        "tables": [],
        "notes": ["文本统计仅用于材料索引；论文结论仍应来自正式数据分析。"],
    }


def summarize_signage_table(frame: pd.DataFrame) -> list[str]:
    lower = {col.lower(): col for col in frame.columns}
    if "map" not in lower or "signature" not in lower:
        return []

    map_col = lower["map"]
    sig_col = lower["signature"]
    notes = []
    counts = frame.groupby([map_col, sig_col]).size().reset_index(name="n")
    by_map = frame.groupby(map_col).size().to_dict()
    notes.append(
        "识别为 Metro Rescue 条件/标识相关表；"
        + "，".join(f"{key}: {int(value)}" for key, value in sorted(by_map.items()))
        + "。"
    )

    if {"x", "z"}.issubset(lower):
        x_col = lower["x"]
        z_col = lower["z"]
        same_layout_maps = []
        for map_name, group in frame.groupby(map_col):
            signatures = {}
            for signature, sig_group in group.groupby(sig_col):
                coordinates = sorted(
                    (round(float(row[x_col]), 3), round(float(row[z_col]), 3))
                    for _, row in sig_group.dropna(subset=[x_col, z_col]).iterrows()
                )
                signatures[str(signature)] = coordinates
            if len({tuple(value) for value in signatures.values()}) == 1 and len(signatures) > 1:
                same_layout_maps.append(str(map_name))
        if same_layout_maps:
            notes.append(
                f"{', '.join(same_layout_maps)} 内不同 Signature 的 x/z 坐标一致；空间布局不能单独证明信息设计操控差异。"
            )

    if {"clear_radius_m", "blur_end_radius_m"}.issubset(lower):
        clear_values = sorted(frame[lower["clear_radius_m"]].dropna().astype(str).unique())
        blur_values = sorted(frame[lower["blur_end_radius_m"]].dropna().astype(str).unique())
        notes.append(f"可读范围字段：clear_radius_m={', '.join(clear_values)}；blur_end_radius_m={', '.join(blur_values)}。")

    if len(counts):
        notes.append("按 map × signature 的记录数：" + "；".join(
            f"{row[map_col]}-{row[sig_col]}={int(row['n'])}" for _, row in counts.iterrows()
        ))

    return notes


def summarize_event_table(frame: pd.DataFrame) -> dict[str, Any] | None:
    lower = {col.lower(): col for col in frame.columns}
    event_col = lower.get("event")
    if not event_col:
        return None

    counts = value_counts(frame[event_col], limit=18)
    charts = [
        {
            "type": "bar",
            "title": "事件类型计数",
            "xLabel": "event",
            "yLabel": "count",
            "data": [{"label": label, "value": value} for label, value in counts],
        }
    ]
    tables = [
        {
            "title": "事件类型计数",
            "columns": ["event", "count"],
            "rows": [[label, str(value)] for label, value in counts],
        }
    ]
    notes = ["识别到 event 字段，可用于 trial 切分、marker 对齐和行为指标提取。"]
    return {"charts": charts, "tables": tables, "notes": notes}


def run_model_if_possible(frame: pd.DataFrame) -> dict[str, Any] | None:
    import statsmodels.formula.api as smf

    lower = {col.lower(): col for col in frame.columns}
    subject_col = find_first(lower, ["subject", "sub", "participant", "participant_id", "user_id"])
    signature_col = find_first(lower, ["signature", "signage"])
    if not signature_col:
        return None

    candidate_outcomes = [
        "load",
        "cognitive_load",
        "theta_alpha",
        "theta_alpha_ratio",
        "frontal_theta",
        "completion_time",
        "path_length",
        "dwell_time",
    ]
    outcome_col = find_first(lower, candidate_outcomes)
    if not outcome_col:
        return None

    model_frame = frame.copy()
    model_frame[outcome_col] = pd.to_numeric(model_frame[outcome_col], errors="coerce")
    model_frame = model_frame.dropna(subset=[outcome_col, signature_col])
    if len(model_frame) < 8 or model_frame[signature_col].nunique() < 2:
        return None

    predictors = [f"C({safe_formula_name(signature_col)})"]
    for candidate in ["map", "metro", "audio", "trialorder", "trial_order", "order"]:
        col = lower.get(candidate)
        if col and col in model_frame and model_frame[col].nunique() > 1:
            predictors.append(f"C({safe_formula_name(col)})")

    formula = f"{safe_formula_name(outcome_col)} ~ " + " + ".join(predictors)
    renamed = {col: safe_formula_name(col) for col in model_frame.columns}
    model_frame = model_frame.rename(columns=renamed)
    notes = []

    try:
        if subject_col and subject_col in frame and frame[subject_col].nunique() > 1:
            result = smf.mixedlm(formula, model_frame, groups=model_frame[safe_formula_name(subject_col)]).fit(
                reml=False, method="lbfgs"
            )
            model_name = "MixedLM"
        else:
            result = smf.ols(formula, model_frame).fit()
            model_name = "OLS"
        coef_rows = []
        for name, coef in result.params.items():
            if name.lower().startswith("group"):
                continue
            pvalue = getattr(result, "pvalues", {}).get(name, np.nan)
            coef_rows.append([name, fmt(coef), fmt(pvalue) if np.isfinite(pvalue) else "-"])
        notes.append(f"已尝试 {model_name}：`{formula}`。模型结果用于探索，正式论文需按预注册/分析计划复核。")
        return {
            "tables": [
                {
                    "title": f"{model_name} 探索性模型",
                    "columns": ["term", "coef", "p_value"],
                    "rows": coef_rows[:18],
                }
            ],
            "notes": notes,
        }
    except Exception as exc:
        return {
            "tables": [],
            "notes": [f"检测到可建模字段，但统计模型拟合失败：{exc}。建议检查缺失值、样本量和变量编码。"],
        }


def get_categorical_columns(frame: pd.DataFrame) -> list[str]:
    columns = []
    for column in frame.columns:
        unique = frame[column].dropna().astype(str).nunique()
        if 1 < unique <= max(24, len(frame) * 0.65):
            columns.append(column)
    return sorted(columns, key=lambda col: frame[col].dropna().astype(str).value_counts().iloc[0] if frame[col].dropna().any() else 0, reverse=True)


def build_scatter(frame: pd.DataFrame) -> list[dict[str, Any]]:
    lower = {col.lower(): col for col in frame.columns}
    x_col = find_first(lower, ["x", "pos_x", "position_x"])
    z_col = find_first(lower, ["z", "pos_z", "position_z", "y"])
    if not x_col or not z_col:
        return []
    label_col = find_first(lower, ["sign", "event", "id", "name"]) or frame.columns[0]
    group_col = find_first(lower, ["map", "signature", "condition"])
    rows = []
    for index, row in frame.iterrows():
        x = to_float(row.get(x_col))
        y = to_float(row.get(z_col))
        if x is None or y is None:
            continue
        rows.append(
            {
                "label": str(row.get(label_col) or f"row {index + 1}"),
                "x": x,
                "y": y,
                "group": str(row.get(group_col)) if group_col else None,
            }
        )
    return rows[:220]


def value_counts(series: pd.Series, limit: int = 12) -> list[tuple[str, int]]:
    counts = series.fillna("<NA>").astype(str).value_counts().head(limit)
    return [(str(label), int(value)) for label, value in counts.items()]


def parse_marker(raw: Any) -> dict[str, str]:
    if isinstance(raw, (list, tuple, np.ndarray)) and len(raw):
        raw = raw[0]
    text = str(raw)
    parsed = {}
    for part in text.split(";"):
        if "=" not in part:
            continue
        key, value = part.split("=", 1)
        parsed[key.strip()] = value.strip()
    return parsed


def meta_value(info: dict[str, Any], key: str, default: Any = "") -> Any:
    value = info.get(key, default)
    if isinstance(value, list) and value:
        return value[0]
    return value


def find_first(mapping: dict[str, str], candidates: list[str]) -> str | None:
    for candidate in candidates:
        if candidate.lower() in mapping:
            return mapping[candidate.lower()]
    return None


def safe_formula_name(name: str) -> str:
    cleaned = re.sub(r"\W+", "_", str(name)).strip("_")
    if not cleaned or cleaned[0].isdigit():
        cleaned = f"v_{cleaned}"
    return cleaned


def to_float(value: Any) -> float | None:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def is_number(value: Any) -> bool:
    return to_float(value) is not None


def get_extension(filename: str) -> str:
    return filename.rsplit(".", 1)[-1].lower() if "." in filename else ""


def fmt(value: Any) -> str:
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


def now_sql() -> str:
    return pd.Timestamp.utcnow().isoformat()


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
    if pd.isna(value):
        return None
    return value


if __name__ == "__main__":
    main()
