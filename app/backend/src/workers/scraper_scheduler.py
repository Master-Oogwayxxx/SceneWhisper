import asyncio
import html
import logging
import random
import re
import time
from threading import Event
from datetime import datetime, timezone
from collections.abc import Callable
from urllib.error import HTTPError
from urllib.parse import parse_qs, quote, urljoin, urlparse
from urllib.request import Request, urlopen

from ..crud import scraper as scraper_crud
from ..models.models import ScraperSource
from ..ws_manager import ws_manager
from ..utils import calculate_next_run, utc_isoformat

VIDEO_CODE_RE = re.compile(r"\b([A-Z]{2,8}[-_]\d{2,6})(?:[-_](?:RM|SUB|UN))?\b", re.IGNORECASE)
LINK_RE = re.compile(r"<a\b[^>]*href=[\"']([^\"']+)[\"'][^>]*>(.*?)</a>", re.IGNORECASE | re.DOTALL)
REL_NEXT_RE = re.compile(r"\brel=[\"'][^\"']*\bnext\b[^\"']*[\"']", re.IGNORECASE)
PAGE_PATH_RE = re.compile(r"/(?:page|p)/\d+/?$|/[^/]*\d+/?$", re.IGNORECASE)
TRAILING_NUMBER_RE = re.compile(r"(\d+)(?:/)?$")
PAGINATION_UL_RE = re.compile(r"<ul\b[^>]*class=[\"'][^\"']*\bpagination\b[^\"']*[\"'][^>]*>(.*?)</ul>", re.IGNORECASE | re.DOTALL)
LI_LINK_RE = re.compile(r"<li\b[^>]*>.*?<a\b[^>]*href=[\"']([^\"']+)[\"'][^>]*>(.*?)</a>.*?</li>", re.IGNORECASE | re.DOTALL)
TAG_RE = re.compile(r"<[^>]+>")
REDUCED_MOSAIC_RE = re.compile(r"\breduc(?:ed|ing)\s+mosaic\b", re.IGNORECASE)
UNCENSORED_RE = re.compile(r"\b(?:de|un)censored\b", re.IGNORECASE)
ENGLISH_SUBTITLES_RE = re.compile(r"\benglish\s+subtitles?\b", re.IGNORECASE)
UNCENSORED_CODE_SUFFIX_RE = re.compile(r"\b[A-Z]{2,8}[-_]\d{2,6}[-_](?:RM|UN)\b", re.IGNORECASE)
SUB_CODE_SUFFIX_RE = re.compile(r"\b[A-Z]{2,8}[-_]\d{2,6}[-_]SUB\b", re.IGNORECASE)
MAX_CRAWL_PAGES = 150
MIN_PAGE_DELAY_SECONDS = 5.0
MAX_PAGE_DELAY_SECONDS = 10.0
TRANSIENT_RETRY_DELAY_SECONDS = 60.0
TRANSIENT_RETRY_STATUS_CODES = {429, 503}
BLOCKED_STATUS_CODES = {403, 404, 429}
_SCRAPER_CANCEL_EVENTS: dict[str, Event] = {}
_SCRAPER_PROGRESS: dict[str, dict[str, object]] = {}


def _plain_text(value: str) -> str:
    return html.unescape(TAG_RE.sub(" ", value)).strip()


def _actress_name_parts(actress_name: str | None) -> list[str]:
    if not actress_name:
        return []
    return [part.lower() for part in re.split(r"[\s\-_]+", actress_name.strip()) if part]


def _build_reversed_name_retry_url(url: str, actress_name: str | None) -> str | None:
    parts = _actress_name_parts(actress_name)
    if len(parts) < 2:
        return None

    original_parts = parts
    reversed_parts = list(reversed(parts))
    if reversed_parts == original_parts:
        return None

    replacements = [
        ("-".join(original_parts), "-".join(reversed_parts)),
        ("_".join(original_parts), "_".join(reversed_parts)),
        (" ".join(original_parts), " ".join(reversed_parts)),
        (quote("-".join(original_parts)), quote("-".join(reversed_parts))),
        (quote("_".join(original_parts)), quote("_".join(reversed_parts))),
        (quote(" ".join(original_parts)), quote(" ".join(reversed_parts))),
    ]

    for old_value, new_value in replacements:
        if old_value and old_value in url:
            retried_url = url.replace(old_value, new_value, 1)
            if retried_url != url:
                return retried_url
    return None


