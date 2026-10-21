import hashlib
import json
import logging
import re
from datetime import datetime
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

from sqlalchemy import func, inspect, or_, text

from ..models.models import Schedule, ScrapedVideo, ScraperSource
from ..schemas.db_helper import close_db, get_db
from ..schemas.file import FileRecord
from ..schemas.scraper import ScrapedVideoRecord, ScraperSourceRecord
from ..utils import utc_isoformat

UNCENSORED_RE = re.compile(r"\b(?:uncensored|un(?:cen)?|uc)\b", re.IGNORECASE)
REDUCED_MOSAIC_RE = re.compile(r"\b(?:reduced[\s._-]*mosaic|reduce[\s._-]*mosaic|r18|rm)\b", re.IGNORECASE)
UNCENSORED_CODE_SUFFIX_RE = re.compile(r"(?:[-_\s](?:u|uc|uncensored|rm|r18))$", re.IGNORECASE)
RESOLUTION_RE = re.compile(r"\b(?:(2160|1440|1080|720|480)p|4k|uhd|fhd|full[\s._-]*hd|hd|sd)\b", re.IGNORECASE)


def _parse_dt(value: Optional[str]) -> Optional[datetime]:
    if value is None:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        logging.warning("Invalid datetime string for scraper: %s", value)
        return None


def normalize_scraper_url(url: str | None) -> str:
    return (url or "").strip().rstrip("/")


def video_id(source_id: str, video_code: str, source_url: str | None = None, video_url: str | None = None) -> str:
    url_part = normalize_scraper_url(source_url)
    video_part = normalize_scraper_url(video_url)
    digest = hashlib.sha256(f"{source_id}:{url_part}:{video_code.upper()}:{video_part}".encode("utf-8")).hexdigest()
    return digest[:16]


def legacy_video_id(source_id: str, video_code: str, source_url: str | None = None) -> str:
    url_part = normalize_scraper_url(source_url)
    digest = hashlib.sha256(f"{source_id}:{url_part}:{video_code.upper()}".encode("utf-8")).hexdigest()
    return digest[:16]


def _has_column(db, table_name: str, column_name: str) -> bool:
    return column_name in {column["name"] for column in inspect(db.bind).get_columns(table_name)}


def _ensure_scraped_videos_source_url_column(db) -> bool:
    if _has_column(db, "scraped_videos", "source_url"):
        return True
    db.execute(text("ALTER TABLE scraped_videos ADD COLUMN source_url TEXT"))
    db.execute(text("CREATE INDEX IF NOT EXISTS ix_scraped_videos_source_url ON scraped_videos (source_url)"))
    db.commit()
    logging.info("Migrated: added source_url column to scraped_videos")
    return True


def _hostname(value: str | None) -> str:
    try:
        return urlparse(value or "").hostname or ""
    except ValueError:
        return ""


def _optional_bool(value: object) -> bool | None:
    return value if isinstance(value, bool) else None


def _optional_str(value: object) -> str | None:
    return value if isinstance(value, str) else None


def _is_navigation_title(title: str | None) -> bool:
    if title is None:
        return False
    return title.strip() in {"<Prev", "Next>"}


def _is_uncensored_or_reduced_mosaic_name(name: str | None) -> bool:
    haystack = (name or "").strip()
    return bool(
        UNCENSORED_RE.search(haystack)
        or REDUCED_MOSAIC_RE.search(haystack)
        or UNCENSORED_CODE_SUFFIX_RE.search(Path(haystack).stem)
    )


def _resolution_from_text(*values: str | None) -> str | None:
    haystack = " ".join(value for value in values if value)
    match = RESOLUTION_RE.search(haystack)
    if not match:
        return None
    value = match.group(0).lower()
    if value in {"4k", "uhd"} or match.group(1) == "2160":
        return "4k"
    if match.group(1) == "1440":
        return "1440p"
    if value in {"fhd", "full hd", "full-hd", "full_hd"} or match.group(1) == "1080":
        return "1080p"
    if value == "hd" or match.group(1) == "720":
        return "720p"
    return "sd"


def _resolution_from_height(height: int | None) -> str | None:
    if height is None:
        return None
    if height <= 480:
        return "sd"
    if height <= 720:
        return "720p"
    if height <= 1080:
        return "1080p"
    if height <= 1440:
        return "1440p"
    return "4k"


