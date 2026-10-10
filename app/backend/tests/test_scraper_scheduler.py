from datetime import datetime
from urllib.error import HTTPError

import pytest

from src.models.models import Schedule, ScheduleInterval, ScraperSource
from src.workers import scraper_scheduler


@pytest.mark.asyncio
async def test_refresh_scraper_next_runs_recalculates_timezone_schedules(monkeypatch):
    source = ScraperSource(
        id="source-1",
        name="Scheduled source",
        url="https://example.test/videos",
        urls=["https://example.test/videos"],
        schedule=Schedule(interval=ScheduleInterval.DAILY, time="09:00", timeZone="America/Los_Angeles"),
        isActive=True,
        nextRun="2026-01-01T09:00:00Z",
        createdAt="2026-01-01T00:00:00Z",
    )
    updates: list[ScraperSource] = []
    monkeypatch.setattr(scraper_scheduler.scraper_crud, "list_sources", lambda: [source])
    monkeypatch.setattr(scraper_scheduler.scraper_crud, "update_source", lambda updated: updates.append(updated))
    monkeypatch.setattr(scraper_scheduler, "calculate_next_run", lambda schedule: datetime(2026, 1, 1, 17, 0, 0))

    await scraper_scheduler.refresh_scraper_next_runs()

    assert len(updates) == 1
    assert updates[0].nextRun == "2026-01-01T17:00:00Z"


def test_discover_page_links_keeps_same_site_pagination_only():
    html = """
    <a href="/videos?page=2">2</a>
    <a href="/videos?page=3">Next</a>
    <a href="https://other.example/videos?page=2">3</a>
    <a href="/contact">Contact</a>
    """

    links = scraper_scheduler.discover_page_links(html, "https://example.test/videos?page=1", "https://example.test/videos?page=1")

    assert links == [
        "https://example.test/videos?page=2",
        "https://example.test/videos?page=3",
    ]


def test_discover_page_links_keeps_pagination_within_source_page():
    html = """
    <a href="/models/yua-mikami?page=2">2</a>
    <a href="/models/yua-mikami/page/3">Next</a>
    <a href="/videos/12345">12345</a>
    <a href="/models/other-actress?page=4">4</a>
    """

    links = scraper_scheduler.discover_page_links(
        html,
        "https://example.test/models/yua-mikami",
        "https://example.test/models/yua-mikami",
    )

    assert links == [
        "https://example.test/models/yua-mikami?page=2",
        "https://example.test/models/yua-mikami/page/3",
    ]


def test_estimate_total_pages_ignores_unrelated_pagination_links_and_caps_count():
    html = """
    <ul class="pagination">
        <li><a href="/models/yua-mikami?page=2">2</a></li>
        <li><a href="/models/yua-mikami?page=3">3</a></li>
        <li><a href="/videos/12345">12345</a></li>
        <li><a href="https://other.example/models/yua-mikami?page=9999">9999</a></li>
    </ul>
    """

    total_pages = scraper_scheduler.estimate_total_pages(
        html,
        "https://example.test/models/yua-mikami",
        "https://example.test/models/yua-mikami",
    )

    assert total_pages == 3


def test_estimate_total_pages_caps_large_valid_pagination_count():
    html = """
    <ul class="pagination">
        <li><a href="/models/yua-mikami?page=2">2</a></li>
        <li><a href="/models/yua-mikami?page=1001">1001</a></li>
    </ul>
    """

    total_pages = scraper_scheduler.estimate_total_pages(
        html,
        "https://example.test/models/yua-mikami",
        "https://example.test/models/yua-mikami",
    )

    assert total_pages == scraper_scheduler.MAX_CRAWL_PAGES


def test_scrape_all_pages_follows_discovered_pages_and_dedupes(monkeypatch):
    pages = {
        "https://example.test/videos": """
            <a href="/item/ABC-001">ABC-001 title</a>
            <a href="/videos?page=2">Next</a>
        """,
        "https://example.test/videos?page=2": """
            <a href="/item/ABC-001">ABC-001 better title</a>
            <a href="/item/DEF-222">DEF-222 title</a>
        """,
    }

    monkeypatch.setattr(scraper_scheduler, "_fetch_page", lambda url: pages[url])
    monkeypatch.setattr(scraper_scheduler, "_sleep_between_page_requests", lambda: None)

    videos, pages_scraped = scraper_scheduler.scrape_all_pages("https://example.test/videos", "source-1")

    assert {video["video_code"] for video in videos} == {"ABC-001", "DEF-222"}
    assert next(video for video in videos if video["video_code"] == "ABC-001")["title"] == "ABC-001 better title"
    assert pages_scraped == 2


