from datetime import datetime, timedelta

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest
import sqlalchemy
from sqlalchemy import event

import src.schemas.db_helper as dbh
from src.api.file import router as file_router
from src.schemas.db_helper import Base
from src.schemas.file import FileRecord
from src.schemas.scene import SceneRecord
from src.schemas.task import TaskRecord
from src.models.models import TaskStatus, TaskType
from src.crud.task import get_file_badge_tasks


def _register_regexp(dbapi_conn, connection_record):
    import re

    dbapi_conn.create_function("REGEXP", 2, lambda pattern, value: bool(re.search(pattern, value or "")))


@pytest.fixture()
def isolated_db(tmp_path, monkeypatch):
    db_path = tmp_path / "test.db"
    engine = sqlalchemy.create_engine(
        f"sqlite:///{db_path}",
        connect_args={"check_same_thread": False},
    )
    event.listen(engine, "connect", _register_regexp)
    Base.metadata.create_all(bind=engine)
    monkeypatch.setattr(dbh, "engine", engine)
    monkeypatch.setattr(dbh, "SessionLocal", sqlalchemy.orm.sessionmaker(autocommit=False, autoflush=False, bind=engine))
    yield


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(file_router)
    return TestClient(app)


def test_file_filter_index_migration_adds_indexes_to_existing_table(tmp_path, monkeypatch):
    engine = sqlalchemy.create_engine(f"sqlite:///{tmp_path / 'legacy.db'}")
    with engine.begin() as conn:
        conn.execute(sqlalchemy.text(
            "CREATE TABLE files (id TEXT, name TEXT, is_deleted BOOLEAN, created_at DATETIME, "
            "directory_id TEXT, parent_id TEXT, file_type TEXT, status TEXT)"
        ))
    monkeypatch.setattr(dbh, "engine", engine)

    dbh._ensure_file_filter_indexes()

    with engine.connect() as conn:
        indexes = {row[1] for row in conn.execute(sqlalchemy.text("PRAGMA index_list(files)")).fetchall()}
    assert {
        "ix_files_active_created_at",
        "ix_files_active_directory",
        "ix_files_parent_type_active",
        "ix_files_active_type_status",
        "ix_files_directory_name_active",
    } <= indexes


def _add_file(
    *,
    file_id: str,
    name: str,
    path: str,
    parent_id: str | None = None,
    file_type: str = "video",
    status: str = "unprocessed",
    directory_id: str = "dir-1",
    size: int = 1000,
) -> FileRecord:
    return FileRecord(
        id=file_id,
        name=name,
        path=path,
        size=size,
        created_at=datetime(2026, 1, 1),
        modified_at=datetime(2026, 1, 1),
        format="." + name.rsplit(".", 1)[1],
        duration="00:01:00" if file_type == "video" else None,
        file_type=file_type,
        status=status,
        directory_id=directory_id,
        parent_id=parent_id,
        queue_disabled=False,
        split_disabled=False,
        subtitle_disabled=False,
        is_deleted=False,
    )


def test_file_size_filters_by_operator(isolated_db):
    db = dbh.SessionLocal()
    db.add_all(
        [
            _add_file(file_id="empty", name="empty.mp4", path="/videos/empty.mp4", size=0),
            _add_file(file_id="small", name="small.mp4", path="/videos/small.mp4", size=500),
            _add_file(file_id="medium", name="medium.mp4", path="/videos/medium.mp4", size=1000),
            _add_file(file_id="large", name="large.mp4", path="/videos/large.mp4", size=1500),
        ]
    )
    db.commit()
    db.close()

    gte_response = _client().get("/api/files?file_size_operator=gte&file_size_bytes=1000&sort_by=size&sort_dir=desc")
    lte_response = _client().get("/api/files?file_size_operator=lte&file_size_bytes=1000&sort_by=size&sort_dir=desc")
    eq_response = _client().get("/api/files?file_size_operator=eq&file_size_bytes=1000")
    eq_zero_response = _client().get("/api/files?file_size_operator=eq&file_size_bytes=0")

    assert gte_response.status_code == 200
    assert [file["name"] for file in gte_response.json()["files"]] == ["large.mp4", "medium.mp4"]
    assert [file["name"] for file in lte_response.json()["files"]] == ["medium.mp4", "small.mp4", "empty.mp4"]
    assert [file["name"] for file in eq_response.json()["files"]] == ["medium.mp4"]
    assert eq_zero_response.status_code == 200
    assert [file["name"] for file in eq_zero_response.json()["files"]] == ["empty.mp4"]


