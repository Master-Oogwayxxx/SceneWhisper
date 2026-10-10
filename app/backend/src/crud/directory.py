import os
from pathlib import Path
from typing import List, Optional

from sqlalchemy.orm import Session

from ..models.models import Directory
from ..schemas.directory import DirectoryRecord
from ..schemas.file import FileRecord
from ..utils import generate_filename_id


class Directory:
    def __init__(self, db: Session):
        self.db = db

    def create_directory_record(self, name: str, path: str, parent_id: Optional[str] = None) -> DirectoryRecord:
        """Create a directory record in the database"""
        directory_id = generate_filename_id(name, path)
        directory_record = DirectoryRecord(id=directory_id, name=name, path=path, parent_id=parent_id)
        self.db.add(directory_record)
        self.db.commit()
        self.db.refresh(directory_record)
        return directory_record

    def get_or_create_directory(self, name: str, path: str, parent_id: Optional[str] = None) -> DirectoryRecord:
        """Get existing directory or create new one"""
        # Create tables if they don't exist

        existing = self.db.query(DirectoryRecord).filter(DirectoryRecord.path == path).first()
        if existing:
            return existing

        return self.create_directory_record(name, path, parent_id)

    def scan_directory(self, path: str, progress_callback=None) -> Directory:
        """Scan a directory and create metadata records"""
        # Create directory record if it doesn't exist
        directory_name = Path(path).name or "root"
        directory_record = self.get_or_create_directory(directory_name, path)

        # Get all files in the directory
        entries = list(os.scandir(path))
        files_to_process = []
        subdirectorys = []

        for entry in entries:
            full_path = str(entry.path)
            if entry.is_dir() and entry.name != "scenes":
                subdirectorys.append(Directory(id=generate_filename_id(entry.name, full_path), name=entry.name, path=full_path, files=[], subdirectorys=[]))
            elif entry.is_file() and Path(entry.name).suffix.lower() in {".mp4", ".avi", ".mov", ".mkv", ".flv", ".wmv"}:
                files_to_process.append(entry)

        # Sort subdirectories alphabetically
        subdirectorys.sort(key=lambda x: x.name.lower())

        # Process video files to extract metadata
        processed_files = []
        total_files = len(files_to_process)

        for i, entry in enumerate(files_to_process):
            stats = entry.stat()
            file_metadata = self.create_file_metadata(name=entry.name, path=str(entry.path), size=stats.st_size, file_type="video", directory_id=directory_record.id)
            processed_files.append(file_metadata)

            # Report progress if callback is provided
            if progress_callback and total_files > 0:
                progress = (i + 1) / total_files * 100
                progress_callback(progress, f"Processing file {entry.name}")

        return Directory(id=directory_record.id, name=directory_name, path=path, files=processed_files, subdirectorys=subdirectorys)

    def get_directory_hierarchy(self, directory_id: str = None, path: str = None) -> List[DirectoryRecord]:
        """Get directory hierarchy from database"""
        if directory_id:
            return self.db.query(DirectoryRecord).filter(DirectoryRecord.id == directory_id).all()
        elif path:
            return self.db.query(DirectoryRecord).filter(DirectoryRecord.path == path).all()
        else:
            return sorted(self.db.query(DirectoryRecord).all(), key=lambda x: x.name.lower())

    def get_directory_files(self, directory_id: str) -> List[FileRecord]:
        """Get files associated with a directory"""
        return self.db.query(FileRecord).filter(FileRecord.directory_id == directory_id).all()

    def get_file_metadata(self, file_id: str = None, path: str = None) -> List[FileRecord]:
        """Get file metadata from database"""
        if file_id:
            return self.db.query(FileRecord).filter(FileRecord.id == file_id).all()
        elif path:
            return self.db.query(FileRecord).filter(FileRecord.path == path).all()
        else:
            return self.db.query(FileRecord).all()