def _parse_urls(value: str | None, fallback_url: str | None = None) -> list[str]:
    if value:
        try:
            parsed = json.loads(value)
            if isinstance(parsed, list):
                urls = [url.strip() for url in parsed if isinstance(url, str) and url.strip()]
                if urls:
                    return urls
        except json.JSONDecodeError:
            logging.warning("Invalid scraper urls JSON: %s", value)
    return [fallback_url] if fallback_url else []


def _dump_urls(urls: list[str], fallback_url: str) -> str:
    clean_urls = [url.strip() for url in urls if url.strip()]
    if not clean_urls and fallback_url.strip():
        clean_urls = [fallback_url.strip()]
    return json.dumps(clean_urls)


def _parse_url_actress_name_reversed(value: str | None, url_count: int) -> list[bool]:
    if value:
        try:
            parsed = json.loads(value)
            if isinstance(parsed, list):
                normalized = [bool(item) for item in parsed[:url_count]]
                if len(normalized) < url_count:
                    normalized.extend([False] * (url_count - len(normalized)))
                return normalized
        except json.JSONDecodeError:
            logging.warning("Invalid scraper url_actress_name_reversed JSON: %s", value)
    return [False] * url_count


def _dump_url_actress_name_reversed(flags: list[bool], url_count: int) -> str:
    normalized = [bool(flag) for flag in flags[:url_count]]
    if len(normalized) < url_count:
        normalized.extend([False] * (url_count - len(normalized)))
    return json.dumps(normalized)


def _dump_website_stats(stats: list[dict[str, object]]) -> str:
    return json.dumps(stats)


def _load_website_stats(value: str | None) -> list[dict]:
    if not value:
        return []
    try:
        parsed = json.loads(value)
        if isinstance(parsed, list):
            return [item for item in parsed if isinstance(item, dict)]
    except json.JSONDecodeError:
        logging.warning("Invalid scraper website stats JSON: %s", value)
    return []


def source_to_model(record: ScraperSourceRecord) -> ScraperSource:
    urls = _parse_urls(record.urls, record.url)
    return ScraperSource(
        id=record.id,
        name=record.name,
        url=record.url,
        urls=urls,
        urlActressNameReversed=_parse_url_actress_name_reversed(record.url_actress_name_reversed, len(urls)),
        schedule=Schedule(
            interval=record.schedule_interval,
            time=record.schedule_time,
            dayOfWeek=record.schedule_day_of_week,
            timeZone=record.schedule_timezone,
        ),
        isActive=record.is_active,
        lastRun=utc_isoformat(record.last_run) if record.last_run else None,
        nextRun=utc_isoformat(record.next_run) if record.next_run else None,
        lastFound=record.last_found,
        lastNew=record.last_new,
        lastPagesScraped=record.last_pages_scraped,
        lastWebsiteStats=_load_website_stats(record.last_website_stats),
        lastError=record.last_error,
        createdAt=utc_isoformat(record.created_at) if record.created_at else "",
    )


def _website_stats_for_source(source: ScraperSource, db_website_counts: dict[str, int]) -> list[dict]:
    existing_by_url = {
        normalize_scraper_url(_optional_str(stat.get("url"))): stat
        for stat in source.lastWebsiteStats
        if isinstance(stat, dict)
    }
    urls = source.urls or [source.url]
    return [
        {
            **existing_by_url.get(normalize_scraper_url(url), {
                "url": url,
                "pagesScraped": 0,
                "created": 0,
                "updated": 0,
            }),
            "url": url,
            "found": db_website_counts.get(normalize_scraper_url(url), 0),
        }
        for url in urls
        if normalize_scraper_url(url)
    ]


def _refresh_source_counts(source: ScraperSource) -> ScraperSource:
    db_website_counts = get_website_video_counts(source.id)
    if not db_website_counts:
        backfill_source_video_urls(source.id, source.urls or [source.url])
        db_website_counts = get_website_video_counts(source.id)
    db_total = get_source_video_count(source.id)
    update = {
        "lastFound": db_total,
    }
    if db_website_counts:
        update["lastWebsiteStats"] = _website_stats_for_source(source, db_website_counts)
    return source.model_copy(
        update=update,
    )


