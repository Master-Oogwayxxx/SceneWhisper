"""CRUD queries against R18.dev derived_actress tables."""

from __future__ import annotations

import json
import re
import sqlite3
from typing import Any

from sqlalchemy.exc import SQLAlchemyError

from ..schemas.r18_schema import (
    ACTRESS_ID_COL,
    ACTRESS_IMAGE_URL_COL,
    ACTRESS_NAME_KANA_COL,
    ACTRESS_NAME_KANJI_COL,
    ACTRESS_NAME_ROMAJI_COL,
    ACTRESS_TABLE,
    DMM_ACTRESS_IMAGE_BASE,
    DMM_PICS_BASE,
    VIDEO_ACTRESS_ACTRESS_ID_COL,
    VIDEO_ACTRESS_CONTENT_ID_COL,
    VIDEO_ACTRESS_ORDINALITY_COL,
    VIDEO_ACTRESS_RELEASE_DATE_COL,
    VIDEO_ACTRESS_TABLE,
    VIDEO_CONTENT_ID_COL,
    VIDEO_DVD_ID_COL,
    VIDEO_JACKET_URL_COL,
    VIDEO_RELEASE_DATE_COL,
    VIDEO_TABLE,
    VIDEO_TITLE_EN_COL,
    VIDEO_TITLE_JA_COL,
)
from ..schemas.r18_db import get_r18_connection
from ..schemas.actress_work_state import ActressWorkStateRecord
from ..schemas.db_helper import SessionLocal

_VIDEO_JACKET_COLUMN: bool | None = None


def _display_name(row: dict[str, Any]) -> str:
    """Pick the best display name from an actress row."""
    for key in (ACTRESS_NAME_ROMAJI_COL, ACTRESS_NAME_KANJI_COL, ACTRESS_NAME_KANA_COL):
        value = row.get(key)
        if value:
            return str(value)
    return f"Actress #{row.get(ACTRESS_ID_COL, '?')}"


def resolve_actress_image_url(raw: str | None) -> str | None:
    """Turn r18.dev image slugs into loadable DMM actress portrait URLs.

    The dump stores bare filenames (e.g. ``yuihara_ai`` or ``matuo_rie.jpg``),
    not absolute URLs. Legacy rows may still reference ``pics.r18.com``.

    Args:
        raw: Value from ``derived_actress.image_url``.

    Returns:
        Absolute HTTPS URL, or None when no usable image is available.
    """
    if raw is None:
        return None
    value = str(raw).strip()
    if not value or value.lower() in {"null", "none", "\\n"}:
        return None
    if value.startswith(("http://", "https://")):
        return value.replace("pics.r18.com", "pics.dmm.co.jp")
    if value.startswith("//"):
        return ("https:" + value).replace("pics.r18.com", "pics.dmm.co.jp")
    slug = value if value.lower().endswith(".jpg") else f"{value}.jpg"
    return f"{DMM_ACTRESS_IMAGE_BASE}{slug}"


def _normalize_dmm_image_url(value: str) -> str:
    """Convert dump image fields into absolute DMM HTTPS URLs.

    The r18.dev dump stores jacket paths as relative slugs such as
    ``digital/video/foo/foopl`` rather than full URLs.

    Args:
        value: Raw ``jacket_full_url`` or similar field from ``derived_video``.

    Returns:
        Absolute HTTPS image URL.
    """
    cleaned = value.strip()
    if cleaned.startswith(("http://", "https://")):
        return cleaned.replace("pics.r18.com", "pics.dmm.co.jp")
    if cleaned.startswith("//"):
        return ("https:" + cleaned).replace("pics.r18.com", "pics.dmm.co.jp")
    path = cleaned.lstrip("/")
    if not path.lower().endswith((".jpg", ".jpeg", ".png", ".webp")):
        path = f"{path}.jpg"
    return f"{DMM_PICS_BASE}{path}"


