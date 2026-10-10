"""Tests for R18.dev schema helpers and CRUD (no live database required)."""

import gzip
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from src.crud import r18_actress
from src.schemas.r18_schema import ACTRESS_TABLE, VIDEO_ACTRESS_TABLE, VIDEO_TABLE


def test_schema_constants():
    """R18 schema map uses derived_* table names from official dumps."""
    assert ACTRESS_TABLE == "derived_actress"
    assert VIDEO_ACTRESS_TABLE == "derived_video_actress"
    assert VIDEO_TABLE == "derived_video"


def test_display_name_prefers_romaji():
    """Display name should prefer romaji over kanji/kana."""
    row = {
        "id": 1,
        "name_romaji": "Yui Hatano",
        "name_kanji": "波多野結衣",
        "name_kana": "はたのゆい",
    }
    assert r18_actress._display_name(row) == "Yui Hatano"


def test_display_name_fallback():
    """Display name falls back to kanji then kana."""
    assert r18_actress._display_name({"id": 2, "name_kanji": "結衣"}) == "結衣"
    assert r18_actress._display_name({"id": 3, "name_kana": "ゆい"}) == "ゆい"
    assert r18_actress._display_name({"id": 4}) == "Actress #4"


def test_resolve_actress_image_url_slug():
    """Bare slugs from r18.dev dumps resolve to DMM portrait URLs."""
    assert (
        r18_actress.resolve_actress_image_url("yuihara_ai")
        == "https://pics.dmm.co.jp/mono/actjpgs/yuihara_ai.jpg"
    )
    assert (
        r18_actress.resolve_actress_image_url("matuo_rie.jpg")
        == "https://pics.dmm.co.jp/mono/actjpgs/matuo_rie.jpg"
    )


def test_resolve_actress_image_url_legacy_and_empty():
    """Legacy absolute URLs are rewritten; empty placeholders become None."""
    assert (
        r18_actress.resolve_actress_image_url("https://pics.r18.com/mono/actjpgs/a.jpg")
        == "https://pics.dmm.co.jp/mono/actjpgs/a.jpg"
    )
    assert r18_actress.resolve_actress_image_url("null") is None
    assert r18_actress.resolve_actress_image_url(None) is None
    assert r18_actress.resolve_actress_image_url("") is None


def test_resolve_work_image_url_digital_and_mono():
    """Work covers resolve from dump-relative paths, absolute URLs, or content_id."""
    assert (
        r18_actress.resolve_work_image_url(
            "100tv00031",
            jacket_raw="digital/video/100tv00031/100tv00031pl",
        )
        == "https://pics.dmm.co.jp/digital/video/100tv00031/100tv00031pl.jpg"
    )
    assert (
        r18_actress.resolve_work_image_url(
            "104spkd03",
            jacket_raw="mono/movie/104spkd03/104spkd03pl",
        )
        == "https://pics.dmm.co.jp/mono/movie/104spkd03/104spkd03pl.jpg"
    )
    assert (
        r18_actress.resolve_work_image_url("h_1498doe00172")
        == "https://pics.dmm.co.jp/digital/video/h_1498doe00172/h_1498doe00172pl.jpg"
    )
    assert (
        r18_actress.resolve_work_image_url(None, dvd_id="ABC-123")
        == "https://pics.dmm.co.jp/mono/movie/abc123/abc123pl.jpg"
    )
    assert (
        r18_actress.resolve_work_image_url(
            "h_237nacr895",
            jacket_raw="https://pics.r18.com/digital/video/example.jpg",
        )
        == "https://pics.dmm.co.jp/digital/video/example.jpg"
    )


def test_list_actress_works_pagination(tmp_path, monkeypatch):
    """Paginated works query returns rows and total count."""
    import sqlite3

    from src.schemas import r18_db

    db_path = tmp_path / "r18.db"
    monkeypatch.setattr(r18_db, "R18_DB_PATH", db_path)
    r18_actress._VIDEO_JACKET_COLUMN = None

    conn = sqlite3.connect(db_path)
    conn.executescript(
        """
        CREATE TABLE derived_actress (id INTEGER PRIMARY KEY, name_romaji TEXT);
        CREATE TABLE derived_video (
            content_id TEXT PRIMARY KEY,
            dvd_id TEXT,
            title_en TEXT,
            title_ja TEXT,
            release_date TEXT
        );
        CREATE TABLE derived_video_actress (
            actress_id INTEGER,
            content_id TEXT,
            release_date TEXT
        );
        INSERT INTO derived_actress VALUES (1, 'Sample');
        INSERT INTO derived_video VALUES ('h_001foo', 'FOO-001', 'Title One', 'タイトル1', '2024-01-01');
        INSERT INTO derived_video VALUES ('h_002bar', 'FOO-002', 'Title Two', 'タイトル2', '2023-01-01');
        INSERT INTO derived_video_actress VALUES (1, 'h_001foo', '2024-01-01');
        INSERT INTO derived_video_actress VALUES (1, 'h_002bar', '2023-01-01');
        """
    )
    conn.close()

    rows, total = r18_actress.list_actress_works(1, skip=0, limit=1)
    assert total == 2
    assert len(rows) == 1
    assert rows[0]["content_id"] == "h_001foo"
    assert rows[0]["image_url"] == "https://pics.dmm.co.jp/digital/video/h_001foo/h_001foopl.jpg"

    second_page, second_total = r18_actress.list_actress_works(1, skip=1, limit=1)
    assert second_total == 2
    assert [row["content_id"] for row in second_page] == ["h_002bar"]

    missing, missing_total = r18_actress.list_actress_works(99, skip=0, limit=10)
    assert missing == []
    assert missing_total == 0