def test_fetch_page_with_retry_waits_one_minute_for_transient_status(monkeypatch):
    calls: list[str] = []
    sleeps: list[float] = []

    def fake_fetch_page(url: str):
        calls.append(url)
        if len(calls) == 1:
            raise HTTPError(url, 429, "Too Many Requests", hdrs=None, fp=None)
        return '<a href="/item/ABC-001">ABC-001 title</a>'

    monkeypatch.setattr(scraper_scheduler, "_fetch_page", fake_fetch_page)
    monkeypatch.setattr(scraper_scheduler.time, "sleep", lambda seconds: sleeps.append(seconds))

    page_html = scraper_scheduler._fetch_page_with_retry("https://example.test/videos")

    assert page_html == '<a href="/item/ABC-001">ABC-001 title</a>'
    assert calls == ["https://example.test/videos", "https://example.test/videos"]
    assert sleeps == [60.0]


def test_fetch_page_with_retry_waits_one_minute_for_timeout(monkeypatch):
    calls: list[str] = []
    sleeps: list[float] = []

    def fake_fetch_page(url: str):
        calls.append(url)
        if len(calls) == 1:
            raise TimeoutError("timed out")
        return '<a href="/item/ABC-001">ABC-001 title</a>'

    monkeypatch.setattr(scraper_scheduler, "_fetch_page", fake_fetch_page)
    monkeypatch.setattr(scraper_scheduler.time, "sleep", lambda seconds: sleeps.append(seconds))

    page_html = scraper_scheduler._fetch_page_with_retry("https://example.test/videos")

    assert page_html == '<a href="/item/ABC-001">ABC-001 title</a>'
    assert calls == ["https://example.test/videos", "https://example.test/videos"]
    assert sleeps == [60.0]


def test_extract_videos_marks_uncensored_text_rm_code_and_sub_code_traits():
    html = """
    <a href="/item/ABC-001-RM">ABC-001 Reduced Mosaic release</a>
    <a href="/item/DEF-222">DEF-222 decensored version</a>
    <a href="/item/GHI-333">GHI-333 uncensored version</a>
    <a href="/item/JKL-444">JKL-444 English Subtitles</a>
    <a href="/item/MNO-555-SUB">MNO-555</a>
    <a href="/item/QRS-777">QRS-777 reduced mosaic</a>
    <a href="/item/UVW-888-UN">UVW-888 standard release</a>
    <a href="/item/PQR-666">PQR-666 standard release</a>
    """

    videos = {
        video["video_code"]: video
        for video in scraper_scheduler.extract_videos(html, "https://example.test/videos")
    }

    assert videos["ABC-001"]["uncensored"] is True
    assert videos["ABC-001"]["censored"] is False
    assert videos["DEF-222"]["uncensored"] is True
    assert videos["GHI-333"]["uncensored"] is True
    assert videos["QRS-777"]["uncensored"] is True
    assert videos["JKL-444"]["subtitled"] is True
    assert videos["MNO-555"]["subtitled"] is True
    assert videos["UVW-888"]["uncensored"] is True
    assert videos["UVW-888"]["censored"] is False
    assert videos["PQR-666"]["uncensored"] is False
    assert videos["PQR-666"]["censored"] is True
    assert videos["PQR-666"]["subtitled"] is False


def test_extract_videos_keeps_same_code_variants_with_different_urls():
    html = """
    <a href="/item/ABC-001">ABC-001 standard release</a>
    <a href="/item/ABC-001-RM">ABC-001 Reduced Mosaic release</a>
    """

    videos = scraper_scheduler.extract_videos(html, "https://example.test/videos")

    assert len(videos) == 2
    assert {video["url"] for video in videos} == {
        "https://example.test/item/ABC-001",
        "https://example.test/item/ABC-001-RM",
    }
    assert sorted(video["uncensored"] for video in videos) == [False, True]