def resolve_work_image_url(
    content_id: str | None,
    jacket_raw: str | None = None,
    dvd_id: str | None = None,
) -> str | None:
    """Resolve a work cover image URL from dump fields or DMM URL patterns.

    Args:
        content_id: R18 content identifier (e.g. ``h_237nacr895``).
        jacket_raw: Optional ``jacket_full_url`` value from ``derived_video``.
        dvd_id: Optional DVD catalog id for mono releases.

    Returns:
        Absolute HTTPS jacket URL, or None when no image can be resolved.
    """
    if jacket_raw is not None:
        value = str(jacket_raw).strip()
        if value and value.lower() not in {"null", "none", "\\n"}:
            return _normalize_dmm_image_url(value)

    cid = (content_id or "").strip()
    if cid:
        return _normalize_dmm_image_url(f"digital/video/{cid}/{cid}pl")

    dvd = (dvd_id or "").strip()
    if dvd:
        slug = re.sub(r"[^a-z0-9]", "", dvd.lower())
        if slug:
            return _normalize_dmm_image_url(f"mono/movie/{slug}/{slug}pl")

    return None


def _video_table_has_jacket_column(conn: sqlite3.Connection) -> bool:
    """Return whether ``derived_video`` includes ``jacket_full_url``."""
    global _VIDEO_JACKET_COLUMN
    if _VIDEO_JACKET_COLUMN is not None:
        return _VIDEO_JACKET_COLUMN
    rows = conn.execute(f"PRAGMA table_info({VIDEO_TABLE})").fetchall()
    _VIDEO_JACKET_COLUMN = any(row[1] == VIDEO_JACKET_URL_COL for row in rows)
    return _VIDEO_JACKET_COLUMN


def _work_row_to_dict(row: sqlite3.Row | tuple[Any, ...], has_jacket: bool) -> dict[str, Any]:
    """Map a joined video/actress row into an API work payload."""
    content_id = str(row[0])
    dvd_id = str(row[1]) if row[1] else None
    title_en = str(row[2]) if row[2] else None
    title_ja = str(row[3]) if row[3] else None
    release = row[4]
    jacket_raw = str(row[5]) if has_jacket and row[5] else None
    video_code = _format_work_content_id(dvd_id) if dvd_id else _format_work_content_id(content_id)
    return {
        "content_id": content_id,
        "dvd_id": dvd_id,
        "video_code": video_code,
        "title_en": title_en,
        "title_ja": title_ja,
        "release_date": str(release) if release else None,
        "image_url": resolve_work_image_url(content_id, jacket_raw, dvd_id),
    }


def _opened_content_ids() -> set[str]:
    db = SessionLocal()
    try:
        rows = db.query(ActressWorkStateRecord.content_id).filter(ActressWorkStateRecord.is_opened == True).all()  # noqa: E712
        return {str(row[0]) for row in rows if row[0]}
    except SQLAlchemyError:
        return set()
    finally:
        db.close()


def _opened_sites_by_content_id() -> dict[str, list[str]]:
    db = SessionLocal()
    try:
        rows = db.query(ActressWorkStateRecord).all()
        result = {}
        for row in rows:
            try:
                sites = json.loads(row.opened_sites or "[]")
            except (TypeError, ValueError):
                sites = []
            result[str(row.content_id)] = [str(site) for site in sites if site]
        return result
    except SQLAlchemyError:
        return {}
    finally:
        db.close()


def mark_work_opened(content_id: str, site: str) -> None:
    """Persist that an actress work has been opened."""
    if not content_id:
        return
    db = SessionLocal()
    try:
        row = db.query(ActressWorkStateRecord).filter(ActressWorkStateRecord.content_id == content_id).first()
        if row is None:
            row = ActressWorkStateRecord(content_id=content_id, is_opened=True, opened_sites=json.dumps([site] if site else []))
            db.add(row)
        else:
            row.is_opened = True
            sites = json.loads(row.opened_sites or "[]")
            if site and site not in sites:
                row.opened_sites = json.dumps([*sites, site])
        db.commit()
    finally:
        db.close()