def test_list_actress_works_excludes_ids_without_hyphen_before_pagination(tmp_path, monkeypatch):
    """Only count and paginate works whose selected display ID contains a hyphen."""
    import sqlite3

    from src.schemas import r18_db

    db_path = tmp_path / "r18.db"
    monkeypatch.setattr(r18_db, "R18_DB_PATH", db_path)
    r18_actress._VIDEO_JACKET_COLUMN = None

    conn = sqlite3.connect(db_path)
    conn.executescript(
        """
        CREATE TABLE derived_actress (id INTEGER PRIMARY KEY, name_romaji TEXT);
        CREATE TABLE derived_video (
            content_id TEXT PRIMARY KEY,
            dvd_id TEXT,
            title_en TEXT,
            title_ja TEXT,
            release_date TEXT
        );
        CREATE TABLE derived_video_actress (
            actress_id INTEGER,
            content_id TEXT,
            release_date TEXT
        );
        INSERT INTO derived_actress VALUES (1, 'Sample');
        INSERT INTO derived_video VALUES ('valid001', NULL, 'Valid One', NULL, '2024-01-03');
        INSERT INTO derived_video VALUES ('fallback002', 'invalid', 'Invalid', NULL, '2024-01-02');
        INSERT INTO derived_video VALUES ('valid003', 'VALID-003', 'Valid Two', NULL, '2024-01-01');
        INSERT INTO derived_video_actress VALUES (1, 'valid001', '2024-01-03');
        INSERT INTO derived_video_actress VALUES (1, 'fallback002', '2024-01-02');
        INSERT INTO derived_video_actress VALUES (1, 'valid003', '2024-01-01');
        """
    )
    conn.close()

    first_page, total = r18_actress.list_actress_works(1, skip=0, limit=1)
    second_page, second_total = r18_actress.list_actress_works(1, skip=1, limit=1)

    assert total == 2
    assert second_total == 2
    assert [row["video_code"] for row in first_page] == ["VALID-001"]
    assert [row["video_code"] for row in second_page] == ["VALID-003"]


def test_list_actress_works_dedupes_by_formatted_content_id(tmp_path, monkeypatch):
    """Works that normalize to the same display content ID are returned once."""
    import sqlite3

    from src.schemas import r18_db

    db_path = tmp_path / "r18.db"
    monkeypatch.setattr(r18_db, "R18_DB_PATH", db_path)
    r18_actress._VIDEO_JACKET_COLUMN = None

    conn = sqlite3.connect(db_path)
    conn.executescript(
        """
        CREATE TABLE derived_actress (id INTEGER PRIMARY KEY, name_romaji TEXT);
        CREATE TABLE derived_video (
            content_id TEXT PRIMARY KEY,
            dvd_id TEXT,
            title_en TEXT,
            title_ja TEXT,
            release_date TEXT
        );
        CREATE TABLE derived_video_actress (
            actress_id INTEGER,
            content_id TEXT,
            release_date TEXT
        );
        INSERT INTO derived_actress VALUES (1, 'Sample');
        INSERT INTO derived_video VALUES ('foo1', NULL, 'Title One', 'タイトル1', '2024-01-02');
        INSERT INTO derived_video VALUES ('foo001', NULL, 'Title Duplicate', 'タイトル2', '2024-01-01');
        INSERT INTO derived_video VALUES ('bar002', NULL, 'Title Two', 'タイトル3', '2023-01-01');
        INSERT INTO derived_video_actress VALUES (1, 'foo1', '2024-01-02');
        INSERT INTO derived_video_actress VALUES (1, 'foo001', '2024-01-01');
        INSERT INTO derived_video_actress VALUES (1, 'bar002', '2023-01-01');
        """
    )
    conn.close()

    rows, total = r18_actress.list_actress_works(1, skip=0, limit=10)

    assert total == 2
    assert [row["content_id"] for row in rows] == ["foo1", "bar002"]


def test_list_actress_works_searches_formatted_video_code(tmp_path, monkeypatch):
    """Work search matches the normalized video code shown in the UI."""
    import sqlite3

    from src.schemas import r18_db

    db_path = tmp_path / "r18.db"
    monkeypatch.setattr(r18_db, "R18_DB_PATH", db_path)
    r18_actress._VIDEO_JACKET_COLUMN = None

    conn = sqlite3.connect(db_path)
    conn.executescript(
        """
        CREATE TABLE derived_actress (id INTEGER PRIMARY KEY, name_romaji TEXT);
        CREATE TABLE derived_video (
            content_id TEXT PRIMARY KEY,
            dvd_id TEXT,
            title_en TEXT,
            title_ja TEXT,
            release_date TEXT
        );
        CREATE TABLE derived_video_actress (
            actress_id INTEGER,
            content_id TEXT,
            release_date TEXT
        );
        INSERT INTO derived_actress VALUES (1, 'Sample');
        INSERT INTO derived_video VALUES ('88OFJE343', NULL, 'Target', 'ターゲット', '2024-01-01');
        INSERT INTO derived_video VALUES ('bar002', NULL, 'Other', 'その他', '2023-01-01');
        INSERT INTO derived_video_actress VALUES (1, '88OFJE343', '2024-01-01');
        INSERT INTO derived_video_actress VALUES (1, 'bar002', '2023-01-01');
        """
    )
    conn.close()

    rows, total = r18_actress.list_actress_works(1, skip=0, limit=10, search="OFJE-343")

    assert total == 1
    assert rows[0]["content_id"] == "88OFJE343"
    assert rows[0]["video_code"] == "OFJE-343"


