import sqlalchemy

import src.schemas.db_helper as dbh
from src.crud.scene import Scene
from src.schemas.db_helper import Base


def test_delete_scene_renumbers_remaining_scenes(tmp_path, monkeypatch):
    db_path = tmp_path / "test.db"
    engine = sqlalchemy.create_engine(
        f"sqlite:///{db_path}",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(bind=engine)
    monkeypatch.setattr(dbh, "engine", engine)
    monkeypatch.setattr(dbh, "SessionLocal", sqlalchemy.orm.sessionmaker(autocommit=False, autoflush=False, bind=engine))

    db = dbh.SessionLocal()
    service = Scene(db)

    service.create_scene_simple("file-1", "00:00:00.000", "00:01:00.000")
    deleted_scene = service.create_scene_simple("file-1", "00:01:00.000", "00:02:00.000")
    service.create_scene_simple("file-1", "00:02:00.000", "00:03:00.000")

    assert deleted_scene is not None
    assert service.delete_scene(deleted_scene.id) is True

    scenes = service.get_scenes_for_file("file-1")

    assert [(scene.scene_number, scene.start_timecode) for scene in scenes] == [
        (1, "00:00:00.000"),
        (2, "00:02:00.000"),
    ]

    db.close()


def test_create_scene_simple_renumbers_scenes_chronologically(tmp_path, monkeypatch):
    db_path = tmp_path / "test.db"
    engine = sqlalchemy.create_engine(
        f"sqlite:///{db_path}",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(bind=engine)
    monkeypatch.setattr(dbh, "engine", engine)
    monkeypatch.setattr(dbh, "SessionLocal", sqlalchemy.orm.sessionmaker(autocommit=False, autoflush=False, bind=engine))

    db = dbh.SessionLocal()
    service = Scene(db)

    service.create_scene_simple("file-1", "00:00:00.000", "00:01:00.000")
    service.create_scene_simple("file-1", "00:02:00.000", "00:03:00.000")
    inserted = service.create_scene_simple("file-1", "00:01:00.000", "00:02:00.000")

    scenes = service.get_scenes_for_file("file-1")

    assert inserted is not None
    assert inserted.scene_number == 2
    assert [(scene.scene_number, scene.start_timecode) for scene in scenes] == [
        (1, "00:00:00.000"),
        (2, "00:01:00.000"),
        (3, "00:02:00.000"),
    ]

    db.close()


def test_update_scene_renumbers_scenes_chronologically(tmp_path, monkeypatch):
    db_path = tmp_path / "test.db"
    engine = sqlalchemy.create_engine(
        f"sqlite:///{db_path}",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(bind=engine)
    monkeypatch.setattr(dbh, "engine", engine)
    monkeypatch.setattr(dbh, "SessionLocal", sqlalchemy.orm.sessionmaker(autocommit=False, autoflush=False, bind=engine))

    db = dbh.SessionLocal()
    service = Scene(db)

    service.create_scene_simple("file-1", "00:00:00.000", "00:01:00.000")
    moved_scene = service.create_scene_simple("file-1", "00:02:00.000", "00:03:00.000")
    service.create_scene_simple("file-1", "00:03:00.000", "00:04:00.000")

    assert moved_scene is not None
    service.update_scene(moved_scene.id, "00:01:00.000", "00:02:00.000")

    scenes = service.get_scenes_for_file("file-1")

    assert [(scene.scene_number, scene.start_timecode) for scene in scenes] == [
        (1, "00:00:00.000"),
        (2, "00:01:00.000"),
        (3, "00:03:00.000"),
    ]

    db.close()