def test_extract_videos_skips_navigation_titles():
    html = """
    <a href="/page/1">&lt;Prev</a>
    <a href="/item/ABC-001">ABC-001 title</a>
    <a href="/page/2">Next&gt;</a>
    """

    videos = scraper_scheduler.extract_videos(html, "https://example.test/videos")

    assert [video["video_code"] for video in videos] == ["ABC-001"]


def test_build_reversed_name_retry_url_swaps_slug_order():
    retry_url = scraper_scheduler._build_reversed_name_retry_url(
        "https://example.test/model/yua-mikami",
        "Yua Mikami",
    )

    assert retry_url == "https://example.test/model/mikami-yua"


def test_scrape_all_pages_with_name_fallback_retries_reversed_slug(monkeypatch):
    calls: list[str] = []

    def fake_scrape_all_pages(url: str, *args, **kwargs):
        calls.append(url)
        if url.endswith("yua-mikami"):
            raise RuntimeError("not found")
        return ([{"video_code": "ABC-001", "title": "Recovered", "url": url}], 1)

    monkeypatch.setattr(scraper_scheduler, "scrape_all_pages", fake_scrape_all_pages)

    videos, pages_scraped, scraped_url = scraper_scheduler.scrape_all_pages_with_name_fallback(
        "https://example.test/model/yua-mikami",
        "source-1",
        "Yua Mikami",
    )

    assert calls == [
        "https://example.test/model/yua-mikami",
        "https://example.test/model/mikami-yua",
    ]
    assert scraped_url == "https://example.test/model/mikami-yua"
    assert pages_scraped == 1
    assert videos == [{"video_code": "ABC-001", "title": "Recovered", "url": "https://example.test/model/mikami-yua"}]


def test_scrape_all_pages_with_name_fallback_does_not_retry_blocked_url(monkeypatch):
    calls: list[str] = []

    def fake_scrape_all_pages(url: str, *args, **kwargs):
        calls.append(url)
        raise HTTPError(url, 403, "Forbidden", hdrs=None, fp=None)

    monkeypatch.setattr(scraper_scheduler, "scrape_all_pages", fake_scrape_all_pages)

    with pytest.raises(HTTPError):
        scraper_scheduler.scrape_all_pages_with_name_fallback(
            "https://example.test/model/yua-mikami",
            "source-1",
            "Yua Mikami",
        )

    assert calls == ["https://example.test/model/yua-mikami"]


@pytest.mark.asyncio
async def test_run_scraper_source_scrapes_multiple_urls_under_one_source(monkeypatch):
    calls: list[str] = []
    upserts: list[tuple[str, list[dict[str, str | bool | None]]]] = []

    def fake_scrape_all_pages(url: str, *args, **kwargs):
        calls.append(url)
        if url.endswith("one"):
            return ([{"video_code": "ABC-001", "title": "First", "url": url}], 2)
        return ([{"video_code": "ABC-001", "title": "Better", "url": url}, {"video_code": "DEF-222", "title": "Second", "url": url}], 3)

    def fake_upsert_videos(source_id: str, source_url: str, videos: list[dict[str, str | bool | None]]):
        upserts.append((source_id, videos))
        return len(videos), 0

    monkeypatch.setattr(scraper_scheduler, "scrape_all_pages", fake_scrape_all_pages)
    monkeypatch.setattr(scraper_scheduler.scraper_crud, "upsert_videos", fake_upsert_videos)
    monkeypatch.setattr(scraper_scheduler.scraper_crud, "get_website_video_counts", lambda source_id: {})
    monkeypatch.setattr(scraper_scheduler.scraper_crud, "update_source", lambda source: source)
    monkeypatch.setattr(scraper_scheduler, "calculate_next_run", lambda schedule: datetime(2026, 1, 1, 9, 0, 0))

    source = ScraperSource(
        id="source-1",
        name="Yua Mikami",
        url="https://example.test/one",
        urls=["https://example.test/one", "https://example.test/two"],
        schedule=Schedule(interval=ScheduleInterval.DAILY, time="09:00"),
        isActive=True,
        createdAt="2026-01-01T00:00:00Z",
    )

    found, created, updated, pages_scraped = await scraper_scheduler.run_scraper_source(source)

    assert calls == ["https://example.test/one", "https://example.test/two"]
    assert found == 3
    assert created == 3
    assert updated == 0
    assert pages_scraped == 5
    assert upserts[0][0] == "source-1"
    assert {video["video_code"] for video in upserts[0][1]} == {"ABC-001"}
    assert {video["video_code"] for video in upserts[1][1]} == {"ABC-001", "DEF-222"}
    assert next(video for video in upserts[1][1] if video["video_code"] == "DEF-222")["title"] == "Second"