def test_list_actress_works_searches_video_code_with_different_zero_padding(tmp_path, monkeypatch):
    """Work search ignores catalog-code numeric padding differences."""
    import sqlite3

    from src.schemas import r18_db

    db_path = tmp_path / "r18.db"
    monkeypatch.setattr(r18_db, "R18_DB_PATH", db_path)
    r18_actress._VIDEO_JACKET_COLUMN = None

    conn = sqlite3.connect(db_path)
    conn.executescript(
        """
        CREATE TABLE derived_actress (id INTEGER PRIMARY KEY, name_romaji TEXT);
        CREATE TABLE derived_video (
            content_id TEXT PRIMARY KEY,
            dvd_id TEXT,
            title_en TEXT,
            title_ja TEXT,
            release_date TEXT
        );
        CREATE TABLE derived_video_actress (
            actress_id INTEGER,
            content_id TEXT,
            release_date TEXT
        );
        INSERT INTO derived_actress VALUES (1, 'Sample');
        INSERT INTO derived_video VALUES ('sivr0031', 'SIVR-0031', 'Target', 'ターゲット', '2024-01-01');
        INSERT INTO derived_video VALUES ('sivr0032', 'SIVR-0032', 'Other', 'その他', '2023-01-01');
        INSERT INTO derived_video_actress VALUES (1, 'sivr0031', '2024-01-01');
        INSERT INTO derived_video_actress VALUES (1, 'sivr0032', '2023-01-01');
        """
    )
    conn.close()

    rows, total = r18_actress.list_actress_works(1, skip=0, limit=10, search="SIVR-31")

    assert total == 1
    assert rows[0]["content_id"] == "sivr0031"
    assert rows[0]["video_code"] == "SIVR-0031"


def test_mark_existing_files_uses_persistent_deleted_state():
    from datetime import datetime

    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    from src.api.r18 import _mark_existing_files
    from src.models.models import ActressWork
    from src.schemas.actress_work_file_state import ActressWorkFileStateRecord
    from src.schemas.db_helper import Base

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    db = Session()
    try:
        db.add(
            ActressWorkFileStateRecord(
                path="/videos/deleted/ABC-123.mp4",
                status="deleted",
                file_name="ABC-123.mp4",
                file_type="video",
                first_seen_at=datetime.utcnow(),
                last_seen_at=datetime.utcnow(),
                deleted_at=datetime.utcnow(),
            )
        )
        db.commit()

        [work] = _mark_existing_files([ActressWork(content_id="abc123")], db)

        assert work.file_exists is False
        assert work.local_file_state == "deleted"
    finally:
        db.close()


def test_mark_existing_files_prefers_current_file_over_deleted_state():
    from datetime import datetime

    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    from src.api.r18 import _mark_existing_files
    from src.models.models import ActressWork
    from src.schemas.actress_work_file_state import ActressWorkFileStateRecord
    from src.schemas.db_helper import Base
    from src.schemas.file import FileRecord

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    db = Session()
    try:
        now = datetime.utcnow()
        db.add(
            ActressWorkFileStateRecord(
                path="/videos/deleted/ABC-123.mp4",
                status="deleted",
                file_name="ABC-123.mp4",
                file_type="video",
                first_seen_at=now,
                last_seen_at=now,
                deleted_at=now,
            )
        )
        db.add(
            FileRecord(
                id="file-1",
                name="ABC-123 redownloaded.mp4",
                path="/videos/current/ABC-123 redownloaded.mp4",
                size=1,
                directory_id="dir-1",
                file_type="video",
                created_at=now,
                modified_at=now,
                last_scanned_at=now,
                is_deleted=False,
            )
        )
        db.commit()

        [work] = _mark_existing_files([ActressWork(content_id="abc123")], db)

        assert work.file_exists is True
        assert work.local_file_state == "present"
    finally:
        db.close()


def test_mark_existing_files_marks_uncensored_from_rm_filename():
    from datetime import datetime

    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    from src.api.r18 import _mark_existing_files
    from src.models.models import ActressWork
    from src.schemas.db_helper import Base
    from src.schemas.file import FileRecord

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    db = Session()
    try:
        now = datetime.utcnow()
        db.add(
            FileRecord(
                id="file-rm",
                name="ABC-123-RM.mp4",
                path="/videos/current/ABC-123-RM.mp4",
                size=1,
                directory_id="dir-1",
                file_type="video",
                created_at=now,
                modified_at=now,
                last_scanned_at=now,
                is_deleted=False,
            )
        )
        db.commit()

        [work] = _mark_existing_files([ActressWork(content_id="abc123")], db)

        assert work.file_exists is True
        assert work.is_uncensored is True
        assert work.is_subtitled is False
    finally:
        db.close()


