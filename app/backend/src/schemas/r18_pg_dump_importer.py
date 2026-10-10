"""Import r18.dev PostgreSQL plain-text dumps into SQLite.

The weekly r18.dev archives are ``pg_dump`` output using ``COPY ... FROM stdin``
blocks. This module streams those dumps without requiring PostgreSQL.
"""

from __future__ import annotations

import gzip
import logging
import re
import sqlite3
from pathlib import Path
from typing import TextIO

logger = logging.getLogger(__name__)

_BATCH_SIZE = 5_000
_CREATE_TABLE_RE = re.compile(
    r"^CREATE TABLE public\.(?P<table>[a-z_]+)\s*\(",
    re.IGNORECASE,
)
_COPY_RE = re.compile(
    r"^COPY public\.(?P<table>[a-z_]+)\s*\((?P<columns>[^)]+)\)\s+FROM stdin;\s*$",
    re.IGNORECASE,
)


def _unescape_copy_value(text: str) -> str:
    """Unescape PostgreSQL COPY text-format field bytes."""
    out: list[str] = []
    i = 0
    while i < len(text):
        if text[i] == "\\" and i + 1 < len(text):
            code = text[i + 1]
            if code == "b":
                out.append("\b")
            elif code == "f":
                out.append("\f")
            elif code == "n":
                out.append("\n")
            elif code == "r":
                out.append("\r")
            elif code == "t":
                out.append("\t")
            elif code == "v":
                out.append("\v")
            elif code == "\\":
                out.append("\\")
            elif code.isdigit():
                oct_digits = code
                j = i + 2
                while j < len(text) and len(oct_digits) < 3 and text[j].isdigit():
                    oct_digits += text[j]
                    j += 1
                out.append(chr(int(oct_digits, 8)))
                i = j
                continue
            else:
                out.append(code)
            i += 2
            continue
        out.append(text[i])
        i += 1
    return "".join(out)


def _split_copy_row(row: str) -> list[str | None]:
    """Split one COPY row into fields, honoring PostgreSQL text escaping."""
    fields: list[str | None] = []
    buf: list[str] = []
    i = 0
    while i < len(row):
        ch = row[i]
        if ch == "\t":
            raw = "".join(buf)
            buf = []
            fields.append(None if raw == "\\N" else _unescape_copy_value(raw))
            i += 1
            continue
        if ch == "\\" and i + 1 < len(row):
            buf.append(ch)
            buf.append(row[i + 1])
            i += 2
            continue
        buf.append(ch)
        i += 1
    raw = "".join(buf)
    fields.append(None if raw == "\\N" else _unescape_copy_value(raw))
    return fields


def _iter_copy_rows(stream: TextIO):
    """Yield parsed COPY rows until the ``\\``.`` terminator."""
    while True:
        line = stream.readline()
        if not line:
            raise RuntimeError("Unexpected EOF inside COPY data block")
        row = line.rstrip("\n\r")
        if row == "\\.":
            return
        yield _split_copy_row(row)


def _convert_pg_create_table(ddl: str) -> str:
    """Convert a PostgreSQL CREATE TABLE statement to SQLite DDL."""
    sql = ddl.replace("public.", "")
    sql = re.sub(r"\bcharacter varying\b", "TEXT", sql, flags=re.IGNORECASE)
    sql = re.sub(r"\btimestamp with time zone\b", "TEXT", sql, flags=re.IGNORECASE)
    sql = re.sub(r"\btimestamp without time zone\b", "TEXT", sql, flags=re.IGNORECASE)
    sql = re.sub(r"\bdate\b", "TEXT", sql, flags=re.IGNORECASE)
    sql = re.sub(r"\binteger\b", "INTEGER", sql, flags=re.IGNORECASE)
    sql = re.sub(
        r"\s+DEFAULT CURRENT_TIMESTAMP",
        "",
        sql,
        flags=re.IGNORECASE,
    )
    return sql.strip()


def _apply_import_pragmas(conn: sqlite3.Connection) -> None:
    """Tune SQLite for bulk ingest."""
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=OFF")
    conn.execute("PRAGMA temp_store=MEMORY")
    conn.execute("PRAGMA cache_size=-64000")


