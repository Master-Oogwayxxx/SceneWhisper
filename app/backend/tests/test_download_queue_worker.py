"""Tests for bulk torrent queue candidate retry ordering."""

import sys
from pathlib import Path
from datetime import datetime, timedelta, timezone

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import src.schemas.db_helper as dbh
from src.crud.download_queue import enqueue_works, get_all_queue
from src.schemas.db_helper import init_db
from src.workers import download_queue_worker as worker


@pytest.fixture(autouse=True)
def reset_db(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path}/test.db", connect_args={"check_same_thread": False})
    dbh.engine = engine
    dbh.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    worker.SessionLocal = dbh.SessionLocal
    dbh.Base.metadata.create_all(engine)
    init_db()
    yield
    engine.dispose()


def test_process_one_uses_highest_seed_candidate(monkeypatch):
    db = dbh.SessionLocal()
    enqueue_works(db, [("abp001", "ABP-001")])
    db.close()

    sent_calls: list[tuple[str, str | None, list[str] | None]] = []
    monkeypatch.setattr(
        worker,
        "_fetch_nyaa_candidates",
        lambda _video_code: [
            worker.NyaaCandidate("Plain Release", "http://example.com/top.torrent", 100),
            worker.NyaaCandidate("Backup Release", "http://example.com/second.torrent", 50),
        ],
    )
    monkeypatch.setattr(worker, "get_actress_names_by_content_id", lambda _content_id: ["Jane Doe"])
    monkeypatch.setattr(worker, "_send_to_qbit", lambda url, category=None, tags=None: sent_calls.append((url, category, tags)))
    monkeypatch.setattr(
        worker,
        "insert_tracking",
        lambda db, content_id, torrent_name, video_code: type("Tracking", (), {"id": 1})(),
    )
    monkeypatch.setattr(worker, "_find_hash", lambda *_args, **_kwargs: None)

    worker._process_one()

    assert sent_calls == [("http://example.com/top.torrent", "Scene Whisper", ["Jane Doe"])]
    db = dbh.SessionLocal()
    rows = get_all_queue(db)
    db.close()
    assert rows[0].status == "processing"
    assert rows[0].failed_torrent_urls == "[]"


def test_retry_advances_to_second_best_candidate(monkeypatch):
    db = dbh.SessionLocal()
    enqueue_works(db, [("abp001", "ABP-001")])
    db.close()

    monkeypatch.setattr(
        worker,
        "_fetch_nyaa_candidates",
        lambda _video_code: [
            worker.NyaaCandidate("Plain Release", "http://example.com/top.torrent", 100),
            worker.NyaaCandidate("Backup Release", "http://example.com/second.torrent", 50),
        ],
    )
    monkeypatch.setattr(
        worker,
        "insert_tracking",
        lambda db, content_id, torrent_name, video_code: type("Tracking", (), {"id": 1})(),
    )
    monkeypatch.setattr(worker, "_find_hash", lambda *_args, **_kwargs: None)

    calls: list[tuple[str, str | None, list[str] | None]] = []

    monkeypatch.setattr(worker, "get_actress_names_by_content_id", lambda _content_id: ["Jane Doe"])

    def fail_then_succeed(url: str, category: str | None = None, tags: list[str] | None = None) -> None:
        calls.append((url, category, tags))
        if len(calls) == 1:
            raise RuntimeError("qBittorrent add torrent failed: boom")

    monkeypatch.setattr(worker, "_send_to_qbit", fail_then_succeed)

    worker._process_one()

    db = dbh.SessionLocal()
    row = get_all_queue(db)[0]
    assert row.status == "failed"
    assert row.torrent_url == "http://example.com/top.torrent"
    assert row.failed_torrent_urls == "[\"http://example.com/top.torrent\"]"
    db.close()

    db = dbh.SessionLocal()
    from src.crud.download_queue import retry_queue_item

    retry_queue_item(db, row.id)
    db.close()

    worker._process_one()

    assert calls == [
        ("http://example.com/top.torrent", "Scene Whisper", ["Jane Doe"]),
        ("http://example.com/second.torrent", "Scene Whisper", ["Jane Doe"]),
    ]
    db = dbh.SessionLocal()
    row = get_all_queue(db)[0]
    db.close()
    assert row.status == "processing"
    assert row.torrent_url == "http://example.com/second.torrent"
    assert row.failed_torrent_urls == "[\"http://example.com/top.torrent\"]"