def _set_url_orientation(
    urls: list[str],
    flags: list[bool],
    original_url: str,
    updated_url: str,
    reversed_order: bool,
) -> tuple[list[str], list[bool]]:
    next_urls = list(urls)
    next_flags = list(flags[: len(next_urls)])
    if len(next_flags) < len(next_urls):
        next_flags.extend([False] * (len(next_urls) - len(next_flags)))

    try:
        index = next_urls.index(original_url)
    except ValueError:
        return next_urls, next_flags

    next_urls[index] = updated_url
    next_flags[index] = reversed_order
    return next_urls, next_flags


def _is_navigation_title(title: str | None) -> bool:
    if title is None:
        return False
    normalized = _plain_text(title)
    return normalized in {"<Prev", "Next>"}


def _video_traits(*values: str | None) -> dict[str, bool]:
    haystack = " ".join(value for value in values if value)
    uncensored = bool(REDUCED_MOSAIC_RE.search(haystack) or UNCENSORED_RE.search(haystack) or UNCENSORED_CODE_SUFFIX_RE.search(haystack))
    subtitled = bool(ENGLISH_SUBTITLES_RE.search(haystack) or SUB_CODE_SUFFIX_RE.search(haystack))
    return {
        "uncensored": uncensored,
        "censored": not uncensored,
        "subtitled": subtitled,
    }


def _fetch_page(url: str) -> str:
    request = Request(url, headers={"User-Agent": "SceneWhisper/1.0"})
    with urlopen(request, timeout=30) as response:
        charset = response.headers.get_content_charset() or "utf-8"
        return response.read().decode(charset, errors="replace")


def _sleep_between_page_requests() -> None:
    time.sleep(random.uniform(MIN_PAGE_DELAY_SECONDS, MAX_PAGE_DELAY_SECONDS))


def _is_cancelled(source_id: str) -> bool:
    cancel_event = _SCRAPER_CANCEL_EVENTS.get(source_id)
    return bool(cancel_event and cancel_event.is_set())


def cancel_scraper_source(source_id: str) -> bool:
    cancel_event = _SCRAPER_CANCEL_EVENTS.get(source_id)
    if not cancel_event:
        return False
    cancel_event.set()
    return True


def get_scraper_progress() -> list[dict[str, object]]:
    return list(_SCRAPER_PROGRESS.values())


def _is_timeout_error(exc: Exception) -> bool:
    return isinstance(exc, TimeoutError)


def _is_transient_fetch_error(exc: Exception) -> bool:
    status_code = _http_error_status_code(exc)
    return status_code in TRANSIENT_RETRY_STATUS_CODES or _is_timeout_error(exc)


def _fetch_page_with_retry(url: str) -> str:
    try:
        return _fetch_page(url)
    except Exception as exc:
        if not _is_transient_fetch_error(exc):
            raise
        logging.warning(
            "scraper transient fetch failure for %s (%s); retrying in %.0f seconds",
            url,
            _http_error_status_code(exc) or str(exc),
            TRANSIENT_RETRY_DELAY_SECONDS,
        )
        time.sleep(TRANSIENT_RETRY_DELAY_SECONDS)
        return _fetch_page(url)


def _is_skippable_http_error(exc: Exception) -> bool:
    if isinstance(exc, HTTPError):
        return True
    code = getattr(exc, "code", None)
    if isinstance(code, int):
        return True
    status = getattr(exc, "status", None)
    return isinstance(status, int)