@pytest.mark.asyncio
async def test_run_scraper_source_retries_failed_url_with_reversed_name(monkeypatch):
    calls: list[str] = []
    upserts: list[tuple[str, str, list[dict[str, str | bool | None]]]] = []
    updated_sources = []

    def fake_scrape_all_pages(url: str, *args, **kwargs):
        calls.append(url)
        if url.endswith("yua-mikami"):
            raise RuntimeError("missing page")
        return ([{"video_code": "ABC-001", "title": "Recovered", "url": url}], 2)

    def fake_upsert_videos(source_id: str, source_url: str, videos: list[dict[str, str | bool | None]]):
        upserts.append((source_id, source_url, videos))
        return 1, 0

    def fake_update_source(source: ScraperSource):
        updated_sources.append(source)
        return source

    monkeypatch.setattr(scraper_scheduler, "scrape_all_pages", fake_scrape_all_pages)
    monkeypatch.setattr(scraper_scheduler.scraper_crud, "upsert_videos", fake_upsert_videos)
    monkeypatch.setattr(scraper_scheduler.scraper_crud, "get_website_video_counts", lambda source_id: {
        "https://example.test/model/mikami-yua": 1,
    })
    monkeypatch.setattr(scraper_scheduler.scraper_crud, "update_source", fake_update_source)
    monkeypatch.setattr(scraper_scheduler, "calculate_next_run", lambda schedule: datetime(2026, 1, 1, 9, 0, 0))

    source = ScraperSource(
        id="source-1",
        name="Yua Mikami",
        url="https://example.test/model/yua-mikami",
        urls=["https://example.test/model/yua-mikami"],
        schedule=Schedule(interval=ScheduleInterval.DAILY, time="09:00"),
        isActive=True,
        createdAt="2026-01-01T00:00:00Z",
    )

    found, created, updated, pages_scraped = await scraper_scheduler.run_scraper_source(source)

    assert calls == [
        "https://example.test/model/yua-mikami",
        "https://example.test/model/mikami-yua",
    ]
    assert found == 1
    assert created == 1
    assert updated == 0
    assert pages_scraped == 2
    assert upserts == [
        (
            "source-1",
            "https://example.test/model/mikami-yua",
            [{"video_code": "ABC-001", "title": "Recovered", "url": "https://example.test/model/mikami-yua"}],
        ),
    ]
    assert updated_sources[0].lastWebsiteStats == [
        {"url": "https://example.test/model/mikami-yua", "pagesScraped": 2, "found": 1, "created": 1, "updated": 0, "blocked": False},
    ]
    assert updated_sources[0].url == "https://example.test/model/mikami-yua"
    assert updated_sources[0].urls == ["https://example.test/model/mikami-yua"]
    assert updated_sources[0].urlActressNameReversed == [True]


