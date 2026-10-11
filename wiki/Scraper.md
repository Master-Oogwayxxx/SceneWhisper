# Scraper

The Scraper tab manages website sources that SceneWhisper can crawl for video entries.

## Sources

A scraper source includes:

- Name
- One or more URLs
- Schedule
- Active or paused state
- Last run information
- Last found and new counts
- Per-website run statistics

Sources can be run manually or scheduled hourly, daily, or weekly.

## Scraper Templates

Settings includes scraper website templates. Templates use `{actress_name}` in the URL so sources can be created consistently for different names.

The default template is:

```text
https://javplayer.org/model/{actress_name}
```

## Scraped Videos

Scraped video entries can include:

- Video code
- Title
- URL
- Censored, uncensored, and subtitled flags
- Opened state
- Local file existence
- First seen and last scraped timestamps

## Opened State

SceneWhisper tracks whether scraped videos have been opened from the UI. This helps separate newly found items from items already reviewed.

## Existing File Checks

Scraped video codes are compared against the indexed local library. Use this to avoid reviewing or downloading works you already have.