def video_to_model(record: ScrapedVideoRecord, file_exists: bool = False) -> ScrapedVideo:
    return ScrapedVideo(
        id=record.id,
        sourceId=record.source_id,
        videoCode=record.video_code,
        title=record.title,
        url=record.url,
        uncensored=record.uncensored,
        censored=record.censored,
        subtitled=record.subtitled,
        opened=bool(record.opened),
        openedAt=utc_isoformat(record.opened_at) if record.opened_at else None,
        fileExists=file_exists,
        scrapedAt=utc_isoformat(record.scraped_at),
        firstSeenAt=utc_isoformat(record.first_seen_at),
    )


def list_sources() -> list[ScraperSource]:
    db = get_db()
    try:
        records = db.query(ScraperSourceRecord).order_by(ScraperSourceRecord.created_at.desc()).all()
        return [_refresh_source_counts(source_to_model(record)) for record in records]
    finally:
        close_db(db)


def get_source(source_id: str) -> ScraperSource | None:
    db = get_db()
    try:
        record = db.query(ScraperSourceRecord).filter(ScraperSourceRecord.id == source_id).first()
        return _refresh_source_counts(source_to_model(record)) if record else None
    finally:
        close_db(db)


def create_source(source: ScraperSource) -> ScraperSource:
    db = get_db()
    try:
        now = _parse_dt(source.createdAt) or datetime.utcnow()
        record = ScraperSourceRecord(
            id=source.id,
            name=source.name,
            url=source.url,
            urls=_dump_urls(source.urls, source.url),
            url_actress_name_reversed=_dump_url_actress_name_reversed(source.urlActressNameReversed, len(source.urls or [source.url])),
            schedule_interval=source.schedule.interval,
            schedule_time=source.schedule.time,
            schedule_day_of_week=source.schedule.dayOfWeek,
            schedule_timezone=source.schedule.timeZone,
            is_active=source.isActive,
            last_run=_parse_dt(source.lastRun),
            next_run=_parse_dt(source.nextRun),
            last_found=source.lastFound,
            last_new=source.lastNew,
            last_pages_scraped=source.lastPagesScraped,
            last_website_stats=_dump_website_stats(source.lastWebsiteStats),
            last_error=source.lastError,
            created_at=now,
            updated_at=now,
        )
        db.add(record)
        db.commit()
        db.refresh(record)
        return source_to_model(record)
    finally:
        close_db(db)


def update_source(source: ScraperSource) -> ScraperSource | None:
    db = get_db()
    try:
        record = db.query(ScraperSourceRecord).filter(ScraperSourceRecord.id == source.id).first()
        if not record:
            return None
        record.name = source.name
        record.url = source.url
        record.urls = _dump_urls(source.urls, source.url)
        record.url_actress_name_reversed = _dump_url_actress_name_reversed(source.urlActressNameReversed, len(source.urls or [source.url]))
        record.schedule_interval = source.schedule.interval
        record.schedule_time = source.schedule.time
        record.schedule_day_of_week = source.schedule.dayOfWeek
        record.schedule_timezone = source.schedule.timeZone
        record.is_active = source.isActive
        record.last_run = _parse_dt(source.lastRun)
        record.next_run = _parse_dt(source.nextRun)
        record.last_found = source.lastFound
        record.last_new = source.lastNew
        record.last_pages_scraped = source.lastPagesScraped
        record.last_website_stats = _dump_website_stats(source.lastWebsiteStats)
        record.last_error = source.lastError
        record.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(record)
        return source_to_model(record)
    finally:
        close_db(db)


def delete_source(source_id: str) -> bool:
    db = get_db()
    try:
        record = db.query(ScraperSourceRecord).filter(ScraperSourceRecord.id == source_id).first()
        if not record:
            return False
        db.query(ScrapedVideoRecord).filter(ScrapedVideoRecord.source_id == source_id).delete()
        db.delete(record)
        db.commit()
        return True
    finally:
        close_db(db)