def test_process_one_marks_failed_when_all_candidates_exhausted(monkeypatch):
    db = dbh.SessionLocal()
    enqueue_works(db, [("abp001", "ABP-001")])
    from src.crud.download_queue import mark_failed_with_candidate, mark_processing, get_next_pending, retry_queue_item

    row = get_next_pending(db)
    mark_processing(db, row.id)
    mark_failed_with_candidate(db, row.id, "qBittorrent add torrent failed: boom", "http://example.com/top.torrent")
    retry_queue_item(db, row.id)
    db.close()

    monkeypatch.setattr(
        worker,
        "_fetch_nyaa_candidates",
        lambda _video_code: [worker.NyaaCandidate("Plain Release", "http://example.com/top.torrent", 100)],
    )
    monkeypatch.setattr(worker, "_send_to_qbit", lambda _url, _category=None, _tags=None: None)

    worker._process_one()

    db = dbh.SessionLocal()
    row = get_all_queue(db)[0]
    db.close()
    assert row.status == "failed"
    assert row.error == "All torrent candidates failed"


def test_process_one_prefers_reducing_mosaic_then_uncensored_before_seeders(monkeypatch):
    db = dbh.SessionLocal()
    enqueue_works(db, [("abp001", "ABP-001")])
    db.close()

    sent_calls: list[tuple[str, str | None, list[str] | None]] = []
    monkeypatch.setattr(
        worker,
        "_fetch_nyaa_candidates",
        lambda _video_code: [
            worker.NyaaCandidate("High Seed Plain Release", "http://example.com/plain.torrent", 500),
            worker.NyaaCandidate("UNCENSORED release", "http://example.com/uncensored.torrent", 50),
            worker.NyaaCandidate("ReDuCiNg MoSaIc release", "http://example.com/reducing.torrent", 10),
        ],
    )
    monkeypatch.setattr(worker, "get_actress_names_by_content_id", lambda _content_id: ["Jane Doe"])
    monkeypatch.setattr(worker, "_send_to_qbit", lambda url, category=None, tags=None: sent_calls.append((url, category, tags)))
    monkeypatch.setattr(
        worker,
        "insert_tracking",
        lambda db, content_id, torrent_name, video_code: type("Tracking", (), {"id": 1})(),
    )
    monkeypatch.setattr(worker, "_find_hash", lambda *_args, **_kwargs: None)

    worker._process_one()

    assert sent_calls == [("http://example.com/reducing.torrent", "Scene Whisper", ["Jane Doe"])]


def test_candidate_sort_key_prefers_reducing_mosaic_then_uncensored_then_seeders():
    candidates = [
        worker.NyaaCandidate("plain", "http://example.com/plain.torrent", 999),
        worker.NyaaCandidate("UNCENSORED", "http://example.com/uncensored.torrent", 1),
        worker.NyaaCandidate("reducing mosaic", "http://example.com/reducing.torrent", 0),
    ]

    ordered = sorted(candidates, key=worker._candidate_sort_key, reverse=True)

    assert [candidate.torrent_url for candidate in ordered] == [
        "http://example.com/reducing.torrent",
        "http://example.com/uncensored.torrent",
        "http://example.com/plain.torrent",
    ]


def test_poll_processing_marks_failed_when_torrent_missing_before_completion(monkeypatch):
    db = dbh.SessionLocal()
    enqueue_works(db, [("abp001", "ABP-001")])
    from src.crud.download_queue import get_next_pending, mark_processing
    from src.crud.torrent_tracking import get_tracking_by_content_id, insert_tracking, update_hash

    row = get_next_pending(db)
    mark_processing(db, row.id)
    tracking = insert_tracking(db, "abp001", "ABP-001", "ABP-001")
    update_hash(db, tracking.id, "deadbeef")
    db.close()

    monkeypatch.setattr(worker, "get_torrent_progress", lambda _torrent_hash: None)

    worker._poll_processing_items()

    db = dbh.SessionLocal()
    row = get_all_queue(db)[0]
    tracking = get_tracking_by_content_id(db, "abp001")
    db.close()

    assert row.status == "failed"
    assert row.error == "Torrent removed from qBittorrent before completion"
    assert tracking is not None
    assert tracking.status == "error"