def test_file_type_and_size_filters_do_not_return_subtitles(isolated_db):
    db = dbh.SessionLocal()
    db.add_all(
        [
            _add_file(file_id="video", name="video.mp4", path="/videos/video.mp4", size=1_000_000),
            _add_file(file_id="subtitle", name="video.srt", path="/videos/video.srt", file_type="subtitle", size=500),
            _add_file(file_id="large-video", name="large.mp4", path="/videos/large.mp4", size=2_000_000),
        ]
    )
    db.commit()
    db.close()

    response = _client().get("/api/files?type=video&file_size_operator=lte&file_size_bytes=1048576")

    assert response.status_code == 200
    assert [file["name"] for file in response.json()["files"]] == ["video.mp4"]


def test_video_type_filter_rejects_misclassified_subtitle_extensions(isolated_db):
    db = dbh.SessionLocal()
    db.add_all(
        [
            _add_file(file_id="video", name="video.mp4", path="/videos/video.mp4", size=1_000_000),
            _add_file(file_id="bad-srt", name="video.srt", path="/videos/video.srt", file_type="video", size=500),
            _add_file(file_id="bad-vtt", name="video.vtt", path="/videos/video.vtt", file_type="video", size=500),
        ]
    )
    db.commit()
    db.close()

    response = _client().get("/api/files?type=video&file_size_operator=lte&file_size_bytes=1048576")

    assert response.status_code == 200
    assert [file["name"] for file in response.json()["files"]] == ["video.mp4"]


def test_grouped_file_size_filter_matches_group_members(isolated_db):
    db = dbh.SessionLocal()
    db.add_all(
        [
            _add_file(file_id="empty-parent", name="empty.mp4", path="/videos/empty.mp4", size=0),
            _add_file(file_id="parent", name="movie.mp4", path="/videos/movie.mp4", size=500),
            _add_file(file_id="split", name="movie-001.mp4", path="/videos/movie-001.mp4", parent_id="parent", size=1500),
            _add_file(file_id="other-parent", name="other.mp4", path="/videos/other.mp4", size=500),
            _add_file(file_id="other-split", name="other-001.mp4", path="/videos/other-001.mp4", parent_id="other-parent", size=750),
        ]
    )
    db.commit()
    db.close()

    response = _client().get("/api/files/grouped?file_size_operator=gte&file_size_bytes=1000")
    zero_response = _client().get("/api/files/grouped?file_size_operator=eq&file_size_bytes=0")

    assert response.status_code == 200
    groups = response.json()["groups"]
    assert list(groups) == ["parent"]
    assert [file["name"] for file in groups["parent"]] == ["movie-001.mp4"]
    assert zero_response.status_code == 200
    zero_groups = zero_response.json()["groups"]
    assert list(zero_groups) == ["empty-parent"]
    assert [file["name"] for file in zero_groups["empty-parent"]] == ["empty.mp4"]


def test_grouped_file_type_and_size_filters_do_not_return_subtitles(isolated_db):
    db = dbh.SessionLocal()
    db.add_all(
        [
            _add_file(file_id="parent", name="movie.mp4", path="/videos/movie.mp4", size=1_000_000),
            _add_file(file_id="subtitle", name="movie.srt", path="/videos/movie.srt", parent_id="parent", file_type="subtitle", size=500),
            _add_file(file_id="large-parent", name="large.mp4", path="/videos/large.mp4", size=2_000_000),
            _add_file(file_id="large-subtitle", name="large.srt", path="/videos/large.srt", parent_id="large-parent", file_type="subtitle", size=500),
        ]
    )
    db.commit()
    db.close()

    response = _client().get("/api/files/grouped?type=video&file_size_operator=lte&file_size_bytes=1048576")

    assert response.status_code == 200
    assert list(response.json()["groups"]) == ["parent"]
    assert [file["name"] for file in response.json()["groups"]["parent"]] == ["movie.mp4"]