def list_videos(
    source_id: str | None = None,
    search: str | None = None,
    skip: int = 0,
    limit: int = 100,
    sort_by: str = "scraped_at",
    sort_dir: str = "desc",
    file_exists: bool | None = None,
    local_match_traits: bool = True,
    local_match_resolution: str | None = None,
    uncensored: bool | None = None,
    censored: bool | None = None,
    subtitled: bool | None = None,
    opened: bool | None = None,
    website: list[str] | None = None,
) -> tuple[list[ScrapedVideo], int]:
    db = get_db()
    try:
        query = db.query(ScrapedVideoRecord)
        if source_id:
            query = query.filter(ScrapedVideoRecord.source_id == source_id)
        if search:
            pattern = f"%{search}%"
            query = query.filter((ScrapedVideoRecord.video_code.ilike(pattern)) | (ScrapedVideoRecord.title.ilike(pattern)))
        if website:
            website_filters = [ScrapedVideoRecord.url.ilike(f"%{website_item}%") for website_item in website if website_item]
            if website_filters:
                query = query.filter(or_(*website_filters))
        query = query.filter(
            (ScrapedVideoRecord.title.is_(None)) | (~ScrapedVideoRecord.title.in_(["<Prev", "Next>"]))
        )
        for column, value in (
            (ScrapedVideoRecord.uncensored, uncensored),
            (ScrapedVideoRecord.censored, censored),
            (ScrapedVideoRecord.subtitled, subtitled),
            (ScrapedVideoRecord.opened, opened),
        ):
            if value is not None:
                query = query.filter(column.is_(value))
        sort_map = {
            "video_code": ScrapedVideoRecord.video_code,
            "title": ScrapedVideoRecord.title,
            "scraped_at": ScrapedVideoRecord.scraped_at,
            "first_seen_at": ScrapedVideoRecord.first_seen_at,
        }
        sort_column = sort_map.get(sort_by, ScrapedVideoRecord.scraped_at)
        direction = "asc" if sort_dir == "asc" else "desc"
        records = query.order_by(sort_column.asc() if direction == "asc" else sort_column.desc()).all()
        existing_codes = _video_codes_on_disk_or_db(
            db,
            [
                (
                    record.video_code,
                    bool(record.uncensored),
                    _resolution_from_text(record.title, record.url, record.video_code),
                )
                for record in records
            ],
            local_match_traits=local_match_traits,
            local_match_resolution=local_match_resolution,
        )
        models = [
            video_to_model(
                record,
                (
                    record.video_code,
                    bool(record.uncensored),
                    _resolution_from_text(record.title, record.url, record.video_code),
                ) in existing_codes,
            )
            for record in records
        ]
        if file_exists is not None:
            models = [video for video in models if video.fileExists == file_exists]
        total = len(models)
        return models[skip:skip + limit], total
    finally:
        close_db(db)


def _video_codes_on_disk_or_db(
    db,
    video_codes: list[tuple[str, bool, str | None]],
    local_match_traits: bool = True,
    local_match_resolution: str | None = None,
) -> set[tuple[str, bool, str | None]]:
    code_traits = [(code, is_uncensored, resolution) for code, is_uncensored, resolution in dict.fromkeys(video_codes) if code]
    codes = [code for code in dict.fromkeys(code for code, _, _ in code_traits) if code]
    if not codes:
        return set()

    filters = [FileRecord.name.ilike(f"%{code}%") for code in codes]
    rows = db.query(FileRecord.name, FileRecord.path, FileRecord.is_deleted, FileRecord.height).filter(or_(*filters)).all()

    found: set[tuple[str, bool, str | None]] = set()
    for name, path, is_deleted, height in rows:
        name_lower = (name or "").lower()
        name_is_uncensored = _is_uncensored_or_reduced_mosaic_name(name)
        name_resolution = _resolution_from_height(height) or _resolution_from_text(name)
        for code, scraped_is_uncensored, scraped_resolution in code_traits:
            if code.lower() not in name_lower:
                continue
            if not is_deleted or (path and Path(path).exists()):
                if local_match_traits and scraped_is_uncensored and not name_is_uncensored:
                    continue
                if local_match_resolution and _resolution_matches_policy(name_resolution, local_match_resolution):
                    continue
                found.add((code, scraped_is_uncensored, scraped_resolution))
    return found


def _resolution_matches_policy(local_resolution: str | None, policy: str) -> bool:
    if local_resolution is None:
        return False
    order = {"sd": 480, "720p": 720, "1080p": 1080, "1440p": 1440, "4k": 2160}
    local_height = order.get(local_resolution)
    if local_height is None:
        return False
    if policy == "480p":
        return local_height <= 480
    if policy == "720p":
        return local_height <= 720
    return local_resolution == policy