def mark_works_opened(content_ids: list[str], sites: list[str]) -> int:
    """Persist that multiple actress works have been opened."""
    unique_content_ids = list(dict.fromkeys(content_id for content_id in content_ids if content_id))
    if not unique_content_ids:
        return 0

    db = SessionLocal()
    try:
        existing_rows = db.query(ActressWorkStateRecord).filter(ActressWorkStateRecord.content_id.in_(unique_content_ids)).all()
        existing_by_content_id = {row.content_id: row for row in existing_rows}
        for content_id in unique_content_ids:
            row = existing_by_content_id.get(content_id)
            if row is None:
                db.add(ActressWorkStateRecord(content_id=content_id, is_opened=True, opened_sites=json.dumps(sites)))
            else:
                row.is_opened = True
                current = json.loads(row.opened_sites or "[]")
                row.opened_sites = json.dumps(list(dict.fromkeys([*current, *sites])))
        db.commit()
        return len(unique_content_ids)
    finally:
        db.close()


def _format_work_content_id(content_id: str | None) -> str:
    """Normalize a raw content_id to the display form used for duplicate checks."""
    if not content_id:
        return ""

    stripped = re.sub(r"^\d+", "", content_id)
    had_leading_digits = stripped != content_id
    match = re.match(r"^([a-zA-Z]+)(\d+)$", stripped)
    if not match:
        return stripped.upper() if had_leading_digits else content_id
    return f"{match.group(1).upper()}-{str(int(match.group(2))).zfill(3)}"


