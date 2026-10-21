import asyncio
from datetime import datetime
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException, Query, Response

from ..crud import scraper as scraper_crud
from ..models.models import ScrapedVideosResponse, ScraperOpenedVideosRequest, ScraperRunRequest, ScraperRunResponse, ScraperSource
from ..models.notification import NotificationType
from ..notification_service import emit_notification
from ..utils import calculate_next_run, utc_isoformat
from ..workers.scraper_scheduler import cancel_scraper_source, get_scraper_progress, run_scraper_source

router = APIRouter(prefix="/api/scraper")


def scraper_run_target_label(selected_urls: list[str] | None, source: ScraperSource) -> str:
    if selected_urls is not None and len(selected_urls) == 1:
        hostname = urlparse(selected_urls[0]).hostname
        return hostname.removeprefix("www.") if hostname else selected_urls[0]

    website_count = len(selected_urls) if selected_urls is not None else len(source.urls or [source.url])
    return f"{website_count} website{'s' if website_count != 1 else ''}"


@router.get("/sources", response_model=list[ScraperSource])
async def list_sources():
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, scraper_crud.list_sources)


@router.get("/sources/progress")
async def list_source_progress():
    return get_scraper_progress()


@router.post("/sources", response_model=ScraperSource)
async def create_source(source: ScraperSource):
    try:
        next_run = calculate_next_run(source.schedule.model_dump())
        source = source.model_copy(
            update={
                "nextRun": utc_isoformat(next_run),
                "createdAt": source.createdAt or utc_isoformat(datetime.utcnow()),
            }
        )
        return scraper_crud.create_source(source)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.put("/sources/{source_id}", response_model=ScraperSource)
async def update_source(source_id: str, source: ScraperSource):
    if source.id != source_id:
        raise HTTPException(status_code=400, detail="ID in path does not match ID in payload")
    try:
        next_run = calculate_next_run(source.schedule.model_dump())
        updated = scraper_crud.update_source(source.model_copy(update={"nextRun": utc_isoformat(next_run)}))
        if not updated:
            raise HTTPException(status_code=404, detail="Scraper source not found")
        return updated
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.delete("/sources/{source_id}", status_code=204)
async def delete_source(source_id: str):
    if not scraper_crud.delete_source(source_id):
        raise HTTPException(status_code=404, detail="Scraper source not found")
    return Response(status_code=204)


@router.post("/sources/{source_id}/run", response_model=ScraperRunResponse)
async def run_source(source_id: str, body: ScraperRunRequest | None = None):
    loop = asyncio.get_running_loop()
    source = await loop.run_in_executor(None, scraper_crud.get_source, source_id)
    if not source:
        raise HTTPException(status_code=404, detail="Scraper source not found")
    try:
        selected_urls = None
        if body and body.urls is not None:
            configured_urls = list(dict.fromkeys(url.strip() for url in (source.urls or [source.url]) if url.strip()))
            requested_urls = list(dict.fromkeys(url.strip() for url in body.urls if url.strip()))
            selected_urls = [url for url in requested_urls if url in configured_urls]
            if len(selected_urls) != len(requested_urls):
                raise HTTPException(status_code=400, detail="Selected scraper website is not configured for this source")
            if not selected_urls:
                raise HTTPException(status_code=400, detail="Select at least one scraper website")
        found, created, updated, pages_scraped = await run_scraper_source(source, selected_urls)
        target_label = scraper_run_target_label(selected_urls, source)
        await emit_notification(
            NotificationType.SCRAPER_COMPLETED,
            "Scraper run complete",
            f"{source.name}: {created} new, {updated} updated, {found} found across {target_label}",
        )
        return {"status": "completed", "found": found, "created": created, "updated": updated, "pagesScraped": pages_scraped}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/sources/{source_id}/cancel")
async def cancel_source(source_id: str):
    if not cancel_scraper_source(source_id):
        raise HTTPException(status_code=404, detail="Scraper source is not currently running")
    return {"status": "cancelled"}


@router.get("/videos", response_model=ScrapedVideosResponse)
async def list_videos(
    source_id: str | None = Query(default=None),
    search: str | None = Query(default=None),
    sort_by: str = Query(default="scraped_at", pattern="^(video_code|title|scraped_at|first_seen_at)$"),
    sort_dir: str = Query(default="desc", pattern="^(asc|desc)$"),
    file_exists: bool | None = Query(default=None),
    local_match_traits: bool = Query(default=True),
    local_match_resolution: str | None = Query(default=None, pattern="^(480p|720p|1080p|1440p|4k)$"),
    uncensored: bool | None = Query(default=None),
    censored: bool | None = Query(default=None),
    subtitled: bool | None = Query(default=None),
    opened: bool | None = Query(default=None),
    website: list[str] | None = Query(default=None),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=25, ge=1, le=500),
):
    loop = asyncio.get_running_loop()
    items, total = await loop.run_in_executor(
        None,
        scraper_crud.list_videos,
        source_id,
        search,
        skip,
        limit,
        sort_by,
        sort_dir,
        file_exists,
        local_match_traits,
        local_match_resolution,
        uncensored,
        censored,
        subtitled,
        opened,
        website,
    )
    return {"items": items, "total": total, "skip": skip, "limit": limit}


@router.patch("/videos/opened")
async def mark_videos_opened(body: ScraperOpenedVideosRequest):
    loop = asyncio.get_running_loop()
    updated = await loop.run_in_executor(None, scraper_crud.mark_videos_opened, body.ids)
    return {"updated": updated}