def test_unprocessed_status_filter_excludes_split_outputs(isolated_db):
    db = dbh.SessionLocal()
    db.add_all(
        [
            _add_file(file_id="original", name="movie.mp4", path="/videos/movie.mp4"),
            _add_file(file_id="split", name="movie-001.mp4", path="/videos/movie-001.mp4", parent_id="original"),
            _add_file(file_id="fresh", name="fresh.mp4", path="/videos/fresh.mp4"),
        ]
    )
    db.commit()
    db.close()

    response = _client().get("/api/files?status=unprocessed")

    assert response.status_code == 200
    assert [file["name"] for file in response.json()["files"]] == ["fresh.mp4"]


def test_unprocessed_status_filter_excludes_files_with_active_tasks(isolated_db):
    db = dbh.SessionLocal()
    db.add_all(
        [
            _add_file(file_id="active-file", name="active.mp4", path="/videos/active.mp4"),
            _add_file(file_id="fresh-file", name="fresh.mp4", path="/videos/fresh.mp4"),
            TaskRecord(
                id="active-task",
                file_id="active-file",
                type=TaskType.SCENE,
                status=TaskStatus.PROCESSING,
                created_at=datetime(2026, 1, 1),
            ),
        ]
    )
    db.commit()
    db.close()

    response = _client().get("/api/files?status=unprocessed")

    assert response.status_code == 200
    assert [file["name"] for file in response.json()["files"]] == ["fresh.mp4"]


def test_task_status_filter_matches_task_records(isolated_db):
    db = dbh.SessionLocal()
    db.add_all(
        [
            _add_file(file_id="queued-file", name="queued.mp4", path="/videos/queued.mp4"),
            _add_file(file_id="completed-file", name="completed.mp4", path="/videos/completed.mp4", status="done"),
            _add_file(file_id="failed-file", name="failed.mp4", path="/videos/failed.mp4", status="error"),
            _add_file(file_id="cancelled-file", name="cancelled.mp4", path="/videos/cancelled.mp4"),
            _add_file(file_id="paused-file", name="paused.mp4", path="/videos/paused.mp4"),
            _add_file(file_id="plain-file", name="plain.mp4", path="/videos/plain.mp4"),
            TaskRecord(
                id="queued-task",
                file_id="queued-file",
                type=TaskType.SCENE,
                status=TaskStatus.QUEUED,
                created_at=datetime(2026, 1, 1),
            ),
            TaskRecord(
                id="completed-task",
                file_id="completed-file",
                type=TaskType.SCENE,
                status=TaskStatus.COMPLETED,
                created_at=datetime(2026, 1, 1),
            ),
            TaskRecord(
                id="failed-task",
                file_id="failed-file",
                type=TaskType.SCENE,
                status=TaskStatus.FAILED,
                created_at=datetime(2026, 1, 1),
            ),
            TaskRecord(
                id="cancelled-task",
                file_id="cancelled-file",
                type=TaskType.SCENE,
                status=TaskStatus.CANCELLED,
                created_at=datetime(2026, 1, 1),
            ),
            TaskRecord(
                id="paused-task",
                file_id="paused-file",
                type=TaskType.SCENE,
                status=TaskStatus.PAUSED,
                created_at=datetime(2026, 1, 1),
            ),
        ]
    )
    db.commit()
    db.close()

    response = _client().get("/api/files?status=queued,completed,failed,cancelled,paused&sort_by=name&sort_dir=asc")

    assert response.status_code == 200
    assert [file["name"] for file in response.json()["files"]] == [
        "cancelled.mp4",
        "completed.mp4",
        "failed.mp4",
        "paused.mp4",
        "queued.mp4",
    ]