def test_mark_existing_files_marks_uncensored_from_underscore_rm_filename():
    from datetime import datetime

    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    from src.api.r18 import _mark_existing_files
    from src.models.models import ActressWork
    from src.schemas.db_helper import Base
    from src.schemas.file import FileRecord

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    db = Session()
    try:
        now = datetime.utcnow()
        db.add(
            FileRecord(
                id="file-rm",
                name="ABC-123_RM.mp4",
                path="/videos/current/ABC-123_RM.mp4",
                size=1,
                directory_id="dir-1",
                file_type="video",
                created_at=now,
                modified_at=now,
                last_scanned_at=now,
                is_deleted=False,
            )
        )
        db.commit()

        [work] = _mark_existing_files([ActressWork(content_id="abc123")], db)

        assert work.file_exists is True
        assert work.is_uncensored is True
    finally:
        db.close()


def test_mark_existing_files_marks_uncensored_from_reduced_mosaic_filename():
    from datetime import datetime

    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    from src.api.r18 import _mark_existing_files
    from src.models.models import ActressWork
    from src.schemas.db_helper import Base
    from src.schemas.file import FileRecord

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    db = Session()
    try:
        now = datetime.utcnow()
        db.add(
            FileRecord(
                id="file-rm",
                name="ABC-123 Reduced Mosaic.mp4",
                path="/videos/current/ABC-123 Reduced Mosaic.mp4",
                size=1,
                directory_id="dir-1",
                file_type="video",
                created_at=now,
                modified_at=now,
                last_scanned_at=now,
                is_deleted=False,
            )
        )
        db.commit()

        [work] = _mark_existing_files([ActressWork(content_id="abc123")], db)

        assert work.file_exists is True
        assert work.is_uncensored is True
    finally:
        db.close()


def test_mark_existing_files_marks_subtitled_from_sub_filename():
    from datetime import datetime

    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    from src.api.r18 import _mark_existing_files
    from src.models.models import ActressWork
    from src.schemas.db_helper import Base
    from src.schemas.file import FileRecord

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    db = Session()
    try:
        now = datetime.utcnow()
        db.add(
            FileRecord(
                id="file-sub",
                name="ABC-123-SUB.mp4",
                path="/videos/current/ABC-123-SUB.mp4",
                size=1,
                directory_id="dir-1",
                file_type="video",
                created_at=now,
                modified_at=now,
                last_scanned_at=now,
                is_deleted=False,
            )
        )
        db.commit()

        [work] = _mark_existing_files([ActressWork(content_id="abc123")], db)

        assert work.file_exists is True
        assert work.is_subtitled is True
    finally:
        db.close()


def test_mark_existing_files_marks_subtitled_from_subtitle_child():
    from datetime import datetime

    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    from src.api.r18 import _mark_existing_files
    from src.models.models import ActressWork
    from src.schemas.db_helper import Base
    from src.schemas.file import FileRecord

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    db = Session()
    try:
        now = datetime.utcnow()
        db.add(
            FileRecord(
                id="file-video",
                name="ABC-123.mp4",
                path="/videos/current/ABC-123.mp4",
                size=1,
                directory_id="dir-1",
                file_type="video",
                created_at=now,
                modified_at=now,
                last_scanned_at=now,
                is_deleted=False,
            )
        )
        db.add(
            FileRecord(
                id="file-subtitle",
                name="ABC-123.srt",
                path="/videos/current/subtitles/ABC-123.srt",
                size=1,
                directory_id="dir-1",
                file_type="subtitle",
                parent_id="file-video",
                created_at=now,
                modified_at=now,
                last_scanned_at=now,
                is_deleted=False,
            )
        )
        db.commit()

        [work] = _mark_existing_files([ActressWork(content_id="abc123")], db)

        assert work.file_exists is True
        assert work.is_subtitled is True
    finally:
        db.close()


def test_mark_existing_files_marks_resolution_from_video_height():
    from datetime import datetime

    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    from src.api.r18 import _mark_existing_files
    from src.models.models import ActressWork
    from src.schemas.db_helper import Base
    from src.schemas.file import FileRecord

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    db = Session()
    try:
        now = datetime.utcnow()
        db.add(
            FileRecord(
                id="file-1080p",
                name="ABC-123.mp4",
                path="/videos/current/ABC-123.mp4",
                size=1,
                directory_id="dir-1",
                file_type="video",
                height=1080,
                created_at=now,
                modified_at=now,
                last_scanned_at=now,
                is_deleted=False,
            )
        )
        db.commit()

        [work] = _mark_existing_files([ActressWork(content_id="abc123")], db)

        assert work.file_exists is True
        assert work.resolution == "1080p"
    finally:
        db.close()


def test_resolve_badge_filter_includes_uncensored_matches(monkeypatch):
    from datetime import datetime

    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    from src.api import r18
    from src.schemas.db_helper import Base
    from src.schemas.file import FileRecord

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    db = Session()
    monkeypatch.setattr(r18.r18_actress, "get_all_actress_content_ids", lambda actress_id: [("abc123", None), ("def456", None)])
    try:
        now = datetime.utcnow()
        db.add(
            FileRecord(
                id="file-rm",
                name="ABC-123-RM.mp4",
                path="/videos/current/ABC-123-RM.mp4",
                size=1,
                directory_id="dir-1",
                file_type="video",
                created_at=now,
                modified_at=now,
                last_scanned_at=now,
                is_deleted=False,
            )
        )
        db.commit()

        include, exclude = r18._resolve_badge_filter(1, db, uncensored=True)

        assert include == frozenset({"abc123"})
        assert exclude is None
    finally:
        db.close()