@pytest.mark.asyncio
async def test_run_scraper_source_reports_raw_website_found_counts(monkeypatch):
    calls: list[str] = []
    upserts: list[tuple[str, list[dict[str, str | bool | None]]]] = []
    updated_sources = []

    def fake_scrape_all_pages(url: str, *args, **kwargs):
        calls.append(url)
        if url.endswith("player"):
            return ([{"video_code": "ABC-001", "title": "First", "url": url}], 2)
        return ([{"video_code": "ABC-001", "title": "Duplicate", "url": url}], 2)

    def fake_upsert_videos(source_id: str, source_url: str, videos: list[dict[str, str | bool | None]]):
        upserts.append((source_id, videos))
        return len(videos), 0

    def fake_update_source(source: ScraperSource):
        updated_sources.append(source)
        return source

    monkeypatch.setattr(scraper_scheduler, "scrape_all_pages", fake_scrape_all_pages)
    monkeypatch.setattr(scraper_scheduler.scraper_crud, "upsert_videos", fake_upsert_videos)
    monkeypatch.setattr(scraper_scheduler.scraper_crud, "get_website_video_counts", lambda source_id: {
        "https://example.test/player": 1,
        "https://example.test/javct": 1,
        "https://example.test/hornyjav": 1,
    })
    monkeypatch.setattr(scraper_scheduler.scraper_crud, "update_source", fake_update_source)
    monkeypatch.setattr(scraper_scheduler, "calculate_next_run", lambda schedule: datetime(2026, 1, 1, 9, 0, 0))

    source = ScraperSource(
        id="source-1",
        name="Mixed Source",
        url="https://example.test/player",
        urls=["https://example.test/player", "https://example.test/javct", "https://example.test/hornyjav"],
        schedule=Schedule(interval=ScheduleInterval.DAILY, time="09:00"),
        isActive=True,
        createdAt="2026-01-01T00:00:00Z",
    )

    found, created, updated, pages_scraped = await scraper_scheduler.run_scraper_source(source)

    assert calls == [
        "https://example.test/player",
        "https://example.test/javct",
        "https://example.test/hornyjav",
    ]
    assert found == 3
    assert created == 3
    assert updated == 0
    assert pages_scraped == 6
    assert upserts[0][1] == [{"video_code": "ABC-001", "title": "First", "url": "https://example.test/player"}]
    assert upserts[1][1] == [{"video_code": "ABC-001", "title": "Duplicate", "url": "https://example.test/javct"}]
    assert upserts[2][1] == [{"video_code": "ABC-001", "title": "Duplicate", "url": "https://example.test/hornyjav"}]
    assert updated_sources[0].lastWebsiteStats == [
        {"url": "https://example.test/player", "pagesScraped": 2, "found": 1, "created": 1, "updated": 0, "blocked": False},
        {"url": "https://example.test/javct", "pagesScraped": 2, "found": 1, "created": 1, "updated": 0, "blocked": False},
        {"url": "https://example.test/hornyjav", "pagesScraped": 2, "found": 1, "created": 1, "updated": 0, "blocked": False},
    ]


@pytest.mark.asyncio
async def test_run_scraper_source_skips_forbidden_urls_and_continues(monkeypatch):
    calls: list[str] = []
    upserts: list[tuple[str, list[dict[str, str | bool | None]]]] = []
    updated_sources = []

    def fake_scrape_all_pages(url: str, *args, **kwargs):
        calls.append(url)
        if url.endswith("blocked"):
            raise HTTPError(url, 403, "Forbidden", hdrs=None, fp=None)
        return ([{"video_code": "ABC-001", "title": "First", "url": url}], 2)

    def fake_upsert_videos(source_id: str, source_url: str, videos: list[dict[str, str | bool | None]]):
        upserts.append((source_id, videos))
        return 1, 0

    def fake_update_source(source: ScraperSource):
        updated_sources.append(source)
        return source

    monkeypatch.setattr(scraper_scheduler, "scrape_all_pages", fake_scrape_all_pages)
    monkeypatch.setattr(scraper_scheduler.scraper_crud, "upsert_videos", fake_upsert_videos)
    monkeypatch.setattr(scraper_scheduler.scraper_crud, "get_website_video_counts", lambda source_id: {
        "https://example.test/good": 1,
    })
    monkeypatch.setattr(scraper_scheduler.scraper_crud, "update_source", fake_update_source)
    monkeypatch.setattr(scraper_scheduler, "calculate_next_run", lambda schedule: datetime(2026, 1, 1, 9, 0, 0))

    source = ScraperSource(
        id="source-1",
        name="Yua Mikami",
        url="https://example.test/good",
        urls=["https://example.test/good", "https://example.test/blocked"],
        schedule=Schedule(interval=ScheduleInterval.DAILY, time="09:00"),
        isActive=True,
        createdAt="2026-01-01T00:00:00Z",
    )

    found, created, updated, pages_scraped = await scraper_scheduler.run_scraper_source(source)

    assert calls == ["https://example.test/good", "https://example.test/blocked"]
    assert found == 1
    assert created == 1
    assert updated == 0
    assert pages_scraped == 2
    assert upserts[0][0] == "source-1"
    assert {video["video_code"] for video in upserts[0][1]} == {"ABC-001"}
    assert updated_sources[0].lastError == "Skipped 1 blocked scraper website(s)"