def upsert_videos(source_id: str, source_url: str, videos: list[dict[str, str | bool | None]]) -> tuple[int, int]:
    db = get_db()
    try:
        _ensure_scraped_videos_source_url_column(db)
        created = 0
        updated = 0
        now = datetime.utcnow()
        for video in videos:
            code = (_optional_str(video.get("video_code")) or "").upper()
            if not code:
                continue
            title = _optional_str(video.get("title"))
            if _is_navigation_title(title):
                continue
            url = _optional_str(video.get("url"))
            if not url:
                continue
            normalized_source_url = normalize_scraper_url(source_url)
            uncensored = _optional_bool(video.get("uncensored"))
            censored = _optional_bool(video.get("censored"))
            subtitled = _optional_bool(video.get("subtitled"))
            record_id = video_id(source_id, code, normalized_source_url, url)
            record = db.query(ScrapedVideoRecord).filter(ScrapedVideoRecord.id == record_id).first()
            if not record:
                legacy_record_id = legacy_video_id(source_id, code, normalized_source_url)
                legacy_record = db.query(ScrapedVideoRecord).filter(ScrapedVideoRecord.id == legacy_record_id).first()
                if legacy_record and normalize_scraper_url(legacy_record.url) == normalize_scraper_url(url):
                    legacy_record.id = record_id
                    record = legacy_record
            if record:
                record.source_url = normalized_source_url
                record.title = title or record.title
                record.url = url
                record.uncensored = uncensored if uncensored is not None else record.uncensored
                record.censored = censored if censored is not None else record.censored
                record.subtitled = subtitled if subtitled is not None else record.subtitled
                record.scraped_at = now
                record.updated_at = now
                updated += 1
            else:
                db.add(
                    ScrapedVideoRecord(
                        id=record_id,
                        source_id=source_id,
                        source_url=normalized_source_url,
                        video_code=code,
                        title=title,
                        url=url,
                        uncensored=uncensored,
                        censored=censored,
                        subtitled=subtitled,
                        scraped_at=now,
                        first_seen_at=now,
                        updated_at=now,
                    )
                )
                created += 1
        db.commit()
        return created, updated
    finally:
        close_db(db)


def backfill_source_video_urls(source_id: str, source_urls: list[str]) -> int:
    configured_urls = [normalize_scraper_url(url) for url in source_urls if normalize_scraper_url(url)]
    if not configured_urls:
        return 0

    db = get_db()
    try:
        _ensure_scraped_videos_source_url_column(db)
        records = (
            db.query(ScrapedVideoRecord)
            .filter(ScrapedVideoRecord.source_id == source_id)
            .filter(ScrapedVideoRecord.source_url.is_(None))
            .all()
        )
        updated = 0
        for record in records:
            video_host = _hostname(record.url)
            if not video_host:
                continue
            matches = [source_url for source_url in configured_urls if _hostname(source_url) == video_host]
            if len(matches) != 1:
                continue
            record.source_url = matches[0]
            updated += 1
        if updated:
            db.commit()
        return updated
    finally:
        close_db(db)


def get_website_video_counts(source_id: str) -> dict[str, int]:
    db = get_db()
    try:
        _ensure_scraped_videos_source_url_column(db)
        rows = (
            db.query(ScrapedVideoRecord.source_url, func.count(ScrapedVideoRecord.id))
            .filter(ScrapedVideoRecord.source_id == source_id)
            .filter(ScrapedVideoRecord.source_url.isnot(None))
            .group_by(ScrapedVideoRecord.source_url)
            .all()
        )
        return {normalize_scraper_url(source_url): int(count) for source_url, count in rows if source_url}
    finally:
        close_db(db)


def get_source_video_count(source_id: str) -> int:
    db = get_db()
    try:
        return int(
            db.query(func.count(ScrapedVideoRecord.id))
            .filter(ScrapedVideoRecord.source_id == source_id)
            .scalar()
            or 0
        )
    finally:
        close_db(db)


def mark_videos_opened(video_ids: list[str]) -> int:
    unique_ids = list(dict.fromkeys(video_id for video_id in video_ids if video_id))
    if not unique_ids:
        return 0

    db = get_db()
    try:
        now = datetime.utcnow()
        updated = (
            db.query(ScrapedVideoRecord)
            .filter(ScrapedVideoRecord.id.in_(unique_ids))
            .update(
                {
                    ScrapedVideoRecord.opened: True,
                    ScrapedVideoRecord.opened_at: now,
                    ScrapedVideoRecord.updated_at: now,
                },
                synchronize_session=False,
            )
        )
        db.commit()
        return updated
    finally:
        close_db(db)


def count_videos() -> int:
    db = get_db()
    try:
        return db.query(func.count(ScrapedVideoRecord.id)).scalar() or 0
    finally:
        close_db(db)
