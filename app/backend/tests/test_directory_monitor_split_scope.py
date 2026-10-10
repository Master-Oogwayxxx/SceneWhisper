import pytest
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker

from src.crud.directory_monitor import create_directory_monitor, get_directory_monitor, update_directory_monitor
from src.models.models import DirectoryMonitor, Schedule, ScheduleInterval, TaskType
from src.schemas import db_helper as dbh
from src.schemas.db_helper import Base


@pytest.fixture(autouse=True)
def isolated_db(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path / 'test.db'}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    monkeypatch.setattr(dbh, "engine", engine)
    monkeypatch.setattr(dbh, "SessionLocal", sessionmaker(autocommit=False, autoflush=False, bind=engine))
    yield engine


def _monitor(scope: str) -> DirectoryMonitor:
    return DirectoryMonitor(
        id="split-scope-monitor",
        directoryId="directory-1",
        directoryName="Videos",
        directoryPath="/videos",
        taskType=TaskType.SPLIT,
        splitScope=scope,
        schedule=Schedule(interval=ScheduleInterval.DAILY, time="09:00"),
        isActive=True,
        createdAt="2026-09-19T00:00:00Z",
    )


def test_directory_monitor_split_scope_round_trip(isolated_db):
    created = create_directory_monitor(_monitor("uncensored"))
    assert created.splitScope == "uncensored"

    updated = created.model_copy(update={"splitScope": "censored"})
    update_directory_monitor(updated)

    fetched = get_directory_monitor(created.id)
    assert fetched is not None
    assert fetched.splitScope == "censored"


def test_directory_monitor_nvenc_overwrite_original_round_trip(isolated_db):
    monitor = _monitor("both").model_copy(
        update={
            "taskType": TaskType.NVENC_FRAME_PACING,
            "taskTypes": [TaskType.NVENC_FRAME_PACING],
            "framePacingScope": "split",
            "nvencOverwriteOriginal": True,
        }
    )

    created = create_directory_monitor(monitor)
    assert created.framePacingScope == "split"
    assert created.nvencOverwriteOriginal is True

    updated = created.model_copy(update={"framePacingScope": "all", "nvencOverwriteOriginal": False})
    update_directory_monitor(updated)

    fetched = get_directory_monitor(created.id)
    assert fetched is not None
    assert fetched.framePacingScope == "all"
    assert fetched.nvencOverwriteOriginal is False


def test_directory_monitor_all_task_type_expands_to_split_and_subtitle():
    data = _monitor("both").model_dump()
    data.update({"taskType": TaskType.ALL, "taskTypes": [TaskType.ALL]})
    monitor = DirectoryMonitor(**data)

    assert monitor.taskType == TaskType.SPLIT
    assert monitor.taskTypes == [TaskType.SPLIT, TaskType.SUBTITLE]


def test_split_scope_migration_defaults_existing_monitors_to_both(isolated_db):
    with isolated_db.connect() as conn:
        conn.execute(text("DROP TABLE directory_monitors"))
        conn.execute(text("CREATE TABLE directory_monitors (id TEXT PRIMARY KEY)"))
        conn.execute(text("INSERT INTO directory_monitors (id) VALUES ('legacy')"))
        conn.commit()

    dbh._ensure_directory_monitor_split_scope_column()

    assert "split_scope" in {column["name"] for column in inspect(isolated_db).get_columns("directory_monitors")}
    with isolated_db.connect() as conn:
        assert conn.execute(text("SELECT split_scope FROM directory_monitors WHERE id = 'legacy'")).scalar_one() == "both"


def test_nvenc_overwrite_original_migration_defaults_existing_monitors_to_false(isolated_db):
    with isolated_db.connect() as conn:
        conn.execute(text("DROP TABLE directory_monitors"))
        conn.execute(text("CREATE TABLE directory_monitors (id TEXT PRIMARY KEY)"))
        conn.execute(text("INSERT INTO directory_monitors (id) VALUES ('legacy')"))
        conn.commit()

    dbh._ensure_directory_monitor_nvenc_overwrite_original_column()

    assert "nvenc_overwrite_original" in {column["name"] for column in inspect(isolated_db).get_columns("directory_monitors")}
    with isolated_db.connect() as conn:
        assert conn.execute(text("SELECT nvenc_overwrite_original FROM directory_monitors WHERE id = 'legacy'")).scalar_one() == 0


def test_frame_pacing_scope_migration_defaults_existing_monitors_to_all(isolated_db):
    with isolated_db.connect() as conn:
        conn.execute(text("DROP TABLE directory_monitors"))
        conn.execute(text("CREATE TABLE directory_monitors (id TEXT PRIMARY KEY)"))
        conn.execute(text("INSERT INTO directory_monitors (id) VALUES ('legacy')"))
        conn.commit()

    dbh._ensure_directory_monitor_frame_pacing_scope_column()

    assert "frame_pacing_scope" in {column["name"] for column in inspect(isolated_db).get_columns("directory_monitors")}
    with isolated_db.connect() as conn:
        assert conn.execute(text("SELECT frame_pacing_scope FROM directory_monitors WHERE id = 'legacy'")).scalar_one() == "all"
