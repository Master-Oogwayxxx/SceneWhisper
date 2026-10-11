# Settings

Settings is split into Actions, App Behavior, and Processing.

## Actions

Use Actions for library maintenance:

- Full scan
- Selective scan
- Cleanup missing files
- Selective cleanup
- Delete orphaned subtitles
- Selective SRT cleanup
- Clear queued, processing, completed, failed, cancelled, or paused tasks
- Export the SQLite database
- Clear app torrent data

Clearing app torrent data removes app records for torrents, files, tasks, queue items, notifications, and logs. It does not change the R18 dump database.

## App Behavior

Common behavior settings:

- Processing Hours
- Default task type
- Default file layout
- Default sort field
- Default sort direction
- Show stats panel on load
- Default subtitle language
- File ignore patterns
- Show actress work covers
- Show actress work titles
- External video targets
- Scraper website templates
- qBittorrent connection settings
- Bulk download timing

## Processing Hours

Processing Hours restrict task processing to selected local-time windows. Each day can have its own start and end hour.

## File Ignore Patterns

Ignore patterns exclude matching files during scans. Use this for samples, trailers, temporary files, or folders that should not be indexed.

## External Video Targets

External video targets define buttons or links for opening a video code on external sites. Templates should include:

```text
{videoCode}
```

Example:

```text
https://www.google.com/search?q={videoCode}
```

## qBittorrent

Configure qBittorrent URL, username, and password before using download workflows.

## Processing

Processing settings include:

- Task poll interval
- Task stall threshold
- Scene timeout
- Scene detector: Content, Adaptive, or Threshold
- Detector thresholds
- Minimum scene length
- Scene detection concurrency
- Frame pacing analyzer concurrency
- Frame pacing analyzer timeout
- Split timeout
- Split concurrency
- Subtitle timeout
- Subtitle concurrency
- Prevent split under a duration threshold

Use Reset in the Processing tab to restore processing defaults.
