#!/usr/bin/env python
r"""Summarize LabRecorder XDF files for Metro Rescue quality control.

Usage:
  python scripts/xdf_qc.py C:\path\to\file.xdf [more.xdf ...]

Requires pyxdf:
  python -m pip install pyxdf
"""

from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

try:
    import numpy as np
    import pyxdf
except ImportError as exc:  # pragma: no cover
    raise SystemExit(
        "Missing dependency. Install with: python -m pip install pyxdf numpy"
    ) from exc


def meta_value(info: dict[str, Any], key: str, default: Any = "") -> Any:
    value = info.get(key, default)
    if isinstance(value, list) and value:
        return value[0]
    return value


def parse_marker(text: Any) -> dict[str, str]:
    if not isinstance(text, str):
        if isinstance(text, (list, tuple, np.ndarray)) and len(text):
            text = str(text[0])
        else:
            text = str(text)

    parsed: dict[str, str] = {}
    for part in text.split(";"):
        if "=" not in part:
            continue
        key, value = part.split("=", 1)
        parsed[key.strip()] = value.strip()
    return parsed


def summarize_stream(stream: dict[str, Any]) -> dict[str, Any]:
    info = stream["info"]
    timestamps = np.asarray(stream.get("time_stamps", []), dtype=float)
    series = stream.get("time_series", [])
    shape = tuple(int(item) for item in getattr(series, "shape", (len(series),)))
    duration = float(timestamps[-1] - timestamps[0]) if len(timestamps) > 1 else 0.0

    return {
        "name": str(meta_value(info, "name")),
        "type": str(meta_value(info, "type")),
        "nominal_srate": float(meta_value(info, "nominal_srate", 0) or 0),
        "channel_count": int(meta_value(info, "channel_count", 0) or 0),
        "samples": int(len(timestamps)),
        "series_shape": shape,
        "duration_s": round(duration, 3),
        "first_ts": float(timestamps[0]) if len(timestamps) else None,
        "last_ts": float(timestamps[-1]) if len(timestamps) else None,
    }


def summarize_markers(stream: dict[str, Any]) -> dict[str, Any]:
    rows = []
    for timestamp, row in zip(stream.get("time_stamps", []), stream.get("time_series", [])):
        raw = row[0] if isinstance(row, (list, tuple, np.ndarray)) and len(row) else row
        parsed = parse_marker(raw)
        parsed["_xdf_ts"] = float(timestamp)
        rows.append(parsed)

    by_session: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in rows:
        session_key = "|".join(
            [
                row.get("subject", ""),
                row.get("session", ""),
                row.get("map", ""),
                row.get("signage", ""),
                row.get("audio", ""),
            ]
        )
        by_session[session_key].append(row)

    sessions = []
    for key, items in sorted(by_session.items(), key=lambda item: len(item[1]), reverse=True):
        events = Counter(item.get("event", "<no_event>") for item in items)
        session_times = [
            float(item["session_time_s"])
            for item in items
            if item.get("session_time_s") not in (None, "", "-1")
        ]
        event_names = set(events)
        sessions.append(
            {
                "key": key,
                "markers": len(items),
                "events": dict(events.most_common()),
                "session_time_min": round(min(session_times), 3) if session_times else None,
                "session_time_max": round(max(session_times), 3) if session_times else None,
                "has_task_start": bool({"session_start", "trial_start", "map_start"} & event_names),
                "has_evacuation_complete": "evacuation_complete" in event_names,
            }
        )

    return {
        "marker_count": len(rows),
        "event_counts": dict(Counter(row.get("event", "<no_event>") for row in rows).most_common()),
        "sessions": sessions,
    }


def summarize_xdf(path: Path) -> dict[str, Any]:
    streams, _header = pyxdf.load_xdf(str(path), dejitter_timestamps=True, verbose=False)
    stream_summaries = [summarize_stream(stream) for stream in streams]
    marker_streams = [
        stream
        for stream in streams
        if "Marker" in str(meta_value(stream["info"], "name"))
        or str(meta_value(stream["info"], "type")).lower() in {"marker", "markers"}
    ]
    eeg_streams = [
        item
        for item in stream_summaries
        if item["type"].lower() == "eeg" or "mitsar" in item["name"].lower()
    ]

    notes = []
    if not marker_streams:
        notes.append("No MetroRescueMarkers stream found.")
    if not eeg_streams:
        notes.append("No obvious EEG/Mitsar stream found.")
    if len(eeg_streams) > 1:
        notes.append("Multiple EEG streams found; choose the intended stream before analysis.")

    marker_summary = summarize_markers(marker_streams[0]) if marker_streams else None
    if marker_summary:
        valid_sessions = [
            session
            for session in marker_summary["sessions"]
            if session["has_task_start"] and session["has_evacuation_complete"]
        ]
        if not valid_sessions:
            notes.append("No marker session has both task start and evacuation_complete.")

    return {
        "file": str(path),
        "stream_count": len(streams),
        "streams": stream_summaries,
        "markers": marker_summary,
        "quality_notes": notes,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("xdf", nargs="+", type=Path)
    args = parser.parse_args()

    reports = [summarize_xdf(path) for path in args.xdf]
    print(json.dumps(reports, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