def _http_error_status_code(exc: Exception) -> int | None:
    if isinstance(exc, HTTPError):
        return exc.code
    code = getattr(exc, "code", None)
    if isinstance(code, int):
        return code
    status = getattr(exc, "status", None)
    return status if isinstance(status, int) else None


def _summarize_skipped_websites(blocked_count: int, http_error_count: int, error_count: int) -> str | None:
    parts: list[str] = []
    if blocked_count:
        parts.append(f"Skipped {blocked_count} blocked scraper website(s)")
    if http_error_count:
        parts.append(f"Skipped {http_error_count} scraper website(s) due to HTTP errors")
    if error_count:
        parts.append(f"Skipped {error_count} scraper website(s) due to scraper errors")
    return "; ".join(parts) if parts else None


def _normalized_url(url: str) -> str:
    parsed = urlparse(url)
    query = parsed.query
    return parsed._replace(fragment="", query=query).geturl()


def _is_same_site(candidate_url: str, source_url: str) -> bool:
    candidate = urlparse(candidate_url)
    source = urlparse(source_url)
    return candidate.scheme in {"http", "https"} and candidate.netloc == source.netloc


def _is_within_source_page(candidate_url: str, source_url: str) -> bool:
    candidate = urlparse(candidate_url)
    source = urlparse(source_url)
    source_path = source.path.rstrip("/")
    candidate_path = candidate.path.rstrip("/")
    if not source_path:
        return True
    return candidate_path == source_path or candidate_path.startswith(f"{source_path}/")


def _looks_like_pagination(href: str, label: str, attrs: str) -> bool:
    label_text = label.strip().lower()
    if REL_NEXT_RE.search(attrs) or label_text in {"next", "next page", ">", ">>", "more"}:
        return True
    if label_text.isdigit():
        return True

    parsed = urlparse(href)
    query = parse_qs(parsed.query)
    if any(name.lower() in {"page", "p", "pg", "paged"} for name in query):
        return True
    return bool(PAGE_PATH_RE.search(parsed.path))


def discover_page_links(page_html: str, current_url: str, source_url: str) -> list[str]:
    links: list[str] = []
    seen: set[str] = set()
    for anchor_match in LINK_RE.finditer(page_html):
        href, label_html = anchor_match.groups()
        label = _plain_text(label_html)
        absolute = _normalized_url(urljoin(current_url, html.unescape(href)))
        if absolute in seen:
            continue
        if not _is_same_site(absolute, source_url):
            continue
        if not _is_within_source_page(absolute, source_url):
            continue
        if not _looks_like_pagination(absolute, label, anchor_match.group(0)):
            continue
        seen.add(absolute)
        links.append(absolute)
    return links


def _page_number_from_url(url: str) -> int | None:
    parsed = urlparse(url)
    query = parse_qs(parsed.query)
    for key in ("page", "p", "pg", "paged"):
        values = query.get(key) or query.get(key.upper())
        if values:
            try:
                return int(values[0])
            except ValueError:
                pass

    path = parsed.path.rstrip("/")
    last_segment = path.split("/")[-1] if path else ""
    match = TRAILING_NUMBER_RE.search(last_segment)
    if match:
        try:
            return int(match.group(1))
        except ValueError:
            return None
    return None


def estimate_total_pages(page_html: str, current_url: str, source_url: str) -> int:
    pagination_matches = PAGINATION_UL_RE.findall(page_html)
    if pagination_matches:
        for pagination_html in pagination_matches:
            page_numbers: list[int] = []
            for li_match in LI_LINK_RE.finditer(pagination_html):
                last_href, last_label_html = li_match.groups()
                last_label = _plain_text(last_label_html)
                last_url = _normalized_url(urljoin(current_url, html.unescape(last_href)))
                if not _is_same_site(last_url, source_url):
                    continue
                if not _is_within_source_page(last_url, source_url):
                    continue
                if not _looks_like_pagination(last_url, last_label, li_match.group(0)):
                    continue
                last_page = _page_number_from_url(last_url)
                if last_page is None and last_label.isdigit():
                    last_page = int(last_label)
                if last_page is not None:
                    page_numbers.append(last_page)
            if page_numbers:
                return min(MAX_CRAWL_PAGES, max(1, max(page_numbers)))

    page_numbers = [_page_number_from_url(current_url)]
    for link in discover_page_links(page_html, current_url, source_url):
        page_numbers.append(_page_number_from_url(link))
    page_numbers = [number for number in page_numbers if number is not None]
    return min(MAX_CRAWL_PAGES, max(page_numbers)) if page_numbers else 1


