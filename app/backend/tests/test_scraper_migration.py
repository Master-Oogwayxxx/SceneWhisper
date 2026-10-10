from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from src.schemas import db_helper as dbh


def test_scraper_migration_adds_source_url_before_index(monkeypatch):
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                CREATE TABLE scraper_sources (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    url TEXT NOT NULL,
                    urls TEXT,
                    schedule_interval TEXT NOT NULL,
                    schedule_time TEXT,
                    schedule_day_of_week INTEGER,
                    is_active BOOLEAN NOT NULL DEFAULT 1,
                    last_run DATETIME,
                    next_run DATETIME,
                    last_found INTEGER NOT NULL DEFAULT 0,
                    last_new INTEGER NOT NULL DEFAULT 0,
                    last_pages_scraped INTEGER NOT NULL DEFAULT 0,
                    last_website_stats TEXT,
                    last_error TEXT,
                    created_at DATETIME NOT NULL,
                    updated_at DATETIME NOT NULL
                )
                """
            )
        )
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

    monkeypatch.setattr(dbh, "engine", engine)
    monkeypatch.setattr(dbh, "SessionLocal", sessionmaker(autocommit=False, autoflush=False, bind=engine))

    dbh._ensure_scraper_tables()

    with engine.connect() as conn:
        columns = {row[1] for row in conn.execute(text("PRAGMA table_info(scraped_videos)")).fetchall()}
        indexes = {row[1] for row in conn.execute(text("PRAGMA index_list(scraped_videos)")).fetchall()}

    assert "source_url" in columns
    assert "ix_scraped_videos_source_url" in indexes