def test_resolve_badge_filter_includes_uncensored_underscore_rm_matches(monkeypatch):
    from datetime import datetime

    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    from src.api import r18
    from src.schemas.db_helper import Base
    from src.schemas.file import FileRecord

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    db = Session()
    monkeypatch.setattr(r18.r18_actress, "get_all_actress_content_ids", lambda actress_id: [("abc123", None), ("def456", None)])
    try:
        now = datetime.utcnow()
        db.add(
            FileRecord(
                id="file-rm",
                name="ABC-123_RM.mp4",
                path="/videos/current/ABC-123_RM.mp4",
                size=1,
                directory_id="dir-1",
                file_type="video",
                created_at=now,
                modified_at=now,
                last_scanned_at=now,
                is_deleted=False,
            )
        )
        db.commit()

        include, exclude = r18._resolve_badge_filter(1, db, uncensored=True)

        assert include == frozenset({"abc123"})
        assert exclude is None
    finally:
        db.close()


def test_resolve_badge_filter_does_not_treat_underscore_rm_as_censored(monkeypatch):
    from datetime import datetime

    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    from src.api import r18
    from src.schemas.db_helper import Base
    from src.schemas.file import FileRecord

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    db = Session()
    monkeypatch.setattr(r18.r18_actress, "get_all_actress_content_ids", lambda actress_id: [("abc123", None), ("def456", None)])
    try:
        now = datetime.utcnow()
        db.add(
            FileRecord(
                id="file-rm",
                name="ABC-123_RM.mp4",
                path="/videos/current/ABC-123_RM.mp4",
                size=1,
                directory_id="dir-1",
                file_type="video",
                created_at=now,
                modified_at=now,
                last_scanned_at=now,
                is_deleted=False,
            )
        )
        db.commit()

        include, exclude = r18._resolve_badge_filter(1, db, censored=True)

        assert include == frozenset()
        assert exclude is None
    finally:
        db.close()


def test_resolve_badge_filter_includes_subtitled_matches(monkeypatch):
    from datetime import datetime

    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    from src.api import r18
    from src.schemas.db_helper import Base
    from src.schemas.file import FileRecord

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    db = Session()
    monkeypatch.setattr(r18.r18_actress, "get_all_actress_content_ids", lambda actress_id: [("abc123", None), ("def456", None)])
    try:
        now = datetime.utcnow()
        db.add(
            FileRecord(
                id="file-video",
                name="ABC-123.mp4",
                path="/videos/current/ABC-123.mp4",
                size=1,
                directory_id="dir-1",
                file_type="video",
                created_at=now,
                modified_at=now,
                last_scanned_at=now,
                is_deleted=False,
            )
        )
        db.add(
            FileRecord(
                id="file-subtitle",
                name="ABC-123.srt",
                path="/videos/current/subtitles/ABC-123.srt",
                size=1,
                directory_id="dir-1",
                file_type="subtitle",
                parent_id="file-video",
                created_at=now,
                modified_at=now,
                last_scanned_at=now,
                is_deleted=False,
            )
        )
        db.commit()

        include, exclude = r18._resolve_badge_filter(1, db, subtitled=True)

        assert include == frozenset({"abc123"})
        assert exclude is None
    finally:
        db.close()


def test_resolve_badge_filter_excludes_negative_matches(monkeypatch):
    from datetime import datetime

    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    from src.api import r18
    from src.schemas.db_helper import Base
    from src.schemas.file import FileRecord

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    db = Session()
    monkeypatch.setattr(r18.r18_actress, "get_all_actress_content_ids", lambda actress_id: [("abc123", None), ("def456", None)])
    try:
        now = datetime.utcnow()
        db.add(
            FileRecord(
                id="file-sub",
                name="ABC-123-SUB.mp4",
                path="/videos/current/ABC-123-SUB.mp4",
                size=1,
                directory_id="dir-1",
                file_type="video",
                created_at=now,
                modified_at=now,
                last_scanned_at=now,
                is_deleted=False,
            )
        )
        db.commit()

        include, exclude = r18._resolve_badge_filter(1, db, subtitled=False)

        assert include is None
        assert exclude == frozenset({"abc123"})
    finally:
        db.close()


def test_resolve_badge_filter_includes_censored_local_matches(monkeypatch):
    from datetime import datetime

    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    from src.api import r18
    from src.schemas.db_helper import Base
    from src.schemas.file import FileRecord

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    db = Session()
    monkeypatch.setattr(r18.r18_actress, "get_all_actress_content_ids", lambda actress_id: [("abc123", None), ("def456", None), ("ghi789", None)])
    try:
        now = datetime.utcnow()
        db.add(
            FileRecord(
                id="file-censored",
                name="ABC-123.mp4",
                path="/videos/current/ABC-123.mp4",
                size=1,
                directory_id="dir-1",
                file_type="video",
                created_at=now,
                modified_at=now,
                last_scanned_at=now,
                is_deleted=False,
            )
        )
        db.add(
            FileRecord(
                id="file-rm",
                name="DEF-456-RM.mp4",
                path="/videos/current/DEF-456-RM.mp4",
                size=1,
                directory_id="dir-1",
                file_type="video",
                created_at=now,
                modified_at=now,
                last_scanned_at=now,
                is_deleted=False,
            )
        )
        db.commit()

        include, exclude = r18._resolve_badge_filter(1, db, censored=True)

        assert include == frozenset({"abc123"})
        assert exclude is None
    finally:
        db.close()