def extract_videos(page_html: str, base_url: str) -> list[dict[str, str | bool | None]]:
    videos: dict[str, dict[str, str | bool | None]] = {}
    for match in VIDEO_CODE_RE.finditer(page_html):
        code = match.group(1).replace("_", "-").upper()
        videos.setdefault(
            code,
            {
                "video_code": code,
                "title": None,
                "url": None,
                **_video_traits(match.group(0)),
            },
        )

    for href, label_html in LINK_RE.findall(page_html):
        label = _plain_text(label_html)
        if _is_navigation_title(label):
            continue
        haystack = f"{href} {label}"
        for match in VIDEO_CODE_RE.finditer(haystack):
            code = match.group(1).replace("_", "-").upper()
            video_url = urljoin(base_url, href)
            video_key = f"{code}:{_normalized_url(video_url)}"
            existing = videos.get(video_key) or videos.get(code, {})
            traits = _video_traits(match.group(0), href, label)
            videos[video_key] = {
                "video_code": code,
                "title": label or existing.get("title"),
                "url": video_url,
                "uncensored": bool(existing.get("uncensored")) or traits["uncensored"],
                "censored": not (bool(existing.get("uncensored")) or traits["uncensored"]),
                "subtitled": bool(existing.get("subtitled")) or traits["subtitled"],
            }

    linked_codes = {
        str(video.get("video_code"))
        for key, video in videos.items()
        if ":" in key and video.get("url")
    }
    return [
        video
        for key, video in videos.items()
        if not (":" not in key and str(video.get("video_code")) in linked_codes)
    ]


def scrape_all_pages(
    source_url: str,
    source_id: str,
    progress_callback: Callable[[str, int, int], None] | None = None,
) -> tuple[list[dict[str, str | None]], int]:
    pending = [_normalized_url(source_url)]
    visited: set[str] = set()
    videos: dict[str, dict[str, str | None]] = {}
    total_pages_estimate = 1

    while pending and len(visited) < MAX_CRAWL_PAGES:
        if _is_cancelled(source_id):
            break
        current_url = pending.pop(0)
        if current_url in visited:
            continue
        if visited:
            _sleep_between_page_requests()
        visited.add(current_url)

        page_html = _fetch_page_with_retry(current_url)
        total_pages_estimate = max(total_pages_estimate, estimate_total_pages(page_html, current_url, source_url))
        for video in extract_videos(page_html, current_url):
            code = video["video_code"]
            if code:
                video_url = video.get("url")
                key = f"{code}:{_normalized_url(video_url)}" if isinstance(video_url, str) and video_url else code
                videos[key] = {**videos.get(key, {}), **video}

        for page_url in discover_page_links(page_html, current_url, source_url):
            if page_url not in visited and page_url not in pending:
                pending.append(page_url)

        if progress_callback:
            progress_callback(current_url, len(visited), total_pages_estimate)

    if pending:
        logging.warning("Scraper reached page crawl limit of %s for %s", MAX_CRAWL_PAGES, source_url)

    return list(videos.values()), len(visited)


