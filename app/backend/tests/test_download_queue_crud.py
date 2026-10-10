"""Tests for download_queue CRUD operations."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from src.schemas.db_helper import Base
from src.schemas.download_queue import DownloadQueueRecord  # noqa: F401 (registers table)
from src.crud.download_queue import (
    clear_done,
    enqueue_works,
    get_failed_torrent_urls,
    get_all_queue,
    get_next_pending,
    mark_done,
    mark_failed,
    mark_failed_with_candidate,
    mark_processing,
    mark_skipped,
    retry_queue_item,
)


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()


def test_enqueue_works_inserts_rows(db):
    count = enqueue_works(db, [("abp001", "ABP-001"), ("abp002", "ABP-002")], "D:/Media/Downloads")
    assert count == 2
    rows = get_all_queue(db)
    assert len(rows) == 2
    assert {r.video_code for r in rows} == {"ABP-001", "ABP-002"}
    assert {r.content_id for r in rows} == {"abp001", "abp002"}
    assert all(r.status == "pending" for r in rows)
    assert all(r.save_path == "D:/Media/Downloads" for r in rows)


def test_enqueue_works_skips_pending_duplicates_by_content_id(db):
    enqueue_works(db, [("abp001", "ABP-001")])
    count = enqueue_works(db, [("abp001", "ABP-001"), ("abp002", "ABP-002")])
    assert count == 1  # abp001 already pending, only abp002 added


def test_enqueue_works_skips_pending_duplicates_by_video_code(db):
    enqueue_works(db, [("abp001", "ABP-001")])
    # abp001hd has different content_id but same video_code → should be skipped
    count = enqueue_works(db, [("abp001hd", "ABP-001")])
    assert count == 0


def test_enqueue_works_skips_processing_duplicates(db):
    enqueue_works(db, [("abp001", "ABP-001")])
    row = get_next_pending(db)
    mark_processing(db, row.id)
    count = enqueue_works(db, [("abp001", "ABP-001")])
    assert count == 0


def test_enqueue_works_skips_done_duplicates(db):
    enqueue_works(db, [("abp001", "ABP-001")])
    row = get_next_pending(db)
    mark_processing(db, row.id)
    mark_done(db, row.id, "http://example.com/ABP-001.torrent")
    count = enqueue_works(db, [("abp001", "ABP-001")])
    assert count == 0


def test_get_next_pending_returns_lowest_position(db):
    enqueue_works(db, [("abp002", "ABP-002"), ("abp001", "ABP-001")])
    first = get_next_pending(db)
    assert first is not None
    assert first.position == 0


def test_get_next_pending_returns_none_when_empty(db):
    assert get_next_pending(db) is None


def test_mark_processing(db):
    enqueue_works(db, [("abp001", "ABP-001")])
    row = get_next_pending(db)
    mark_processing(db, row.id)
    db.expire(row)
    assert row.status == "processing"


def test_mark_done(db):
    enqueue_works(db, [("abp001", "ABP-001")])
    row = get_next_pending(db)
    mark_processing(db, row.id)
    mark_done(db, row.id, "http://example.com/t.torrent")
    db.expire(row)
    assert row.status == "done"
    assert row.torrent_url == "http://example.com/t.torrent"
    assert row.processed_at is not None


def test_mark_failed(db):
    enqueue_works(db, [("abp001", "ABP-001")])
    row = get_next_pending(db)
    mark_processing(db, row.id)
    mark_failed(db, row.id, "qbit unreachable")
    db.expire(row)
    assert row.status == "failed"
    assert row.error == "qbit unreachable"
    assert row.processed_at is not None


def test_mark_failed_with_candidate_tracks_attempted_urls(db):
    enqueue_works(db, [("abp001", "ABP-001")])
    row = get_next_pending(db)
    mark_processing(db, row.id)
    mark_failed_with_candidate(db, row.id, "qbit unreachable", "http://example.com/1.torrent")
    db.refresh(row)
    assert row.status == "failed"
    assert row.torrent_url == "http://example.com/1.torrent"
    assert get_failed_torrent_urls(row) == ["http://example.com/1.torrent"]


def test_retry_queue_item_preserves_failed_torrent_urls(db):
    enqueue_works(db, [("abp001", "ABP-001")])
    row = get_next_pending(db)
    mark_processing(db, row.id)
    mark_failed_with_candidate(db, row.id, "qbit unreachable", "http://example.com/1.torrent")

    assert retry_queue_item(db, row.id) is True

    db.refresh(row)
    assert row.status == "pending"
    assert row.error is None
    assert row.processed_at is None
    assert row.torrent_url == "http://example.com/1.torrent"
    assert get_failed_torrent_urls(row) == ["http://example.com/1.torrent"]


def test_mark_skipped(db):
    enqueue_works(db, [("abp001", "ABP-001")])
    row = get_next_pending(db)
    mark_processing(db, row.id)
    mark_skipped(db, row.id)
    db.expire(row)
    assert row.status == "skipped"
    assert row.processed_at is not None


def test_clear_done_removes_done_and_skipped(db):
    enqueue_works(db, [("abp001", "ABP-001"), ("abp002", "ABP-002"), ("abp003", "ABP-003")])
    rows = get_all_queue(db)
    mark_processing(db, rows[0].id)
    mark_done(db, rows[0].id, "http://example.com/t.torrent")
    mark_processing(db, rows[1].id)
    mark_skipped(db, rows[1].id)
    removed = clear_done(db)
    assert removed == 2
    remaining = get_all_queue(db)
    assert len(remaining) == 1
    assert remaining[0].status == "pending"
