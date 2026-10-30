"""Loader for the alternative public JSON metadata index."""

from __future__ import annotations

import json
import logging
import sqlite3
import urllib.request
from pathlib import Path

logger = logging.getLogger(__name__)
SOURCE_BASE = "https://raw.githubusercontent.com/av18live/japanese-adult-video-metadata/main/data"


def _load_json(name: str) -> list[dict]:
    with urllib.request.urlopen(f"{SOURCE_BASE}/{name}", timeout=30) as response:
        payload = json.load(response)
    return payload.get("data", [])


def ensure_metadata_database(path: Path, *, force: bool = False) -> None:
    if path.exists() and path.stat().st_size > 0 and not force:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    videos = _load_json("videos.json")
    actors = _load_json("actors.json")
    temp_path = path.with_suffix('.tmp')
    temp_path.unlink(missing_ok=True)
    conn = sqlite3.connect(temp_path)
    try:
        conn.executescript("""
            CREATE TABLE derived_actress (id INTEGER PRIMARY KEY, name_romaji TEXT, name_kanji TEXT, name_kana TEXT, image_url TEXT);
            CREATE TABLE derived_video (content_id TEXT PRIMARY KEY, dvd_id TEXT, title_en TEXT, title_ja TEXT, release_date TEXT, jacket_full_url TEXT);
            CREATE TABLE derived_video_actress (actress_id INTEGER, content_id TEXT, release_date TEXT, ordinality INTEGER);
            CREATE INDEX idx_alt_actress_name ON derived_actress(name_romaji);
            CREATE INDEX idx_alt_va_actress ON derived_video_actress(actress_id);
        """)
        actor_ids: dict[str, int] = {}
        names = {str(a.get("name", "")).strip() for a in actors if str(a.get("name", "")).strip()}
        for video in videos:
            names.update(str(a).strip() for a in video.get("actors", []) if str(a).strip())
        for actress_id, name in enumerate(sorted(names), 1):
            actor_ids[name] = actress_id
            conn.execute("INSERT INTO derived_actress VALUES (?, ?, ?, ?, NULL)", (actress_id, name, name, name))
        for video in videos:
            code = str(video.get("id", "")).strip()
            if not code:
                continue
            conn.execute("INSERT OR IGNORE INTO derived_video VALUES (?, ?, NULL, ?, ?, NULL)", (code, code, video.get("title"), video.get("release_date")))
            for ordinal, name in enumerate(video.get("actors", []), 1):
                actress_id = actor_ids.get(str(name).strip())
                if actress_id:
                    conn.execute("INSERT INTO derived_video_actress VALUES (?, ?, ?, ?)", (actress_id, code, video.get("release_date"), ordinal))
        conn.commit()
    finally:
        conn.close()
    temp_path.replace(path)


def refresh_metadata_database(path: Path) -> None:
    ensure_metadata_database(path, force=True)


def active_provider(db_path: Path, r18_path: Path) -> tuple[str, Path]:
    provider = "r18"
    try:
        conn = sqlite3.connect(db_path)
        row = conn.execute("SELECT metadata_provider FROM settings WHERE id = 1").fetchone()
        provider = row[0] if row and row[0] in {"r18", "japanese_adult_video_metadata"} else "r18"
        conn.close()
    except sqlite3.Error:
        pass
    if provider == "japanese_adult_video_metadata":
        return provider, r18_path.parent / "japanese-adult-video-metadata.db"
    return provider, r18_path