def test_grouped_unprocessed_status_filter_excludes_processed_groups(isolated_db):
    db = dbh.SessionLocal()
    db.add_all(
        [
            _add_file(file_id="split-parent", name="movie.mp4", path="/videos/movie.mp4"),
            _add_file(file_id="split-child", name="movie-001.mp4", path="/videos/movie-001.mp4", parent_id="split-parent"),
            _add_file(file_id="scene-parent", name="scene.mp4", path="/videos/scene.mp4"),
            _add_file(file_id="fresh-parent", name="fresh.mp4", path="/videos/fresh.mp4"),
            _add_file(file_id="fresh-child", name="fresh-001.mp4", path="/videos/fresh-001.mp4", parent_id="fresh-parent", status="done"),
        ]
    )
    db.add(
        SceneRecord(
            id="scene-1",
            file_id="scene-parent",
            scene_number=1,
            start_frame=0,
            end_frame=30,
            start_timecode="00:00:00.000",
            end_timecode="00:00:01.000",
            start_seconds=0.0,
            end_seconds=1.0,
            duration_seconds=1.0,
        )
    )
    db.commit()
    db.close()

    response = _client().get("/api/files/grouped?status=unprocessed")

    assert response.status_code == 200
    assert response.json()["groups"] == {}


def test_grouped_unprocessed_status_filter_excludes_groups_with_active_tasks(isolated_db):
    db = dbh.SessionLocal()
    db.add_all(
        [
            _add_file(file_id="active-parent", name="active.mp4", path="/videos/active.mp4"),
            _add_file(file_id="fresh-parent", name="fresh.mp4", path="/videos/fresh.mp4"),
            TaskRecord(
                id="active-task",
                file_id="active-parent",
                type=TaskType.SPLIT,
                status=TaskStatus.QUEUED,
                created_at=datetime(2026, 1, 1),
            ),
        ]
    )
    db.commit()
    db.close()

    response = _client().get("/api/files/grouped?status=unprocessed")

    assert response.status_code == 200
    assert list(response.json()["groups"]) == ["fresh-parent"]


def test_disabled_task_type_filters_match_root_videos(isolated_db):
    db = dbh.SessionLocal()
    split_disabled = _add_file(file_id="split-disabled", name="split-disabled.mp4", path="/videos/split-disabled.mp4")
    split_disabled.split_disabled = True
    subtitle_disabled = _add_file(file_id="subtitle-disabled", name="subtitle-disabled.mp4", path="/videos/subtitle-disabled.mp4")
    subtitle_disabled.subtitle_disabled = True
    child = _add_file(file_id="child", name="child-001.mp4", path="/videos/child-001.mp4", parent_id="enabled")
    child.split_disabled = True
    child.subtitle_disabled = True
    db.add_all(
        [
            split_disabled,
            subtitle_disabled,
            _add_file(file_id="enabled", name="enabled.mp4", path="/videos/enabled.mp4"),
            child,
        ]
    )
    db.commit()
    db.close()

    split_response = _client().get("/api/files?split_disabled=true")
    subtitle_response = _client().get("/api/files?subtitle_disabled=true")
    enabled_response = _client().get("/api/files?split_disabled=false&subtitle_disabled=false")

    assert split_response.status_code == 200
    assert [file["name"] for file in split_response.json()["files"]] == ["split-disabled.mp4"]
    assert subtitle_response.status_code == 200
    assert [file["name"] for file in subtitle_response.json()["files"]] == ["subtitle-disabled.mp4"]
    assert enabled_response.status_code == 200
    assert [file["name"] for file in enabled_response.json()["files"]] == ["enabled.mp4"]


def test_directory_filter_can_exclude_selected_directories(isolated_db):
    db = dbh.SessionLocal()
    db.add_all(
        [
            _add_file(file_id="dir-1-file", name="dir-1.mp4", path="/dir-1/video.mp4", directory_id="dir-1"),
            _add_file(file_id="dir-2-file", name="dir-2.mp4", path="/dir-2/video.mp4", directory_id="dir-2"),
            _add_file(file_id="dir-3-file", name="dir-3.mp4", path="/dir-3/video.mp4", directory_id="dir-3"),
        ]
    )
    db.commit()
    db.close()

    include_response = _client().get("/api/files?directory_id=dir-1,dir-2")
    exclude_response = _client().get("/api/files?directory_id=dir-1,dir-2&directory_exclude=true")

    assert include_response.status_code == 200
    assert {file["name"] for file in include_response.json()["files"]} == {"dir-1.mp4", "dir-2.mp4"}
    assert exclude_response.status_code == 200
    assert [file["name"] for file in exclude_response.json()["files"]] == ["dir-3.mp4"]