def test_resolve_badge_filter_excludes_censored_local_matches(monkeypatch):
    from datetime import datetime

    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    from src.api import r18
    from src.schemas.db_helper import Base
    from src.schemas.file import FileRecord

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    db = Session()
    monkeypatch.setattr(r18.r18_actress, "get_all_actress_content_ids", lambda actress_id: [("abc123", None), ("def456", None), ("ghi789", None)])
    try:
        now = datetime.utcnow()
        db.add(
            FileRecord(
                id="file-censored",
                name="ABC-123.mp4",
                path="/videos/current/ABC-123.mp4",
                size=1,
                directory_id="dir-1",
                file_type="video",
                created_at=now,
                modified_at=now,
                last_scanned_at=now,
                is_deleted=False,
            )
        )
        db.add(
            FileRecord(
                id="file-rm",
                name="DEF-456-RM.mp4",
                path="/videos/current/DEF-456-RM.mp4",
                size=1,
                directory_id="dir-1",
                file_type="video",
                created_at=now,
                modified_at=now,
                last_scanned_at=now,
                is_deleted=False,
            )
        )
        db.commit()

        include, exclude = r18._resolve_badge_filter(1, db, censored=False)

        assert include is None
        assert exclude == frozenset({"abc123"})
    finally:
        db.close()


def test_resolve_badge_filter_includes_resolution_matches(monkeypatch):
    from datetime import datetime

    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    from src.api import r18
    from src.schemas.db_helper import Base
    from src.schemas.file import FileRecord

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    db = Session()
    monkeypatch.setattr(r18.r18_actress, "get_all_actress_content_ids", lambda actress_id: [("abc123", None), ("def456", None)])
    try:
        now = datetime.utcnow()
        db.add(
            FileRecord(
                id="file-1080p",
                name="ABC-123.mp4",
                path="/videos/current/ABC-123.mp4",
                size=1,
                directory_id="dir-1",
                file_type="video",
                height=1080,
                created_at=now,
                modified_at=now,
                last_scanned_at=now,
                is_deleted=False,
            )
        )
        db.commit()

        include, exclude = r18._resolve_badge_filter(1, db, resolution="1080p")

        assert include == frozenset({"abc123"})
        assert exclude is None
    finally:
        db.close()


def test_resolve_file_exists_filter_deleted_excludes_current_file(monkeypatch):
    from datetime import datetime

    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    from src.api import r18
    from src.schemas.actress_work_file_state import ActressWorkFileStateRecord
    from src.schemas.db_helper import Base
    from src.schemas.file import FileRecord

    monkeypatch.setattr(r18.r18_actress, "get_all_actress_content_ids", lambda actress_id: [("abc123", None), ("def456", None)])
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    db = Session()
    try:
        now = datetime.utcnow()
        db.add(ActressWorkFileStateRecord(path="/deleted/ABC-123.mp4", status="deleted", file_name="ABC-123.mp4", file_type="video", first_seen_at=now, last_seen_at=now, deleted_at=now))
        db.add(ActressWorkFileStateRecord(path="/old/DEF-456.mp4", status="deleted", file_name="DEF-456.mp4", file_type="video", first_seen_at=now, last_seen_at=now, deleted_at=now))
        db.add(FileRecord(id="file-1", name="DEF-456.mp4", path="/current/DEF-456.mp4", size=1, directory_id="dir-1", file_type="video", created_at=now, modified_at=now, is_deleted=False))
        db.commit()

        include, exclude = r18._resolve_file_exists_filter(None, 1, db, "deleted")

        assert include == frozenset({"abc123"})
        assert exclude is None
    finally:
        db.close()


def test_resolve_file_exists_filter_missing_excludes_current_file(monkeypatch):
    from datetime import datetime

    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    from src.api import r18
    from src.schemas.actress_work_file_state import ActressWorkFileStateRecord
    from src.schemas.db_helper import Base
    from src.schemas.file import FileRecord

    monkeypatch.setattr(r18.r18_actress, "get_all_actress_content_ids", lambda actress_id: [("abc123", None), ("def456", None), ("ghi789", None)])
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    db = Session()
    try:
        now = datetime.utcnow()
        db.add(ActressWorkFileStateRecord(path="/deleted/ABC-123.mp4", status="deleted", file_name="ABC-123.mp4", file_type="video", first_seen_at=now, last_seen_at=now, deleted_at=now))
        db.add(FileRecord(id="file-1", name="DEF-456.mp4", path="/current/DEF-456.mp4", size=1, directory_id="dir-1", file_type="video", created_at=now, modified_at=now, is_deleted=False))
        db.commit()

        include, exclude = r18._resolve_file_exists_filter(None, 1, db, "missing")

        assert include is None
        assert exclude == frozenset({"def456"})
    finally:
        db.close()


def test_format_work_content_id_strips_numeric_prefix():
    """Leading numeric prefixes are removed from formatted work IDs."""
    assert r18_actress._format_work_content_id("88OFJE-343") == "OFJE-343"
    assert r18_actress._format_work_content_id("123ABC001") == "ABC-001"
    assert r18_actress._format_work_content_id("7cjod255") == "CJOD-255"
    assert r18_actress._format_work_content_id("77PPPD-711") == "PPPD-711"


