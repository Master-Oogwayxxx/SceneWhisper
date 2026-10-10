import uuid
from typing import Optional

from sqlalchemy.orm import Session

from ..schemas.scene import SceneRecord


class Scene:
    def __init__(self, db: Session):
        self.db = db

    def create_scene(
        self,
        file_id: str,
        scene_number: int,
        start_frame: int,
        end_frame: int,
        start_timecode: str,
        end_timecode: str,
        start_seconds: float,
        end_seconds: float,
        duration_seconds: float,
    ) -> SceneRecord:
        """Create a scene record linked to a file."""
        record = SceneRecord(
            id=str(uuid.uuid4()),
            file_id=file_id,
            scene_number=scene_number,
            start_frame=start_frame,
            end_frame=end_frame,
            start_timecode=start_timecode,
            end_timecode=end_timecode,
            start_seconds=start_seconds,
            end_seconds=end_seconds,
            duration_seconds=duration_seconds,
        )
        self.db.add(record)
        self.db.commit()
        self.db.refresh(record)
        return record

    def bulk_create_scenes(self, scenes: list[dict]) -> list[SceneRecord]:
        """Insert multiple scene records at once. Each dict must contain all SceneRecord fields except id."""
        records = [SceneRecord(id=str(uuid.uuid4()), **s) for s in scenes]
        self.db.bulk_save_objects(records)
        self.db.commit()
        return records

    def get_scenes_for_file(self, file_id: str) -> list[SceneRecord]:
        """Return all scenes for a file ordered by scene_number."""
        return (
            self.db.query(SceneRecord)
            .filter(SceneRecord.file_id == file_id)
            .order_by(SceneRecord.scene_number)
            .all()
        )

    def renumber_scenes_for_file(self, file_id: str) -> list[SceneRecord]:
        """Renumber scenes for a file in chronological order."""
        records = (
            self.db.query(SceneRecord)
            .filter(SceneRecord.file_id == file_id)
            .order_by(SceneRecord.start_seconds, SceneRecord.end_seconds, SceneRecord.scene_number)
            .all()
        )
        for index, record in enumerate(records, start=1):
            record.scene_number = index
        self.db.commit()
        return records

    def get_scene(self, scene_id: str) -> Optional[SceneRecord]:
        """Return a single scene by its primary key."""
        return self.db.query(SceneRecord).filter(SceneRecord.id == scene_id).first()

    def update_scene(self, scene_id: str, start_timecode: str, end_timecode: str) -> Optional[SceneRecord]:
        """Update a scene's start/end timecodes and derived seconds/duration."""
        record = self.get_scene(scene_id)
        if not record:
            return None

        def _tc_to_seconds(tc: str) -> float:
            parts = tc.replace(',', '.').split(':')
            h, m, s = float(parts[0]), float(parts[1]), float(parts[2])
            return h * 3600 + m * 60 + s

        start_s = _tc_to_seconds(start_timecode)
        end_s = _tc_to_seconds(end_timecode)
        record.start_timecode = start_timecode
        record.end_timecode = end_timecode
        record.start_seconds = start_s
        record.end_seconds = end_s
        record.duration_seconds = max(0.0, end_s - start_s)
        self.db.commit()
        self.renumber_scenes_for_file(record.file_id)
        self.db.refresh(record)
        return record

    def delete_scenes_for_file(self, file_id: str) -> int:
        """Delete all scenes for a file. Returns number of rows deleted."""
        deleted = (
            self.db.query(SceneRecord)
            .filter(SceneRecord.file_id == file_id)
            .delete(synchronize_session=False)
        )
        self.db.commit()
        return deleted

    def scene_count_for_file(self, file_id: str) -> int:
        """Return the number of detected scenes for a file."""
        return self.db.query(SceneRecord).filter(SceneRecord.file_id == file_id).count()

    def delete_scene(self, scene_id: str) -> bool:
        """Delete a scene by ID. Returns True if found and deleted, False otherwise."""
        record = self.get_scene(scene_id)
        if not record:
            return False

        file_id = record.file_id
        deleted = self.db.query(SceneRecord).filter(SceneRecord.id == scene_id).delete(synchronize_session=False)
        self.db.commit()
        self.renumber_scenes_for_file(file_id)
        return deleted > 0

    def create_scene_simple(self, file_id: str, start_timecode: str, end_timecode: str) -> Optional[SceneRecord]:
        """Create a new scene with just timecodes. Calculates other fields automatically."""
        def _tc_to_seconds(tc: str) -> float:
            parts = tc.replace(',', '.').split(':')
            h, m, s = float(parts[0]), float(parts[1]), float(parts[2])
            return h * 3600 + m * 60 + s

        start_s = _tc_to_seconds(start_timecode)
        end_s = _tc_to_seconds(end_timecode)
        duration_s = max(0.0, end_s - start_s)

        scenes = self.get_scenes_for_file(file_id)
        next_scene_number = max([s.scene_number for s in scenes], default=0) + 1

        scene = self.create_scene(
            file_id=file_id,
            scene_number=next_scene_number,
            start_frame=0,
            end_frame=0,
            start_timecode=start_timecode,
            end_timecode=end_timecode,
            start_seconds=start_s,
            end_seconds=end_s,
            duration_seconds=duration_s,
        )
        self.renumber_scenes_for_file(file_id)
        self.db.refresh(scene)
        return scene