def _finalize_import(conn: sqlite3.Connection) -> None:
    """Restore safer settings and add lookup indexes used by the app."""
    conn.execute("PRAGMA synchronous=NORMAL")

    def _has_table(table: str) -> bool:
        row = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
            (table,),
        ).fetchone()
        return row is not None

    def _has_column(table: str, column: str) -> bool:
        rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
        return any(row[1] == column for row in rows)

    index_specs = [
        ("derived_actress", "name_romaji", "idx_derived_actress_name_romaji"),
        ("derived_actress", "name_kanji", "idx_derived_actress_name_kanji"),
        ("derived_actress", "name_kana", "idx_derived_actress_name_kana"),
        ("derived_video_actress", "actress_id", "idx_derived_video_actress_actress_id"),
        (
            "derived_video_actress",
            "actress_id, content_id, release_date",
            "idx_derived_video_actress_actress_content_release",
        ),
        ("derived_video_actress", "release_date", "idx_derived_video_actress_release_date"),
        ("derived_video", "content_id", "idx_derived_video_content_id"),
        ("derived_video", "title_en", "idx_derived_video_title_en"),
    ]
    for table, column, index_name in index_specs:
        if _has_table(table) and all(_has_column(table, name.strip()) for name in column.split(",")):
            conn.execute(
                f"CREATE INDEX IF NOT EXISTS {index_name} ON {table}({column})"
            )

    conn.commit()


def _flush_batch(
    conn: sqlite3.Connection,
    table: str,
    columns: list[str],
    batch: list[tuple[str | None, ...]],
) -> None:
    """Insert a batch of COPY rows into SQLite."""
    if not batch:
        return
    col_sql = ", ".join(columns)
    placeholders = ", ".join("?" for _ in columns)
    conn.executemany(
        f"INSERT INTO {table} ({col_sql}) VALUES ({placeholders})",
        batch,
    )
    batch.clear()


def import_pg_dump_sql_gz(sql_gz_path: Path, dest_db: Path) -> None:
    """Replace ``dest_db`` by importing a gzipped r18.dev PostgreSQL dump.

    Args:
        sql_gz_path: Path to the ``.sql.gz`` dump file.
        dest_db: Target SQLite database path.

    Raises:
        FileNotFoundError: If the dump file is missing.
        RuntimeError: If the dump cannot be parsed or imported.
    """
    if not sql_gz_path.exists():
        raise FileNotFoundError(str(sql_gz_path))

    dest_db.parent.mkdir(parents=True, exist_ok=True)
    if dest_db.exists():
        dest_db.unlink()

    conn = sqlite3.connect(dest_db)
    try:
        _apply_import_pragmas(conn)
        create_buffer: list[str] | None = None
        copy_table: str | None = None
        copy_columns: list[str] | None = None
        copy_batch: list[tuple[str | None, ...]] = []

        with gzip.open(sql_gz_path, "rt", encoding="utf-8", errors="replace") as stream:
            while True:
                line = stream.readline()
                if not line:
                    break

                if create_buffer is not None:
                    create_buffer.append(line)
                    if line.rstrip().endswith(");"):
                        ddl = _convert_pg_create_table("".join(create_buffer))
                        conn.execute(ddl)
                        create_buffer = None
                    continue

                if copy_table is not None:
                    row = line.rstrip("\n\r")
                    if row == "\\.":
                        assert copy_columns is not None
                        _flush_batch(conn, copy_table, copy_columns, copy_batch)
                        copy_table = None
                        copy_columns = None
                        conn.commit()
                        continue
                    assert copy_columns is not None
                    values = _split_copy_row(row)
                    if len(values) != len(copy_columns):
                        raise RuntimeError(
                            f"Column count mismatch importing {copy_table}: "
                            f"expected {len(copy_columns)}, got {len(values)}"
                        )
                    copy_batch.append(tuple(values))
                    if len(copy_batch) >= _BATCH_SIZE:
                        _flush_batch(conn, copy_table, copy_columns, copy_batch)
                    continue

                create_match = _CREATE_TABLE_RE.match(line)
                if create_match:
                    create_buffer = [line]
                    if line.rstrip().endswith(");"):
                        ddl = _convert_pg_create_table("".join(create_buffer))
                        conn.execute(ddl)
                        create_buffer = None
                    continue

                copy_match = _COPY_RE.match(line)
                if copy_match:
                    copy_table = copy_match.group("table")
                    copy_columns = [
                        col.strip().strip('"')
                        for col in copy_match.group("columns").split(",")
                    ]
                    copy_batch = []
                    continue

        if create_buffer is not None or copy_table is not None:
            raise RuntimeError("Dump ended before table or COPY block completed")

        _finalize_import(conn)
    except Exception:
        conn.close()
        if dest_db.exists():
            dest_db.unlink()
        raise
    else:
        conn.close()

    logger.info("Imported R18 dump into SQLite at %s", dest_db)
