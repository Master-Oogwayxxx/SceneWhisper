from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from src.crud.file import File as FileCRUD
from src.schemas import db_helper as dbh
from src.schemas.db_helper import Base
from src.schemas.directory import DirectoryRecord
from src.schemas.file import FileRecord


def test_create_file_metadata_uses_alternate_id_on_hash_collision(tmp_path, monkeypatch):
    db_path = tmp_path / "test.db"
    engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    monkeypatch.setattr(dbh, "engine", engine)
    monkeypatch.setattr(dbh, "SessionLocal", sessionmaker(autocommit=False, autoflush=False, bind=engine))
    monkeypatch.setattr("src.crud.file.generate_filename_id", lambda _name, _path: "duplicate-id")

    db = dbh.SessionLocal()
    directory = DirectoryRecord(id="dir-1", name="videos", path=str(tmp_path))
    db.add(directory)
    db.add(
        FileRecord(
            id="duplicate-id",
            name="existing.mp4",
            path=str(tmp_path / "existing.mp4"),
            size=1,
            file_type="video",
            directory_id=directory.id,
        )
    )
    db.commit()

    created = FileCRUD(db).create_file_metadata(
        name="new.mp4",
        path=str(tmp_path / "new.mp4"),
        size=2,
        file_type="video",
        directory_id=directory.id,
    )

    assert created.id != "duplicate-id"
    assert created.path == str(tmp_path / "new.mp4")
    assert db.query(FileRecord).count() == 2
    db.close()