def test_new_videos_filter_matches_one_dash_and_release_suffixes(isolated_db):
    db = dbh.SessionLocal()
    db.add_all(
        [
            _add_file(file_id="one-dash", name="ABC-123.mp4", path="/videos/ABC-123.mp4"),
            _add_file(file_id="rm", name="ABC-123-RM.mkv", path="/videos/ABC-123-RM.mkv"),
            _add_file(file_id="sub", name="ABC-123-SUB.mp4", path="/videos/ABC-123-SUB.mp4"),
            _add_file(file_id="multi", name="ABC-123-4K.mp4", path="/videos/ABC-123-4K.mp4"),
            _add_file(file_id="none", name="trailer.mp4", path="/videos/trailer.mp4"),
            _add_file(file_id="subtitle", name="ABC-123.srt", path="/videos/ABC-123.srt", file_type="subtitle"),
        ]
    )
    db.commit()
    db.close()

    response = _client().get("/api/files?new_videos=true")

    assert response.status_code == 200
    assert [file["name"] for file in response.json()["files"]] == [
        "ABC-123.mp4",
        "ABC-123-RM.mkv",
        "ABC-123-SUB.mp4",
    ]


def test_content_tag_filter_matches_filename_markers(isolated_db):
    db = dbh.SessionLocal()
    db.add_all(
        [
            _add_file(file_id="censored", name="ABC-123.mp4", path="/videos/ABC-123.mp4"),
            _add_file(file_id="rm", name="ABC-123-RM.mkv", path="/videos/ABC-123-RM.mkv"),
            _add_file(file_id="un", name="ABC-123-UN.mp4", path="/videos/ABC-123-UN.mp4"),
            _add_file(file_id="sub", name="ABC-123-SUB.mp4", path="/videos/ABC-123-SUB.mp4"),
            _add_file(file_id="embedded", name="ABC-123-RUMOR.mp4", path="/videos/ABC-123-RUMOR.mp4"),
            _add_file(file_id="subtitle", name="ABC-123-SUB.srt", path="/videos/ABC-123-SUB.srt", file_type="subtitle"),
        ]
    )
    db.commit()
    db.close()

    uncensored_response = _client().get("/api/files?content_tag=uncensored&sort_by=name&sort_dir=asc")
    censored_response = _client().get("/api/files?content_tag=censored&sort_by=name&sort_dir=asc")
    subtitled_response = _client().get("/api/files?content_tag=subtitled&sort_by=name&sort_dir=asc")

    assert uncensored_response.status_code == 200
    assert [file["name"] for file in uncensored_response.json()["files"]] == ["ABC-123-RM.mkv", "ABC-123-UN.mp4"]
    assert censored_response.status_code == 200
    assert {file["name"] for file in censored_response.json()["files"]} == {"ABC-123.mp4", "ABC-123-RUMOR.mp4", "ABC-123-SUB.mp4"}
    assert subtitled_response.status_code == 200
    assert [file["name"] for file in subtitled_response.json()["files"]] == ["ABC-123-SUB.mp4"]


def test_grouped_new_videos_filter_matches_parent_names(isolated_db):
    db = dbh.SessionLocal()
    db.add_all(
        [
            _add_file(file_id="new-parent", name="ABC-123-RM.mp4", path="/videos/ABC-123-RM.mp4"),
            _add_file(file_id="new-child", name="ABC-123-RM-001.mp4", path="/videos/ABC-123-RM-001.mp4", parent_id="new-parent"),
            _add_file(file_id="old-parent", name="ABC-123-4K.mp4", path="/videos/ABC-123-4K.mp4"),
            _add_file(file_id="old-child", name="ABC-123-4K-001.mp4", path="/videos/ABC-123-4K-001.mp4", parent_id="old-parent"),
        ]
    )
    db.commit()
    db.close()

    response = _client().get("/api/files/grouped?new_videos=true")

    assert response.status_code == 200
    assert list(response.json()["groups"].keys()) == ["new-parent"]