def test_poll_processing_fails_and_deletes_torrent_when_time_limit_exceeded(monkeypatch):
    db = dbh.SessionLocal()
    enqueue_works(db, [("abp001", "ABP-001")])
    from src.crud.download_queue import get_next_pending, mark_processing
    from src.crud.torrent_tracking import get_tracking_by_content_id, insert_tracking, update_hash

    row = get_next_pending(db)
    mark_processing(db, row.id)
    row.torrent_url = "http://example.com/top.torrent"
    tracking = insert_tracking(db, "abp001", "ABP-001", "ABP-001")
    update_hash(db, tracking.id, "deadbeef")
    tracking.added_at = datetime.now(timezone.utc) - timedelta(minutes=31)
    db.commit()
    db.close()

    monkeypatch.setattr(worker, "get_settings", lambda: type("Settings", (), {"queue_download_time_limit_minutes": 30})())
    monkeypatch.setattr(worker, "get_torrent_progress", lambda _torrent_hash: 0.5)
    deleted_hashes: list[str] = []
    monkeypatch.setattr(worker, "delete_torrent", lambda torrent_hash: deleted_hashes.append(torrent_hash))

    worker._poll_processing_items()

    db = dbh.SessionLocal()
    row = get_all_queue(db)[0]
    tracking = get_tracking_by_content_id(db, "abp001")
    db.close()

    assert deleted_hashes == ["deadbeef"]
    assert row.status == "failed"
    assert row.error == "Torrent exceeded download time limit of 30 minutes"
    assert tracking is not None
    assert tracking.status == "error"


def test_poll_processing_marks_done_when_completed_torrent_exceeds_time_limit(monkeypatch):
    db = dbh.SessionLocal()
    enqueue_works(db, [("abp001", "ABP-001")])
    from src.crud.download_queue import get_next_pending, mark_processing
    from src.crud.torrent_tracking import get_tracking_by_content_id, insert_tracking, update_hash

    row = get_next_pending(db)
    mark_processing(db, row.id)
    row.torrent_url = "http://example.com/top.torrent"
    tracking = insert_tracking(db, "abp001", "ABP-001", "ABP-001")
    update_hash(db, tracking.id, "deadbeef")
    tracking.added_at = datetime.now(timezone.utc) - timedelta(minutes=31)
    db.commit()
    db.close()

    monkeypatch.setattr(worker, "get_settings", lambda: type("Settings", (), {"queue_download_time_limit_minutes": 30})())
    monkeypatch.setattr(worker, "get_torrent_progress", lambda _torrent_hash: 1.0)
    deleted_hashes: list[str] = []
    monkeypatch.setattr(worker, "delete_torrent", lambda torrent_hash: deleted_hashes.append(torrent_hash))

    worker._poll_processing_items()

    db = dbh.SessionLocal()
    row = get_all_queue(db)[0]
    tracking = get_tracking_by_content_id(db, "abp001")
    db.close()

    assert deleted_hashes == []
    assert row.status == "done"
    assert row.error is None
    assert tracking is not None
    assert tracking.status == "downloading"


def test_poll_processing_keeps_recent_missing_torrent_in_processing(monkeypatch):
    db = dbh.SessionLocal()
    enqueue_works(db, [("abp001", "ABP-001")])
    from src.crud.download_queue import get_next_pending, mark_processing
    from src.crud.torrent_tracking import get_tracking_by_content_id, insert_tracking

    row = get_next_pending(db)
    mark_processing(db, row.id)
    insert_tracking(db, "abp001", "ABP-001", "ABP-001")
    db.close()

    monkeypatch.setattr(worker, "find_torrent_hash_by_name", lambda *_args, **_kwargs: None)

    worker._poll_processing_items()

    db = dbh.SessionLocal()
    row = get_all_queue(db)[0]
    tracking = get_tracking_by_content_id(db, "abp001")
    db.close()

    assert row.status == "processing"
    assert tracking is not None
    assert tracking.status == "downloading"