@pytest.mark.asyncio
async def test_run_scraper_source_skips_forbidden_like_errors_and_continues(monkeypatch):
    calls: list[str] = []
    upserts: list[tuple[str, list[dict[str, str | bool | None]]]] = []

    class ForbiddenLikeError(Exception):
        def __init__(self, code: int):
            super().__init__(f"HTTP {code}")
            self.code = code

    def fake_scrape_all_pages(url: str, *args, **kwargs):
        calls.append(url)
        if url.endswith("blocked"):
            raise ForbiddenLikeError(403)
        return ([{"video_code": "ABC-001", "title": "First", "url": url}], 2)

    def fake_upsert_videos(source_id: str, source_url: str, videos: list[dict[str, str | bool | None]]):
        upserts.append((source_id, videos))
        return 1, 0

    monkeypatch.setattr(scraper_scheduler, "scrape_all_pages", fake_scrape_all_pages)
    monkeypatch.setattr(scraper_scheduler.scraper_crud, "upsert_videos", fake_upsert_videos)
    monkeypatch.setattr(scraper_scheduler.scraper_crud, "get_website_video_counts", lambda source_id: {
        "https://example.test/good": 1,
    })
    monkeypatch.setattr(scraper_scheduler.scraper_crud, "update_source", lambda source: source)
    monkeypatch.setattr(scraper_scheduler, "calculate_next_run", lambda schedule: datetime(2026, 1, 1, 9, 0, 0))

    source = ScraperSource(
        id="source-1",
        name="Yua Mikami",
        url="https://example.test/good",
        urls=["https://example.test/good", "https://example.test/blocked"],
        schedule=Schedule(interval=ScheduleInterval.DAILY, time="09:00"),
        isActive=True,
        createdAt="2026-01-01T00:00:00Z",
    )

    found, created, updated, pages_scraped = await scraper_scheduler.run_scraper_source(source)

    assert calls == ["https://example.test/good", "https://example.test/blocked"]
    assert found == 1
    assert created == 1
    assert updated == 0
    assert pages_scraped == 2
    assert upserts[0][0] == "source-1"
    assert {video["video_code"] for video in upserts[0][1]} == {"ABC-001"}


@pytest.mark.asyncio
async def test_run_scraper_source_skips_http_errors_and_continues(monkeypatch):
    calls: list[str] = []
    upserts: list[tuple[str, list[dict[str, str | bool | None]]]] = []
    updated_sources = []

    def fake_scrape_all_pages(url: str, *args, **kwargs):
        calls.append(url)
        if url.endswith("error"):
            raise HTTPError(url, 500, "Server Error", hdrs=None, fp=None)
        return ([{"video_code": "ABC-001", "title": "First", "url": url}], 2)

    def fake_upsert_videos(source_id: str, source_url: str, videos: list[dict[str, str | bool | None]]):
        upserts.append((source_id, videos))
        return 1, 0

    def fake_update_source(source: ScraperSource):
        updated_sources.append(source)
        return source

    monkeypatch.setattr(scraper_scheduler, "scrape_all_pages", fake_scrape_all_pages)
    monkeypatch.setattr(scraper_scheduler.scraper_crud, "upsert_videos", fake_upsert_videos)
    monkeypatch.setattr(scraper_scheduler.scraper_crud, "get_website_video_counts", lambda source_id: {
        "https://example.test/good": 1,
    })
    monkeypatch.setattr(scraper_scheduler.scraper_crud, "update_source", fake_update_source)
    monkeypatch.setattr(scraper_scheduler, "calculate_next_run", lambda schedule: datetime(2026, 1, 1, 9, 0, 0))

    source = ScraperSource(
        id="source-1",
        name="Yua Mikami",
        url="https://example.test/good",
        urls=["https://example.test/good", "https://example.test/error"],
        schedule=Schedule(interval=ScheduleInterval.DAILY, time="09:00"),
        isActive=True,
        createdAt="2026-01-01T00:00:00Z",
    )

    found, created, updated, pages_scraped = await scraper_scheduler.run_scraper_source(source)

    assert calls == ["https://example.test/good", "https://example.test/error"]
    assert found == 1
    assert created == 1
    assert updated == 0
    assert pages_scraped == 2
    assert upserts[0][0] == "source-1"
    assert {video["video_code"] for video in upserts[0][1]} == {"ABC-001"}
    assert updated_sources[0].lastError == "Skipped 1 scraper website(s) due to HTTP errors"


