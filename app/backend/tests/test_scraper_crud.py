from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from src.models.models import Schedule, ScheduleInterval, ScraperSource
from src.crud import scraper as scraper_crud
from src.schemas.db_helper import Base
from src.schemas.file import FileRecord


def test_website_video_counts_are_grouped_by_scraper_source_url(monkeypatch):
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)

    def get_test_db():
        return Session()

    monkeypatch.setattr(scraper_crud, "get_db", get_test_db)

    scraper_crud.upsert_videos(
        "source-1",
        "https://example.test/player",
        [{"video_code": "ABC-001", "title": "One", "url": "https://example.test/player/abc-001"}],
    )
    scraper_crud.upsert_videos(
        "source-1",
        "https://example.test/javct",
        [
            {"video_code": "ABC-001", "title": "Duplicate", "url": "https://example.test/javct/abc-001"},
            {"video_code": "DEF-222", "title": "Two", "url": "https://example.test/javct/def-222"},
        ],
    )

    assert scraper_crud.get_website_video_counts("source-1") == {
        "https://example.test/player": 1,
        "https://example.test/javct": 2,
    }


def test_upsert_videos_skips_rows_without_url(monkeypatch):
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)

    def get_test_db():
        return Session()

    monkeypatch.setattr(scraper_crud, "get_db", get_test_db)

    created, updated = scraper_crud.upsert_videos(
        "source-1",
        "https://example.test/player",
        [{"video_code": "ABC-001", "title": "One", "url": None}],
    )

    assert (created, updated) == (0, 0)
    assert scraper_crud.get_website_video_counts("source-1") == {}


def test_upsert_videos_records_same_code_variants_with_different_urls(monkeypatch):
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)

    def get_test_db():
        return Session()

    monkeypatch.setattr(scraper_crud, "get_db", get_test_db)

    created, updated = scraper_crud.upsert_videos(
        "source-1",
        "https://example.test/player",
        [
            {
                "video_code": "ABC-001",
                "title": "ABC-001 standard release",
                "url": "https://example.test/player/abc-001",
                "uncensored": False,
                "censored": True,
            },
            {
                "video_code": "ABC-001",
                "title": "ABC-001 reduced mosaic",
                "url": "https://example.test/player/abc-001-rm",
                "uncensored": True,
                "censored": False,
            },
        ],
    )

    videos, total = scraper_crud.list_videos("source-1", sort_by="title", sort_dir="asc")

    assert (created, updated) == (2, 0)
    assert total == 2
    assert [video.videoCode for video in videos] == ["ABC-001", "ABC-001"]
    assert [video.url for video in videos] == [
        "https://example.test/player/abc-001-rm",
        "https://example.test/player/abc-001",
    ]
    assert [video.uncensored for video in videos] == [True, False]
    assert scraper_crud.get_website_video_counts("source-1") == {
        "https://example.test/player": 2,
    }


def test_website_video_counts_tolerates_legacy_table_without_source_url(monkeypatch):
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                CREATE TABLE scraped_videos (
                    id TEXT PRIMARY KEY,
                    source_id TEXT NOT NULL,
                    video_code TEXT NOT NULL,
                    title TEXT,
                    url TEXT,
                    scraped_at DATETIME NOT NULL,
                    first_seen_at DATETIME NOT NULL,
                    updated_at DATETIME NOT NULL
                )
                """
            )
        )
    Session = sessionmaker(bind=engine)

    def get_test_db():
        return Session()

    monkeypatch.setattr(scraper_crud, "get_db", get_test_db)

    assert scraper_crud.get_website_video_counts("source-1") == {}


def test_upsert_videos_adds_source_url_column_for_legacy_table(monkeypatch):
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                CREATE TABLE scraped_videos (
                    id TEXT PRIMARY KEY,
                    source_id TEXT NOT NULL,
                    video_code TEXT NOT NULL,
                    title TEXT,
                    url TEXT,
                    uncensored BOOLEAN,
                    censored BOOLEAN,
                    subtitled BOOLEAN,
                    opened BOOLEAN NOT NULL DEFAULT 0,
                    opened_at DATETIME,
                    scraped_at DATETIME NOT NULL,
                    first_seen_at DATETIME NOT NULL,
                    updated_at DATETIME NOT NULL
                )
                """
            )
        )
    Session = sessionmaker(bind=engine)

    def get_test_db():
        return Session()

    monkeypatch.setattr(scraper_crud, "get_db", get_test_db)

    scraper_crud.upsert_videos(
        "source-1",
        "https://example.test/player",
        [{"video_code": "ABC-001", "title": "One", "url": "https://example.test/player/abc-001"}],
    )

    assert scraper_crud.get_website_video_counts("source-1") == {
        "https://example.test/player": 1,
    }


def test_backfill_source_video_urls_matches_existing_rows_by_hostname(monkeypatch):
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)

    def get_test_db():
        return Session()

    monkeypatch.setattr(scraper_crud, "get_db", get_test_db)

    db = Session()
    try:
        db.execute(
            text(
                """
                INSERT INTO scraped_videos (
                    id, source_id, source_url, video_code, title, url,
                    opened, scraped_at, first_seen_at, updated_at
                ) VALUES (
                    'legacy-1', 'source-1', NULL, 'ABC-001', 'One', 'https://player.test/item/abc-001',
                    0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                ), (
                    'legacy-2', 'source-1', NULL, 'DEF-222', 'Two', 'https://javct.test/item/def-222',
                    0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                )
                """
            )
        )
        db.commit()
    finally:
        db.close()

    assert scraper_crud.backfill_source_video_urls(
        "source-1",
        ["https://player.test/model/name", "https://javct.test/model/name"],
    ) == 2
    assert scraper_crud.get_website_video_counts("source-1") == {
        "https://player.test/model/name": 1,
        "https://javct.test/model/name": 1,
    }