def scrape_all_pages_with_name_fallback(
    source_url: str,
    source_id: str,
    actress_name: str | None,
    progress_callback: Callable[[str, int, int], None] | None = None,
) -> tuple[list[dict[str, str | None]], int, str]:
    try:
        videos, pages_scraped = scrape_all_pages(source_url, source_id, progress_callback=progress_callback)
        return videos, pages_scraped, source_url
    except Exception as exc:
        if _is_skippable_http_error(exc) or _is_timeout_error(exc):
            raise
        retry_url = _build_reversed_name_retry_url(source_url, actress_name)
        if not retry_url:
            raise
        logging.info("scraper retrying %s with reversed actress name URL %s", source_url, retry_url)
        videos, pages_scraped = scrape_all_pages(retry_url, source_id, progress_callback=progress_callback)
        return videos, pages_scraped, retry_url


async def run_scraper_source(source: ScraperSource, selected_urls: list[str] | None = None) -> tuple[int, int, int, int]:
    loop = asyncio.get_running_loop()
    source_urls: list[str] = []
    website_stats: list[dict[str, object]] = []
    cancel_event = Event()
    _SCRAPER_CANCEL_EVENTS[source.id] = cancel_event
    try:
        async def emit_progress(source_url: str, current_url: str, pages_scraped: int, total_pages: int) -> None:
            _SCRAPER_PROGRESS[source.id] = {
                "sourceId": source.id,
                "sourceName": source.name,
                "sourceUrl": source_url,
                "currentUrl": current_url,
                "pagesScraped": pages_scraped,
                "totalPages": total_pages,
                "progress": round((pages_scraped / total_pages) * 100, 2) if total_pages else 0,
            }
            await ws_manager.broadcast({
                "event": "scraper_progress",
                "data": _SCRAPER_PROGRESS[source.id],
            })

        def make_progress_callback(source_url: str):
            def _progress_callback(current_url: str, pages_scraped: int, total_pages: int) -> None:
                asyncio.run_coroutine_threadsafe(
                    emit_progress(source_url, current_url, pages_scraped, total_pages),
                    loop,
                )

            return _progress_callback

        source_urls = list(dict.fromkeys(url.strip() for url in (selected_urls or source.urls or [source.url]) if url.strip()))
        source_all_urls = list(dict.fromkeys(url.strip() for url in (source.urls or [source.url]) if url.strip()))
        source_url_flags = list(source.urlActressNameReversed)
        videos_by_key: dict[str, dict[str, str | bool | None]] = {}
        seen_video_keys: set[str] = set()
        pages_scraped = 0
        blocked_count = 0
        http_error_count = 0
        error_count = 0
        for source_url in source_urls:
            try:
                videos, scraped_pages, scraped_url = await loop.run_in_executor(
                    None,
                    scrape_all_pages_with_name_fallback,
                    source_url,
                    source.id,
                    source.name,
                    make_progress_callback(source_url),
                )
                if scraped_url != source_url:
                    source_all_urls, source_url_flags = _set_url_orientation(
                        source_all_urls,
                        source_url_flags,
                        source_url,
                        scraped_url,
                        True,
                    )
            except Exception as exc:
                status_code = _http_error_status_code(exc)
                is_http_error = _is_skippable_http_error(exc)
                is_blocked_website = status_code in BLOCKED_STATUS_CODES
                if is_blocked_website:
                    blocked_count += 1
                elif is_http_error:
                    http_error_count += 1
                else:
                    error_count += 1
                website_stats.append(
                    {
                        "url": source_url,
                        "pagesScraped": 0,
                        "found": 0,
                        "created": 0,
                        "updated": 0,
                        "blocked": is_blocked_website,
                    }
                )
                logging.warning(
                    "scraper source %s skipped failed website %s (%s)",
                    source.id,
                    source_url,
                    status_code or str(exc),
                )
                continue
            if cancel_event.is_set():
                break
            pages_scraped += scraped_pages
            unique_videos: list[dict[str, str | bool | None]] = []
            for video in videos:
                code = video.get("video_code")
                video_url = video.get("url")
                video_key = f"{code}:{_normalized_url(video_url)}" if isinstance(video_url, str) and video_url else str(code)
                if not code or video_key in seen_video_keys:
                    continue
                seen_video_keys.add(video_key)
                unique_videos.append(video)
            site_created, site_updated = await loop.run_in_executor(None, scraper_crud.upsert_videos, source.id, scraped_url, videos)
            website_stats.append(
                {
                    "url": scraped_url,
                    "pagesScraped": scraped_pages,
                    "found": len(videos),
                    "created": site_created,
                    "updated": site_updated,
                    "blocked": False,
                }
            )
            for video in unique_videos:
                code = video.get("video_code")
                if code:
                    video_url = video.get("url")
                    video_key = f"{code}:{_normalized_url(video_url)}" if isinstance(video_url, str) and video_url else str(code)
                    videos_by_key[video_key] = {**videos_by_key.get(video_key, {}), **video}
        videos = list(videos_by_key.values())
        created = sum(int(stat["created"]) for stat in website_stats)
        updated = sum(int(stat["updated"]) for stat in website_stats)
        db_website_counts = await loop.run_in_executor(None, scraper_crud.get_website_video_counts, source.id)
        website_stats = [
            {
                **stat,
                "found": db_website_counts.get(scraper_crud.normalize_scraper_url(str(stat["url"])), int(stat["found"])),
            }
            for stat in website_stats
        ]
        next_run = calculate_next_run(source.schedule.model_dump())
        updated_source = source.model_copy(
            update={
                "url": source_all_urls[0] if source_all_urls else source.url,
                "urls": source_all_urls,
                "urlActressNameReversed": source_url_flags,
                "lastRun": utc_isoformat(datetime.now(timezone.utc)),
                "nextRun": utc_isoformat(next_run),
                "lastFound": len(videos),
                "lastNew": created,
                "lastPagesScraped": pages_scraped,
                "lastWebsiteStats": website_stats,
                "lastError": _summarize_skipped_websites(blocked_count, http_error_count, error_count),
            }
        )
        await loop.run_in_executor(None, scraper_crud.update_source, updated_source)
        return len(videos), created, updated, pages_scraped
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        logging.error("scraper source %s failed: %s", source.id, exc, exc_info=True)
        next_run = calculate_next_run(source.schedule.model_dump())
        failed_source = source.model_copy(
            update={
                "lastRun": utc_isoformat(datetime.now(timezone.utc)),
                "nextRun": utc_isoformat(next_run),
                "lastWebsiteStats": website_stats or source.lastWebsiteStats,
                "lastError": str(exc),
            }
        )
        await loop.run_in_executor(None, scraper_crud.update_source, failed_source)
        raise
    finally:
        _SCRAPER_CANCEL_EVENTS.pop(source.id, None)
        _SCRAPER_PROGRESS.pop(source.id, None)