def test_work_row_to_dict_normalizes_video_code():
    """Video codes returned to the UI are normalized before serialization."""
    content_row = ("7cjod255", None, "Title", "タイトル", "2024-01-01")
    dvd_row = ("abc123", "77PPPD-711", "Title", "タイトル", "2024-01-01")
    work = r18_actress._work_row_to_dict(content_row, has_jacket=False)
    dvd_work = r18_actress._work_row_to_dict(dvd_row, has_jacket=False)

    assert work["content_id"] == "7cjod255"
    assert work["video_code"] == "CJOD-255"
    assert dvd_work["video_code"] == "PPPD-711"


def test_row_to_summary_coerces_types():
    """Summary rows coerce id to int and add display_name."""
    summary = r18_actress._row_to_summary(
        (42, "Test Name", None, None, "http://example.com/img.jpg"),
        ["id", "name_romaji", "name_kanji", "name_kana", "image_url"],
    )
    assert summary["id"] == 42
    assert summary["display_name"] == "Test Name"
    assert summary["image_url"] == "http://example.com/img.jpg"


def test_save_uploaded_gz_rejects_non_gz(tmp_path, monkeypatch):
    """Upload validation rejects non-.gz filenames."""
    from src.schemas import r18_db

    monkeypatch.setattr(r18_db, "R18_DATA_DIR", tmp_path)
    with pytest.raises(ValueError, match=".sql.gz"):
        r18_db.save_uploaded_gz(b"data", "bad.sql")


def test_save_uploaded_gz_writes_file(tmp_path, monkeypatch):
    """Uploaded gzip bytes are written to the R18 data directory."""
    from src.schemas import r18_db

    monkeypatch.setattr(r18_db, "R18_DATA_DIR", tmp_path)
    path = r18_db.save_uploaded_gz(b"\x1f\x8b", "dump.sql.gz")
    assert path.exists()
    assert path.name == "dump.sql.gz"


def test_schedule_import_rejects_when_running(tmp_path, monkeypatch):
    """Background import scheduling fails while another import is active."""
    from src.schemas import r18_db

    gz_path = tmp_path / "dump.sql.gz"
    gz_path.write_bytes(b"\x1f\x8b")
    monkeypatch.setattr(r18_db, "get_import_status", lambda: {"state": "running"})
    with pytest.raises(RuntimeError, match="already in progress"):
        r18_db.schedule_import_r18_sql_gz(gz_path)


def test_update_download_progress_persists(tmp_path, monkeypatch):
    """Download progress updates are written to import status."""
    from src.schemas import r18_db

    monkeypatch.setattr(r18_db, "R18_DATA_DIR", tmp_path)
    monkeypatch.setattr(r18_db, "R18_IMPORT_STATUS_PATH", tmp_path / "import_status.json")
    r18_db._set_import_state("running", phase="downloading")
    r18_db.update_download_progress(1024, 4096)

    status = r18_db.get_import_status()
    assert status["phase"] == "downloading"
    assert status["download_bytes"] == 1024
    assert status["download_total"] == 4096


def test_get_import_status_recovers_completed_stale_running_import(tmp_path, monkeypatch):
    """A stale persisted running status does not leave the UI importing forever."""
    from src.schemas import r18_db

    status_path = tmp_path / "import_status.json"
    old_started_at = datetime.now(timezone.utc) - timedelta(hours=2)
    status_path.write_text(
        """
        {
          "state": "running",
          "phase": "importing",
          "download_bytes": null,
          "download_total": null,
          "error": null,
          "started_at": "%s",
          "finished_at": null
        }
        """
        % old_started_at.isoformat(),
        encoding="utf-8",
    )

    monkeypatch.setattr(r18_db, "R18_DATA_DIR", tmp_path)
    monkeypatch.setattr(r18_db, "R18_IMPORT_STATUS_PATH", status_path)
    monkeypatch.setattr(r18_db, "r18_db_ready", lambda: True)
    monkeypatch.setattr(r18_db, "_import_state", r18_db._idle_import_state())

    status = r18_db.get_import_status()

    assert status["state"] == "completed"
    assert status["phase"] is None
    assert status["error"] is None
    assert json.loads(status_path.read_text(encoding="utf-8"))["state"] == "completed"


def test_get_import_status_keeps_recent_running_import(tmp_path, monkeypatch):
    """A fresh running status still reports in progress while a worker is starting."""
    from src.schemas import r18_db

    status_path = tmp_path / "import_status.json"
    status_path.write_text(
        """
        {
          "state": "running",
          "phase": "downloading",
          "download_bytes": 1024,
          "download_total": 4096,
          "error": null,
          "started_at": "%s",
          "finished_at": null
        }
        """
        % datetime.now(timezone.utc).isoformat(),
        encoding="utf-8",
    )

    monkeypatch.setattr(r18_db, "R18_IMPORT_STATUS_PATH", status_path)
    monkeypatch.setattr(r18_db, "r18_db_ready", lambda: True)
    monkeypatch.setattr(r18_db, "_import_state", r18_db._idle_import_state())

    status = r18_db.get_import_status()

    assert status["state"] == "running"
    assert status["phase"] == "downloading"
    assert status["download_bytes"] == 1024