@pytest.mark.asyncio
async def test_run_scraper_source_marks_rate_limited_urls_blocked(monkeypatch):
    calls: list[str] = []
    updated_sources = []

    def fake_scrape_all_pages(url: str, *args, **kwargs):
        calls.append(url)
        raise HTTPError(url, 429, "Too Many Requests", hdrs=None, fp=None)

    def fake_update_source(source: ScraperSource):
        updated_sources.append(source)
        return source

    monkeypatch.setattr(scraper_scheduler, "scrape_all_pages", fake_scrape_all_pages)
    monkeypatch.setattr(scraper_scheduler.scraper_crud, "get_website_video_counts", lambda source_id: {})
    monkeypatch.setattr(scraper_scheduler.scraper_crud, "update_source", fake_update_source)
    monkeypatch.setattr(scraper_scheduler, "calculate_next_run", lambda schedule: datetime(2026, 1, 1, 9, 0, 0))

    source = ScraperSource(
        id="source-1",
        name="Yua Mikami",
        url="https://example.test/rate-limited",
        urls=["https://example.test/rate-limited"],
        schedule=Schedule(interval=ScheduleInterval.DAILY, time="09:00"),
        isActive=True,
        createdAt="2026-01-01T00:00:00Z",
    )

    found, created, updated, pages_scraped = await scraper_scheduler.run_scraper_source(source)

    assert calls == ["https://example.test/rate-limited"]
    assert found == 0
    assert created == 0
    assert updated == 0
    assert pages_scraped == 0
    assert updated_sources[0].lastWebsiteStats == [
        {"url": "https://example.test/rate-limited", "pagesScraped": 0, "found": 0, "created": 0, "updated": 0, "blocked": True},
    ]
    assert updated_sources[0].lastError == "Skipped 1 blocked scraper website(s)"


@pytest.mark.asyncio
async def test_run_scraper_source_skips_generic_scraper_errors_and_continues(monkeypatch):
    calls: list[str] = []
    upserts: list[tuple[str, list[dict[str, str | bool | None]]]] = []
    updated_sources = []

    def fake_scrape_all_pages(url: str, *args, **kwargs):
        calls.append(url)
        if url.endswith("broken"):
            raise RuntimeError("parser exploded")
        return ([{"video_code": "ABC-001", "title": "First", "url": url}], 2)

    def fake_upsert_videos(source_id: str, source_url: str, videos: list[dict[str, str | bool | None]]):
        upserts.append((source_id, videos))
        return 1, 0

    def fake_update_source(source: ScraperSource):
        updated_sources.append(source)
        return source

    monkeypatch.setattr(scraper_scheduler, "scrape_all_pages", fake_scrape_all_pages)
    monkeypatch.setattr(scraper_scheduler.scraper_crud, "upsert_videos", fake_upsert_videos)
    monkeypatch.setattr(scraper_scheduler.scraper_crud, "get_website_video_counts", lambda source_id: {
        "https://example.test/good": 1,
    })
    monkeypatch.setattr(scraper_scheduler.scraper_crud, "update_source", fake_update_source)
    monkeypatch.setattr(scraper_scheduler, "calculate_next_run", lambda schedule: datetime(2026, 1, 1, 9, 0, 0))

    source = ScraperSource(
        id="source-1",
        name="Yua Mikami",
        url="https://example.test/good",
        urls=["https://example.test/good", "https://example.test/broken"],
        schedule=Schedule(interval=ScheduleInterval.DAILY, time="09:00"),
        isActive=True,
        createdAt="2026-01-01T00:00:00Z",
    )

    found, created, updated, pages_scraped = await scraper_scheduler.run_scraper_source(source)

    assert calls == ["https://example.test/good", "https://example.test/broken"]
    assert found == 1
    assert created == 1
    assert updated == 0
    assert pages_scraped == 2
    assert upserts[0][0] == "source-1"
    assert {video["video_code"] for video in upserts[0][1]} == {"ABC-001"}
    assert updated_sources[0].lastError == "Skipped 1 scraper website(s) due to scraper errors"