async def run_due_scrapers() -> None:
    loop = asyncio.get_running_loop()
    sources = await loop.run_in_executor(None, scraper_crud.list_sources)
    now = datetime.utcnow()
    for source in sources:
        if not source.isActive or not source.nextRun:
            continue
        try:
            next_run = datetime.fromisoformat(source.nextRun.replace("Z", "+00:00")).replace(tzinfo=None)
        except ValueError:
            next_run = now
        if next_run <= now:
            await run_scraper_source(source)


async def refresh_scraper_next_runs() -> None:
    """Recalculate persisted schedules after startup timezone data becomes available."""
    loop = asyncio.get_running_loop()
    sources = await loop.run_in_executor(None, scraper_crud.list_sources)
    for source in sources:
        if not source.schedule.timeZone:
            continue
        next_run = calculate_next_run(source.schedule.model_dump())
        updated_source = source.model_copy(update={"nextRun": utc_isoformat(next_run)})
        await loop.run_in_executor(None, scraper_crud.update_source, updated_source)


async def scraper_scheduler() -> None:
    try:
        await refresh_scraper_next_runs()
    except Exception as exc:
        logging.error("failed to refresh scraper next runs at startup: %s", exc, exc_info=True)
    while True:
        try:
            await run_due_scrapers()
        except Exception as exc:
            logging.error("scraper_scheduler error: %s", exc, exc_info=True)
        await asyncio.sleep(60)