def test_grouped_content_tag_filter_matches_parent_names(isolated_db):
    db = dbh.SessionLocal()
    db.add_all(
        [
            _add_file(file_id="rm-parent", name="ABC-123-RM.mp4", path="/videos/ABC-123-RM.mp4"),
            _add_file(file_id="rm-child", name="ABC-123-RM-001.mp4", path="/videos/ABC-123-RM-001.mp4", parent_id="rm-parent"),
            _add_file(file_id="censored-parent", name="ABC-123.mp4", path="/videos/ABC-123.mp4"),
            _add_file(file_id="censored-child", name="ABC-123-001.mp4", path="/videos/ABC-123-001.mp4", parent_id="censored-parent"),
        ]
    )
    db.commit()
    db.close()

    response = _client().get("/api/files/grouped?content_tag=uncensored")

    assert response.status_code == 200
    assert list(response.json()["groups"].keys()) == ["rm-parent"]
    assert [file["name"] for file in response.json()["groups"]["rm-parent"]] == ["ABC-123-RM-001.mp4", "ABC-123-RM.mp4"]


def test_grouped_directory_filter_can_exclude_selected_directories(isolated_db):
    db = dbh.SessionLocal()
    db.add_all(
        [
            _add_file(file_id="excluded-parent", name="excluded.mp4", path="/excluded/video.mp4", directory_id="dir-1"),
            _add_file(file_id="excluded-child", name="excluded-001.mp4", path="/excluded/video-001.mp4", parent_id="excluded-parent", directory_id="dir-1"),
            _add_file(file_id="included-parent", name="included.mp4", path="/included/video.mp4", directory_id="dir-2"),
            _add_file(file_id="included-child", name="included-001.mp4", path="/included/video-001.mp4", parent_id="included-parent", directory_id="dir-2"),
        ]
    )
    db.commit()
    db.close()

    response = _client().get("/api/files/grouped?directory_id=dir-1&directory_exclude=true")

    assert response.status_code == 200
    assert list(response.json()["groups"].keys()) == ["included-parent"]


def test_grouped_files_paginate_groups_before_returning_members(isolated_db):
    db = dbh.SessionLocal()
    for index in range(3):
        parent_id = f"parent-{index}"
        db.add(_add_file(file_id=parent_id, name=f"video-{index}.mp4", path=f"/videos/video-{index}.mp4"))
        db.add(_add_file(
            file_id=f"child-{index}",
            name=f"video-{index}-001.mp4",
            path=f"/videos/video-{index}-001.mp4",
            parent_id=parent_id,
        ))
    db.commit()
    db.close()

    first_page = _client().get("/api/files/grouped?page=1&limit=2&sort_by=name&sort_dir=asc").json()
    second_page = _client().get("/api/files/grouped?page=2&limit=2&sort_by=name&sort_dir=asc").json()

    assert first_page["total"] == 3
    assert first_page["totalPages"] == 2
    assert list(first_page["groups"]) == ["parent-0", "parent-1"]
    assert list(second_page["groups"]) == ["parent-2"]
    assert all(len(group) == 2 for group in first_page["groups"].values())


def test_file_badge_tasks_return_active_and_latest_terminal_per_file(isolated_db):
    db = dbh.SessionLocal()
    file = _add_file(file_id="badge-file", name="badge.mp4", path="/videos/badge.mp4")
    base_time = datetime(2026, 1, 1)
    db.add(file)
    db.add_all([
        TaskRecord(id="old-terminal", file_id=file.id, type=TaskType.SCENE, status=TaskStatus.FAILED, created_at=base_time, completed_at=base_time),
        TaskRecord(id="new-terminal", file_id=file.id, type=TaskType.SCENE, status=TaskStatus.COMPLETED, created_at=base_time + timedelta(minutes=1), completed_at=base_time + timedelta(minutes=1)),
        TaskRecord(id="active", file_id=file.id, type=TaskType.SCENE, status=TaskStatus.PROCESSING, created_at=base_time + timedelta(minutes=2)),
    ])
    db.commit()
    db.close()

    tasks = get_file_badge_tasks()

    assert {task.id for task in tasks} == {"new-terminal", "active"}