def test_retry_after_missing_torrent_failure_skips_previous_torrent_url(monkeypatch):
    db = dbh.SessionLocal()
    enqueue_works(db, [("abp001", "ABP-001")])
    from src.crud.download_queue import get_next_pending, mark_processing, retry_queue_item
    from src.crud.torrent_tracking import insert_tracking, update_hash

    row = get_next_pending(db)
    mark_processing(db, row.id)
    tracking = insert_tracking(db, "abp001", "ABP-001", "ABP-001")
    update_hash(db, tracking.id, "deadbeef")
    tracking.added_at = datetime.now(timezone.utc) - timedelta(minutes=10)
    row.torrent_url = "http://example.com/top.torrent"
    db.commit()
    db.close()

    monkeypatch.setattr(worker, "get_torrent_progress", lambda _torrent_hash: None)
    worker._poll_processing_items()

    db = dbh.SessionLocal()
    row = get_all_queue(db)[0]
    assert row.status == "failed"
    assert row.torrent_url == "http://example.com/top.torrent"
    assert row.failed_torrent_urls == "[\"http://example.com/top.torrent\"]"
    assert retry_queue_item(db, row.id) is True
    db.close()

    monkeypatch.setattr(
        worker,
        "_fetch_nyaa_candidates",
        lambda _video_code: [
            worker.NyaaCandidate("Plain Release", "http://example.com/top.torrent", 100),
            worker.NyaaCandidate("Backup Release", "http://example.com/second.torrent", 50),
        ],
    )
    sent_calls: list[tuple[str, str | None, list[str] | None]] = []
    monkeypatch.setattr(worker, "get_actress_names_by_content_id", lambda _content_id: ["Jane Doe"])
    monkeypatch.setattr(worker, "_send_to_qbit", lambda url, category=None, tags=None: sent_calls.append((url, category, tags)))
    monkeypatch.setattr(
        worker,
        "insert_tracking",
        lambda db, content_id, torrent_name, video_code: type("Tracking", (), {"id": 1})(),
    )
    monkeypatch.setattr(worker, "_find_hash", lambda *_args, **_kwargs: None)

    worker._process_one()

    assert sent_calls == [("http://example.com/second.torrent", "Scene Whisper", ["Jane Doe"])]


def test_process_one_omits_tags_when_no_actress_names(monkeypatch):
    db = dbh.SessionLocal()
    enqueue_works(db, [("abp001", "ABP-001")])
    db.close()

    sent_calls: list[tuple[str, str | None, list[str] | None]] = []
    monkeypatch.setattr(
        worker,
        "_fetch_nyaa_candidates",
        lambda _video_code: [worker.NyaaCandidate("Plain Release", "http://example.com/top.torrent", 100)],
    )
    monkeypatch.setattr(worker, "get_actress_names_by_content_id", lambda _content_id: [])
    monkeypatch.setattr(worker, "_send_to_qbit", lambda url, category=None, tags=None: sent_calls.append((url, category, tags)))
    monkeypatch.setattr(
        worker,
        "insert_tracking",
        lambda db, content_id, torrent_name, video_code: type("Tracking", (), {"id": 1})(),
    )
    monkeypatch.setattr(worker, "_find_hash", lambda *_args, **_kwargs: None)

    worker._process_one()

    assert sent_calls == [("http://example.com/top.torrent", "Scene Whisper", None)]


def test_process_one_uses_monitor_save_path_when_available(monkeypatch):
    db = dbh.SessionLocal()
    enqueue_works(db, [("abp001", "ABP-001")])
    db.close()

    sent_calls: list[tuple[str, str | None, list[str] | None, str | None]] = []
    monkeypatch.setattr(
        worker,
        "_fetch_nyaa_candidates",
        lambda _video_code: [worker.NyaaCandidate("Plain Release", "http://example.com/top.torrent", 100)],
    )
    monkeypatch.setattr(worker, "get_actress_names_by_content_id", lambda _content_id: ["Jane Doe"])
    monkeypatch.setattr(worker, "_get_monitor_save_path", lambda _db, _content_id: "D:/Media/Actresses/Jane Doe")
    monkeypatch.setattr(
        worker,
        "_send_to_qbit",
        lambda url, category=None, tags=None, save_path=None: sent_calls.append((url, category, tags, save_path)),
    )
    monkeypatch.setattr(
        worker,
        "insert_tracking",
        lambda db, content_id, torrent_name, video_code: type("Tracking", (), {"id": 1})(),
    )
    monkeypatch.setattr(worker, "_find_hash", lambda *_args, **_kwargs: None)

    worker._process_one()

    assert sent_calls == [("http://example.com/top.torrent", "Scene Whisper", ["Jane Doe"], "D:/Media/Actresses/Jane Doe")]


