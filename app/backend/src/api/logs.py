import asyncio
import json
import logging

from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse

from ..crud.log import get_log_count, get_logs, get_logs_since
from ..utils import utc_isoformat
from ..models.models import LogEntry, LogsResponse
from ..schemas.db_helper import SessionLocal
from ..schemas.log import LogRecord

router = APIRouter(prefix="/api")


def _record_to_entry(r: LogRecord) -> LogEntry:
    return LogEntry(
        id=r.id,
        created_at=utc_isoformat(r.created_at) if r.created_at else "",
        level=r.level,
        logger_name=r.logger_name,
        module=r.module,
        message=r.message,
        task_id=r.task_id,
        exc_text=r.exc_text,
    )


@router.get("/logs", response_model=LogsResponse)
def list_logs(
    level: str | None = Query(None),
    task_id: str | None = Query(None),
    search: str | None = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
):
    """Return paginated log entries, newest first."""
    rows = get_logs(level=level, task_id=task_id, search=search, skip=skip, limit=limit)
    total = get_log_count(level=level, task_id=task_id, search=search)
    return LogsResponse(items=[_record_to_entry(r) for r in rows], total=total)


@router.get("/logs/stream")
async def stream_logs():
    """SSE endpoint: sends last 50 entries on connect, then pushes new rows every 1 s."""

    async def event_generator():
        db = SessionLocal()
        try:
            # Seed: last 50 rows oldest-first so client renders them in order
            seed = (
                db.query(LogRecord)
                .order_by(LogRecord.id.desc())
                .limit(50)
                .all()
            )
            seed.reverse()
            last_id = seed[-1].id if seed else 0

            for row in seed:
                entry = _record_to_entry(row)
                yield f"data: {json.dumps(entry.model_dump())}\n\n"

            while True:
                await asyncio.sleep(1)
                new_rows = get_logs_since(last_id, db)
                for row in new_rows:
                    entry = _record_to_entry(row)
                    yield f"data: {json.dumps(entry.model_dump())}\n\n"
                    last_id = row.id
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logging.error(f"SSE stream error: {e}")
            yield f"event: error\ndata: {json.dumps({'error': str(e)})}\n\n"
        finally:
            db.close()

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