def test_download_sql_gz_reports_progress(tmp_path, monkeypatch):
    """Streaming download invokes the progress callback per chunk."""
    from io import BytesIO

    from src.schemas import r18_db

    payload = b"x" * 2048
    monkeypatch.setattr(r18_db, "R18_DATA_DIR", tmp_path)

    class FakeResponse:
        headers = {"Content-Length": str(len(payload))}

        def read(self, size: int) -> bytes:
            if not hasattr(self, "_stream"):
                self._stream = BytesIO(payload)
            return self._stream.read(size)

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def raise_for_status(self):
            return None

        def iter_bytes(self, size: int):
            while chunk := self.read(size):
                yield chunk

    import httpx

    monkeypatch.setattr(httpx, "stream", lambda *args, **kwargs: FakeResponse())

    seen: list[tuple[int, int | None]] = []

    path = r18_db.download_sql_gz(
        "http://example.com/dump.sql.gz",
        progress_callback=lambda done, total: seen.append((done, total)),
    )

    assert path.exists()
    assert path.read_bytes() == payload
    assert seen[0] == (0, len(payload))
    assert seen[-1] == (len(payload), len(payload))


def test_schedule_import_from_url_emits_notifications(tmp_path, monkeypatch):
    """URL import scheduling emits started and download notifications."""
    from src.models.notification import NotificationType
    from src.schemas import r18_db

    monkeypatch.setattr(r18_db, "R18_DATA_DIR", tmp_path)
    monkeypatch.setattr(r18_db, "R18_IMPORT_STATUS_PATH", tmp_path / "import_status.json")
    monkeypatch.setattr(r18_db, "get_import_status", lambda: {"state": "idle"})
    emitted: list[tuple[NotificationType, str, str]] = []
    monkeypatch.setattr(
        r18_db,
        "emit_notification_sync",
        lambda ntype, title, message: emitted.append((ntype, title, message)),
    )

    class _NoopThread:
        def start(self) -> None:
            return None

    monkeypatch.setattr(r18_db.threading, "Thread", lambda *args, **kwargs: _NoopThread())

    r18_db.schedule_import_from_url("https://r18.dev/dumps/latest")

    types = [item[0] for item in emitted]
    assert NotificationType.R18_IMPORT_STARTED in types
    assert NotificationType.R18_DOWNLOAD_STARTED in types


def test_minimal_fixture_is_valid_gzip(tmp_path):
    """Sanity check that test fixture pattern produces valid gzip."""
    sql = b"SELECT 1;\n"
    gz_path = tmp_path / "mini.sql.gz"
    with gzip.open(gz_path, "wb") as f:
        f.write(sql)
    with gzip.open(gz_path, "rb") as f:
        assert f.read() == sql


def test_pg_dump_importer_loads_minimal_fixture(tmp_path):
    """A tiny pg_dump-style fixture imports into SQLite."""
    from src.schemas.r18_pg_dump_importer import import_pg_dump_sql_gz

    sql = b"""\
CREATE TABLE public.derived_actress (
    id integer NOT NULL,
    name_romaji character varying,
    image_url character varying,
    name_kanji character varying,
    name_kana character varying
);

COPY public.derived_actress (id, name_romaji, image_url, name_kanji, name_kana) FROM stdin;
1\tYui Hatano\thttp://example.com/a.jpg\t\\N\t\\N
2\t\\N\t\\N\t\\N\t\\N
\\.
"""
    gz_path = tmp_path / "mini.sql.gz"
    dest_db = tmp_path / "r18.db"
    with gzip.open(gz_path, "wb") as f:
        f.write(sql)

    import_pg_dump_sql_gz(gz_path, dest_db)

    import sqlite3

    conn = sqlite3.connect(dest_db)
    try:
        count = conn.execute("SELECT COUNT(*) FROM derived_actress").fetchone()[0]
        row = conn.execute(
            "SELECT name_romaji, image_url FROM derived_actress WHERE id = 1"
        ).fetchone()
    finally:
        conn.close()

    assert count == 2
    assert row == ("Yui Hatano", "http://example.com/a.jpg")


def test_import_r18_sql_gz_end_to_end(tmp_path, monkeypatch):
    """Full import path writes metadata and marks database ready."""
    from src.schemas import r18_db

    sql = b"""\
CREATE TABLE public.derived_actress (
    id integer NOT NULL,
    name_romaji character varying
);

COPY public.derived_actress (id, name_romaji) FROM stdin;
10\tSample Actress
\\.
"""
    gz_path = tmp_path / "dump.sql.gz"
    with gzip.open(gz_path, "wb") as f:
        f.write(sql)

    db_path = tmp_path / "r18.db"
    monkeypatch.setattr(r18_db, "R18_DATA_DIR", tmp_path)
    monkeypatch.setattr(r18_db, "R18_DB_PATH", db_path)
    monkeypatch.setattr(r18_db, "R18_METADATA_PATH", tmp_path / "metadata.json")
    monkeypatch.setattr(r18_db, "R18_IMPORT_STATUS_PATH", tmp_path / "import_status.json")
    monkeypatch.setattr(
        r18_db,
        "_emit_r18_notification",
        lambda *args, **kwargs: None,
    )

    result = r18_db.import_r18_sql_gz(gz_path, filename="dump.sql.gz")

    assert result.actress_count == 1
    assert db_path.exists()
    assert r18_db.r18_db_ready()
    metadata = r18_db.read_metadata()
    assert metadata is not None
    assert metadata["filename"] == "dump.sql.gz"
