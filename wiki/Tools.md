# Tools

The Tools tab contains one-off utilities for library maintenance and review.

## Frame Pacing Analyzer

Scans indexed videos for irregular frame timestamps. Matching files can be selected and queued for frame pacing repair.

Settings control analyzer concurrency and per-file timeout.

## Google Bookmark Video Check

Imports a Google bookmarks export, extracts video codes from bookmark URLs and titles, and checks whether matching videos already exist locally.

## HTML Page Video Check

Imports pasted page HTML, extracts video links and title codes, and checks whether matching videos already exist locally.

Useful workflows include:

- Finding codes from a saved or copied webpage
- Opening external links for review
- Selecting batches of visible results
- Skipping codes already opened in the current import

## Subtitle Health Check

Finds subtitle problems such as:

- Missing subtitles
- Empty subtitles
- Orphaned subtitles with no matching video

The tool can remove orphaned subtitles.

## Duplicate Finder

Groups indexed videos by exact filename and shows duplicate candidates with metadata and paths.

## Video Code Matcher

Accepts pasted video codes and returns matching local files with metadata in a table.

## External Video Targets

Some tools and work views use external search/open targets. Configure these in Settings with URL templates that include `{videoCode}`.
