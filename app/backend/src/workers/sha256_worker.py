import asyncio
import hashlib
import logging
from pathlib import Path
from typing import Optional

from ..schemas.db_helper import SessionLocal
from ..schemas.file import FileRecord

_BATCH_SIZE = 10
_YIELD_BETWEEN_FILES = 0.05  # seconds — yields to event loop between hashes
_IDLE_POLL_INTERVAL = 60  # seconds — how long to sleep when no unhashed files remain


def _compute_sha256(path: str) -> Optional[str]:
    try:
        h = hashlib.sha256()
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(65536), b""):
                h.update(chunk)
        return h.hexdigest()
    except Exception as e:
        logging.warning("sha256 computation failed for %s: %s", path, e)
        return None


def _fetch_pending() -> list[tuple]:
    db = SessionLocal()
    try:
        rows = db.query(FileRecord).filter(FileRecord.sha256.is_(None)).limit(_BATCH_SIZE).all()
        return [(r.id, r.path, r.name) for r in rows]
    finally:
        db.close()


def _save_sha256_batch(updates: list[tuple[int, str]]) -> None:
    """Batch save multiple sha256 values in a single transaction."""
    if not updates:
        return
    db = SessionLocal()
    try:
        for record_id, digest in updates:
            db.query(FileRecord).filter(FileRecord.id == record_id).update({"sha256": digest})
        db.commit()
    finally:
        db.close()


async def sha256_worker() -> None:
    """Background task: compute SHA-256 for files that don't have one yet."""
    loop = asyncio.get_running_loop()

    while True:
        try:
            pending = await loop.run_in_executor(None, _fetch_pending)
            if not pending:
                await asyncio.sleep(_IDLE_POLL_INTERVAL)
                continue

            updates = []
            for record_id, record_path, record_name in pending:
                if not Path(record_path).exists():
                    updates.append((record_id, ""))
                    continue

                try:
                    digest = await loop.run_in_executor(None, _compute_sha256, record_path)
                    updates.append((record_id, digest or ""))
                    logging.debug("sha256 computed for %s", record_name)
                except Exception as e:
                    logging.warning("sha256 worker failed for %s: %s", record_path, e)

                await asyncio.sleep(_YIELD_BETWEEN_FILES)

            # Save all updates in single transaction to minimize lock time
            if updates:
                await loop.run_in_executor(None, _save_sha256_batch, updates)

        except asyncio.CancelledError:
            raise
        except Exception as e:
            logging.error("sha256_worker error: %s", e)
            await asyncio.sleep(5)