def test_process_one_prefers_queue_save_path_over_monitor_default(monkeypatch):
    db = dbh.SessionLocal()
    enqueue_works(db, [("abp001", "ABP-001")], "D:/Media/Queue All")
    db.close()

    sent_calls: list[tuple[str, str | None, list[str] | None, str | None]] = []
    monkeypatch.setattr(
        worker,
        "_fetch_nyaa_candidates",
        lambda _video_code: [worker.NyaaCandidate("Plain Release", "http://example.com/top.torrent", 100)],
    )
    monkeypatch.setattr(worker, "get_actress_names_by_content_id", lambda _content_id: ["Jane Doe"])
    monkeypatch.setattr(worker, "_get_monitor_save_path", lambda _db, _content_id: "D:/Media/Actresses/Jane Doe")
    monkeypatch.setattr(
        worker,
        "_send_to_qbit",
        lambda url, category=None, tags=None, save_path=None: sent_calls.append((url, category, tags, save_path)),
    )
    monkeypatch.setattr(
        worker,
        "insert_tracking",
        lambda db, content_id, torrent_name, video_code: type("Tracking", (), {"id": 1})(),
    )
    monkeypatch.setattr(worker, "_find_hash", lambda *_args, **_kwargs: None)

    worker._process_one()

    assert sent_calls == [("http://example.com/top.torrent", "Scene Whisper", ["Jane Doe"], "D:/Media/Queue All")]


def test_poll_processing_marks_done_when_missing_torrent_was_already_completed(monkeypatch):
    db = dbh.SessionLocal()
    enqueue_works(db, [("abp001", "ABP-001")])
    from src.crud.download_queue import get_next_pending, mark_processing
    from src.crud.torrent_tracking import get_tracking_by_content_id, insert_tracking, update_hash, update_status

    row = get_next_pending(db)
    mark_processing(db, row.id)
    tracking = insert_tracking(db, "abp001", "ABP-001", "ABP-001")
    update_hash(db, tracking.id, "deadbeef")
    update_status(db, tracking.id, "completed")
    db.close()

    monkeypatch.setattr(worker, "get_torrent_progress", lambda _torrent_hash: None)

    worker._poll_processing_items()

    db = dbh.SessionLocal()
    row = get_all_queue(db)[0]
    tracking = get_tracking_by_content_id(db, "abp001")
    db.close()

    assert row.status == "done"
    assert tracking is not None
    assert tracking.status == "completed"


def test_retry_after_missing_torrent_failure_returns_item_to_pending(monkeypatch):
    db = dbh.SessionLocal()
    enqueue_works(db, [("abp001", "ABP-001")])
    from src.crud.download_queue import get_next_pending, mark_processing, retry_queue_item
    from src.crud.torrent_tracking import insert_tracking, update_hash

    row = get_next_pending(db)
    mark_processing(db, row.id)
    tracking = insert_tracking(db, "abp001", "ABP-001", "ABP-001")
    update_hash(db, tracking.id, "deadbeef")
    tracking.added_at = datetime.now(timezone.utc) - timedelta(minutes=10)
    db.commit()
    db.close()

    monkeypatch.setattr(worker, "get_torrent_progress", lambda _torrent_hash: None)
    worker._poll_processing_items()

    db = dbh.SessionLocal()
    row = get_all_queue(db)[0]
    assert row.status == "failed"
    assert retry_queue_item(db, row.id) is True
    db.refresh(row)
    db.close()

    assert row.status == "pending"
    assert row.error is None