def _dedupe_works_by_formatted_content_id(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Keep only the first work for each normalized content_id."""
    seen: set[str] = set()
    deduped: list[dict[str, Any]] = []

    for row in rows:
        dedupe_key = _format_work_content_id(row.get("content_id"))
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        deduped.append(row)

    return deduped


def _normalize_work_search_value(value: str | None) -> str:
    return (value or "").replace("-", "").strip().lower()


def _canonical_work_code(value: str | None) -> str:
    normalized = _normalize_work_search_value(value)
    match = re.match(r"^([a-z]+)(\d+)$", normalized)
    if not match:
        return normalized
    return f"{match.group(1)}{int(match.group(2))}"


def _work_matches_search(row: dict[str, Any], search: str) -> bool:
    search_norm = _normalize_work_search_value(search)
    if not search_norm:
        return True
    search_canonical = _canonical_work_code(search)

    values = [
        row.get("content_id"),
        row.get("dvd_id"),
        row.get("video_code"),
    ]
    return any(
        search_norm in _normalize_work_search_value(str(value))
        or search_canonical in _canonical_work_code(str(value))
        for value in values
        if value
    )


_WORKS_SORT_COLUMNS = {
    "date": f"MAX(va.{VIDEO_ACTRESS_RELEASE_DATE_COL})",
    "id": f"v.{VIDEO_CONTENT_ID_COL}",
    "title": f"v.{VIDEO_TITLE_EN_COL}",
}


def _works_select_sql(
    has_jacket: bool,
    sort_by: str = "date",
    sort_dir: str = "desc",
    search: str = "",
    has_image: bool | None = None,
    release_year: int | None = None,
    content_ids_include: frozenset[str] | None = None,
    content_ids_exclude: frozenset[str] | None = None,
) -> tuple[str, str, list]:
    """Build SELECT + ORDER BY for actress work queries. Returns (sql, where_clause_body, extra_params)."""
    jacket_col = f", v.{VIDEO_JACKET_URL_COL} AS jacket_url" if has_jacket else ""
    order_col = _WORKS_SORT_COLUMNS.get(sort_by, _WORKS_SORT_COLUMNS["date"])
    direction = "ASC" if sort_dir == "asc" else "DESC"

    clauses: list[str] = [f"va.{VIDEO_ACTRESS_ACTRESS_ID_COL} = ?"]
    extra_params: list = []

    if search:
        clauses.append(f"(v.{VIDEO_DVD_ID_COL} LIKE ? OR v.{VIDEO_CONTENT_ID_COL} LIKE ?)")
        extra_params.extend([f"%{search}%", f"%{search}%"])

    if has_image is True:
        if has_jacket:
            clauses.append(f"(v.{VIDEO_JACKET_URL_COL} IS NOT NULL AND v.{VIDEO_JACKET_URL_COL} != '')")
        else:
            clauses.append("1=0")  # no jacket column → no works can satisfy has_image=True
    elif has_image is False:
        if has_jacket:
            clauses.append(f"(v.{VIDEO_JACKET_URL_COL} IS NULL OR v.{VIDEO_JACKET_URL_COL} = '')")

    if release_year is not None:
        clauses.append(f"va.{VIDEO_ACTRESS_RELEASE_DATE_COL} LIKE ?")
        extra_params.append(f"{release_year}%")

    if content_ids_include is not None:
        if not content_ids_include:
            clauses.append("1=0")  # empty set → no results
        else:
            placeholders = ",".join("?" * len(content_ids_include))
            clauses.append(f"v.{VIDEO_CONTENT_ID_COL} IN ({placeholders})")
            extra_params.extend(sorted(content_ids_include))

    if content_ids_exclude is not None and content_ids_exclude:
        placeholders = ",".join("?" * len(content_ids_exclude))
        clauses.append(f"v.{VIDEO_CONTENT_ID_COL} NOT IN ({placeholders})")
        extra_params.extend(sorted(content_ids_exclude))

    where_clause_body = " AND ".join(clauses)
    sql = f"""
        SELECT v.{VIDEO_CONTENT_ID_COL}, v.{VIDEO_DVD_ID_COL},
               v.{VIDEO_TITLE_EN_COL}, v.{VIDEO_TITLE_JA_COL},
               MAX(va.{VIDEO_ACTRESS_RELEASE_DATE_COL}) AS release_date{jacket_col}
        FROM {VIDEO_ACTRESS_TABLE} va
        JOIN {VIDEO_TABLE} v ON v.{VIDEO_CONTENT_ID_COL} = va.{VIDEO_ACTRESS_CONTENT_ID_COL}
        WHERE {where_clause_body}
        GROUP BY v.{VIDEO_CONTENT_ID_COL}
        ORDER BY CASE WHEN {order_col} IS NULL THEN 1 ELSE 0 END, {order_col} {direction}
    """
    return sql, where_clause_body, extra_params


def _row_to_summary(row: sqlite3.Row | tuple[Any, ...], columns: list[str]) -> dict[str, Any]:
    data = dict(zip(columns, row, strict=True))
    data["display_name"] = _display_name(data)
    for key in (ACTRESS_NAME_ROMAJI_COL, ACTRESS_NAME_KANJI_COL, ACTRESS_NAME_KANA_COL):
        if key in data and data[key] is not None:
            data[key] = str(data[key])
    if ACTRESS_IMAGE_URL_COL in data:
        data[ACTRESS_IMAGE_URL_COL] = resolve_actress_image_url(data.get(ACTRESS_IMAGE_URL_COL))
    if data.get(ACTRESS_ID_COL) is not None:
        data[ACTRESS_ID_COL] = int(data[ACTRESS_ID_COL])
    return data


def search_actresses(q: str, skip: int, limit: int) -> tuple[list[dict[str, Any]], int]:
    """Search actresses by romaji, kanji, or kana name.

    Args:
        q: Search term (empty returns all, paginated).
        skip: Offset for pagination.
        limit: Maximum rows to return.

    Returns:
        Tuple of (result rows as dicts, total matching count).
    """
    select_cols = [
        ACTRESS_ID_COL,
        ACTRESS_NAME_ROMAJI_COL,
        ACTRESS_NAME_KANJI_COL,
        ACTRESS_NAME_KANA_COL,
        ACTRESS_IMAGE_URL_COL,
    ]
    col_list = ", ".join(select_cols)
    order_expr = f"COALESCE({ACTRESS_NAME_ROMAJI_COL}, {ACTRESS_NAME_KANJI_COL}, {ACTRESS_NAME_KANA_COL})"

    conn = get_r18_connection()
    try:
        if q.strip():
            pattern = f"%{q.strip()}%"
            where = f"""
                COALESCE({ACTRESS_NAME_ROMAJI_COL}, '') LIKE ? COLLATE NOCASE
                OR COALESCE({ACTRESS_NAME_KANJI_COL}, '') LIKE ?
                OR COALESCE({ACTRESS_NAME_KANA_COL}, '') LIKE ?
            """
            params: tuple[Any, ...] = (pattern, pattern, pattern)
            total = int(
                conn.execute(
                    f"SELECT COUNT(*) FROM {ACTRESS_TABLE} WHERE {where}",
                    params,
                ).fetchone()[0]
            )
            rows = conn.execute(
                f"""
                SELECT {col_list} FROM {ACTRESS_TABLE}
                WHERE {where}
                ORDER BY {order_expr}
                LIMIT ? OFFSET ?
                """,
                (*params, limit, skip),
            ).fetchall()
        else:
            total = int(conn.execute(f"SELECT COUNT(*) FROM {ACTRESS_TABLE}").fetchone()[0])
            rows = conn.execute(
                f"""
                SELECT {col_list} FROM {ACTRESS_TABLE}
                ORDER BY {order_expr}
                LIMIT ? OFFSET ?
                """,
                (limit, skip),
            ).fetchall()
        return [_row_to_summary(r, select_cols) for r in rows], total
    finally:
        conn.close()


def get_actress(actress_id: int) -> dict[str, Any] | None:
    """Fetch one actress with work count and recent works.

    Args:
        actress_id: Primary key in derived_actress.

    Returns:
        Detail dict, or None if not found.
    """
    select_cols = [
        ACTRESS_ID_COL,
        ACTRESS_NAME_ROMAJI_COL,
        ACTRESS_NAME_KANJI_COL,
        ACTRESS_NAME_KANA_COL,
        ACTRESS_IMAGE_URL_COL,
    ]
    col_list = ", ".join(select_cols)

    conn = get_r18_connection()
    try:
        row = conn.execute(
            f"SELECT {col_list} FROM {ACTRESS_TABLE} WHERE {ACTRESS_ID_COL} = ?",
            (actress_id,),
        ).fetchone()
        if not row:
            return None
        detail = _row_to_summary(row, select_cols)

        detail["work_count"] = int(
            conn.execute(
                f"""
                SELECT COUNT(DISTINCT {VIDEO_ACTRESS_CONTENT_ID_COL})
                FROM {VIDEO_ACTRESS_TABLE}
                WHERE {VIDEO_ACTRESS_ACTRESS_ID_COL} = ?
                """,
                (actress_id,),
            ).fetchone()[0]
        )

        has_jacket = _video_table_has_jacket_column(conn)
        base_sql, _, extra_params = _works_select_sql(has_jacket)
        work_rows = conn.execute(
            base_sql + " LIMIT 20",
            (actress_id, *extra_params),
        ).fetchall()
        opened_ids = _opened_content_ids()
        opened_sites = _opened_sites_by_content_id()
        detail["recent_works"] = [
            row | {
                "is_opened": row["content_id"] in opened_ids,
                "opened_sites": opened_sites.get(row["content_id"], []),
            }
            for row in (_work_row_to_dict(work_row, has_jacket) for work_row in work_rows)
        ]
        return detail
    except sqlite3.Error:
        return None
    finally:
        conn.close()


def get_all_actress_content_ids(actress_id: int) -> list[tuple[str, str | None]]:
    """Return all (content_id, dvd_id) pairs for an actress from R18 DB.

    Args:
        actress_id: Primary key in derived_actress.

    Returns:
        List of (content_id, dvd_id) tuples. dvd_id may be None.
    """
    conn = get_r18_connection()
    try:
        rows = conn.execute(
            f"""
            SELECT DISTINCT v.{VIDEO_CONTENT_ID_COL}, v.{VIDEO_DVD_ID_COL}
            FROM {VIDEO_ACTRESS_TABLE} va
            JOIN {VIDEO_TABLE} v ON v.{VIDEO_CONTENT_ID_COL} = va.{VIDEO_ACTRESS_CONTENT_ID_COL}
            WHERE va.{VIDEO_ACTRESS_ACTRESS_ID_COL} = ?
            """,
            (actress_id,),
        ).fetchall()
        return [(str(r[0]), str(r[1]) if r[1] else None) for r in rows]
    finally:
        conn.close()


def get_actress_names_by_content_id(content_id: str) -> list[str]:
    """Return ordered display names for actresses linked to a work content_id."""
    conn = get_r18_connection()
    try:
        rows = conn.execute(
            f"""
            SELECT a.{ACTRESS_NAME_ROMAJI_COL}, a.{ACTRESS_NAME_KANJI_COL}, a.{ACTRESS_NAME_KANA_COL}
            FROM {VIDEO_ACTRESS_TABLE} va
            JOIN {ACTRESS_TABLE} a ON a.{ACTRESS_ID_COL} = va.{VIDEO_ACTRESS_ACTRESS_ID_COL}
            WHERE va.{VIDEO_ACTRESS_CONTENT_ID_COL} = ?
            ORDER BY va.{VIDEO_ACTRESS_ORDINALITY_COL} ASC, a.{ACTRESS_ID_COL} ASC
            """,
            (content_id,),
        ).fetchall()
        names: list[str] = []
        for row in rows:
            for value in row:
                if value:
                    name = str(value).strip()
                    if name and name not in names:
                        names.append(name)
                    break
        return names
    except sqlite3.Error:
        return []
    finally:
        conn.close()


def get_actress_ids_by_content_id(content_id: str) -> list[int]:
    """Return ordered actress ids linked to a work content_id."""
    conn = get_r18_connection()
    try:
        rows = conn.execute(
            f"""
            SELECT va.{VIDEO_ACTRESS_ACTRESS_ID_COL}
            FROM {VIDEO_ACTRESS_TABLE} va
            WHERE va.{VIDEO_ACTRESS_CONTENT_ID_COL} = ?
            ORDER BY va.{VIDEO_ACTRESS_ORDINALITY_COL} ASC, va.{VIDEO_ACTRESS_ACTRESS_ID_COL} ASC
            """,
            (content_id,),
        ).fetchall()
        ids: list[int] = []
        for row in rows:
            actress_id = int(row[0])
            if actress_id not in ids:
                ids.append(actress_id)
        return ids
    except sqlite3.Error:
        return []
    finally:
        conn.close()


def list_actress_works(
    actress_id: int,
    skip: int,
    limit: int,
    sort_by: str = "date",
    sort_dir: str = "desc",
    search: str = "",
    has_image: bool | None = None,
    release_year: int | None = None,
    opened: bool | None = None,
    content_ids_include: frozenset[str] | None = None,
    content_ids_exclude: frozenset[str] | None = None,
) -> tuple[list[dict[str, Any]], int]:
    """List paginated works for one actress with optional filters.

    Args:
        actress_id: Primary key in derived_actress.
        skip: Offset for pagination.
        limit: Maximum rows to return.
        sort_by: One of 'date', 'id', 'title'.
        sort_dir: 'asc' or 'desc'.
        search: Filter by dvd_id, content_id, or formatted video_code substring (hyphens ignored).
        has_image: True = only works with jacket image; False = without; None = all.
        release_year: 4-digit year to filter by (matched as prefix on release_date).
        content_ids_include: If set, only return works whose content_id is in this set.
        content_ids_exclude: If set, exclude works whose content_id is in this set.

    Returns:
        Tuple of (work dicts, total matching count).
    """
    conn = get_r18_connection()
    try:
        exists = conn.execute(
            f"SELECT 1 FROM {ACTRESS_TABLE} WHERE {ACTRESS_ID_COL} = ?",
            (actress_id,),
        ).fetchone()
        if not exists:
            return [], 0

        has_jacket = _video_table_has_jacket_column(conn)
        base_sql, _where_clause_body, extra_params = _works_select_sql(
            has_jacket, sort_by, sort_dir, "",
            has_image, release_year, content_ids_include, content_ids_exclude,
        )
        opened_ids = _opened_content_ids()
        opened_sites = _opened_sites_by_content_id()

        # Keep normalization/search semantics in one place while allowing SQLite
        # to deduplicate, count, and paginate before rows cross into Python.
        conn.create_function("format_work_id", 1, _format_work_content_id, deterministic=True)
        conn.create_function(
            "work_matches_search",
            3,
            lambda content_id, dvd_id, query: int(_work_matches_search({
                "content_id": content_id,
                "dvd_id": dvd_id,
                "video_code": _format_work_content_id(dvd_id or content_id),
            }, query or "")),
            deterministic=True,
        )
        conn.create_function("work_is_opened", 1, lambda content_id: int(str(content_id) in opened_ids))

        order_alias = {
            "date": "release_date",
            "id": "content_id",
            "title": "title_en",
        }.get(sort_by, "release_date")
        direction = "ASC" if sort_dir == "asc" else "DESC"
        jacket_projection = ", jacket_url" if has_jacket else ""
        # _works_select_sql already validates and interpolates only internal table/
        # column names. Removing its final ORDER BY avoids an unnecessary sort in
        # the grouped CTE; final ordering happens after normalized deduplication.
        grouped_sql = base_sql.rsplit("ORDER BY", 1)[0]
        cte = f"""
            WITH grouped AS (
                {grouped_sql}
            ), ranked AS (
                SELECT *,
                       ROW_NUMBER() OVER (
                           PARTITION BY format_work_id(content_id)
                           ORDER BY CASE WHEN {order_alias} IS NULL THEN 1 ELSE 0 END,
                                    {order_alias} {direction}
                       ) AS duplicate_rank
                FROM grouped
            ), filtered AS (
                SELECT * FROM ranked
                WHERE duplicate_rank = 1
                  AND instr(format_work_id(COALESCE(NULLIF(dvd_id, ''), content_id)), '-') > 0
                  AND work_matches_search(content_id, dvd_id, ?) = 1
                  AND (? IS NULL OR work_is_opened(content_id) = ?)
            )
        """
        params = (actress_id, *extra_params, search, opened, opened)
        work_rows = conn.execute(
            f"""
            {cte}
            SELECT content_id, dvd_id, title_en, title_ja, release_date{jacket_projection},
                   COUNT(*) OVER () AS total_count
            FROM filtered
            ORDER BY CASE WHEN {order_alias} IS NULL THEN 1 ELSE 0 END,
                     {order_alias} {direction}
            LIMIT ? OFFSET ?
            """,
            (*params, limit, skip),
        ).fetchall()
        total = int(work_rows[0][-1]) if work_rows else int(
            conn.execute(f"{cte} SELECT COUNT(*) FROM filtered", params).fetchone()[0]
        )
        rows = [_work_row_to_dict(row, has_jacket) for row in work_rows]
        return [row | {"is_opened": row["content_id"] in opened_ids, "opened_sites": opened_sites.get(row["content_id"], [])} for row in rows], total
    finally:
        conn.close()


def list_all_actress_works(
    actress_id: int,
    sort_by: str = "date",
    sort_dir: str = "desc",
    search: str = "",
    has_image: bool | None = None,
    release_year: int | None = None,
    opened: bool | None = None,
    content_ids_include: frozenset[str] | None = None,
    content_ids_exclude: frozenset[str] | None = None,
) -> list[dict[str, Any]]:
    """Return all matching actress works without pagination."""
    rows, _total = list_actress_works(
        actress_id,
        0,
        1_000_000,
        sort_by,
        sort_dir,
        search,
        has_image,
        release_year,
        opened,
        content_ids_include,
        content_ids_exclude,
    )
    return rows