def test_list_sources_refreshes_total_found_from_scraped_video_rows(monkeypatch):
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)

    def get_test_db():
        return Session()

    monkeypatch.setattr(scraper_crud, "get_db", get_test_db)

    scraper_crud.create_source(
        ScraperSource(
            id="source-1",
            name="One",
            url="https://one.test/model/name",
            urls=["https://one.test/model/name"],
            schedule=Schedule(interval=ScheduleInterval.DAILY, time="09:00"),
            isActive=True,
            lastFound=999,
            lastWebsiteStats=[
                {"url": "https://one.test/model/name", "pagesScraped": 0, "found": 999, "created": 0, "updated": 0}
            ],
            createdAt="2026-01-01T00:00:00Z",
        )
    )
    scraper_crud.upsert_videos(
        "source-1",
        "https://one.test/model/name",
        [
            {"video_code": "ABC-001", "title": "One", "url": "https://one.test/item/abc-001"},
            {"video_code": "DEF-222", "title": "Two", "url": "https://one.test/item/def-222"},
        ],
    )

    source = scraper_crud.list_sources()[0]

    assert source.lastFound == 2
    assert source.lastWebsiteStats[0]["found"] == 2


def test_list_videos_excludes_navigation_titles(monkeypatch):
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)

    def get_test_db():
        return Session()

    monkeypatch.setattr(scraper_crud, "get_db", get_test_db)

    scraper_crud.upsert_videos(
        "source-1",
        "https://example.test/player",
        [
            {"video_code": "ABC-001", "title": "ABC-001 title", "url": "https://example.test/player/abc-001"},
            {"video_code": "DEF-222", "title": "<Prev", "url": "https://example.test/player/page/1"},
            {"video_code": "GHI-333", "title": "Next>", "url": "https://example.test/player/page/2"},
        ],
    )

    videos, total = scraper_crud.list_videos("source-1")

    assert total == 1
    assert [video.videoCode for video in videos] == ["ABC-001"]


def test_list_videos_does_not_treat_censored_local_file_as_uncensored_match(monkeypatch):
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)

    def get_test_db():
        return Session()

    monkeypatch.setattr(scraper_crud, "get_db", get_test_db)

    scraper_crud.upsert_videos(
        "source-1",
        "https://example.test/player",
        [
            {
                "video_code": "ABC-001",
                "title": "ABC-001 standard release",
                "url": "https://example.test/player/abc-001",
                "uncensored": False,
                "censored": True,
            },
            {
                "video_code": "ABC-001",
                "title": "ABC-001 reduced mosaic",
                "url": "https://example.test/player/abc-001-rm",
                "uncensored": True,
                "censored": False,
            },
        ],
    )
    db = Session()
    try:
        db.add(
            FileRecord(
                id="file-1",
                name="ABC-001.mp4",
                path="X:/videos/ABC-001.mp4",
                size=1,
                directory_id="dir-1",
                is_deleted=False,
            )
        )
        db.commit()
    finally:
        db.close()

    videos, total = scraper_crud.list_videos("source-1", file_exists=False, uncensored=True)

    assert total == 1
    assert videos[0].videoCode == "ABC-001"
    assert videos[0].uncensored is True
    assert videos[0].fileExists is False


def test_list_videos_can_disable_trait_aware_local_matching(monkeypatch):
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)

    def get_test_db():
        return Session()

    monkeypatch.setattr(scraper_crud, "get_db", get_test_db)

    scraper_crud.upsert_videos(
        "source-1",
        "https://example.test/player",
        [
            {
                "video_code": "ABC-001",
                "title": "ABC-001 reduced mosaic",
                "url": "https://example.test/player/abc-001-rm",
                "uncensored": True,
                "censored": False,
            },
        ],
    )
    db = Session()
    try:
        db.add(
            FileRecord(
                id="file-1",
                name="ABC-001.mp4",
                path="X:/videos/ABC-001.mp4",
                size=1,
                directory_id="dir-1",
                is_deleted=False,
            )
        )
        db.commit()
    finally:
        db.close()

    videos, total = scraper_crud.list_videos(
        "source-1",
        file_exists=False,
        local_match_traits=False,
        uncensored=True,
    )

    assert total == 0
    assert videos == []


def test_list_videos_can_require_matching_local_resolution(monkeypatch):
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)

    def get_test_db():
        return Session()

    monkeypatch.setattr(scraper_crud, "get_db", get_test_db)

    scraper_crud.upsert_videos(
        "source-1",
        "https://example.test/player",
        [
            {
                "video_code": "ABC-001",
                "title": "ABC-001 1080p release",
                "url": "https://example.test/player/abc-001-1080p",
                "uncensored": False,
                "censored": True,
            },
        ],
    )
    db = Session()
    try:
        db.add(
            FileRecord(
                id="file-1",
                name="ABC-001 720p.mp4",
                path="X:/videos/ABC-001 720p.mp4",
                size=1,
                directory_id="dir-1",
                is_deleted=False,
                height=720,
            )
        )
        db.commit()
    finally:
        db.close()

    videos, total = scraper_crud.list_videos(
        "source-1",
        file_exists=False,
        local_match_resolution=True,
    )

    assert total == 1
    assert videos[0].videoCode == "ABC-001"
    assert videos[0].fileExists is False
