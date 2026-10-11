# SceneWhisper Wiki

SceneWhisper is a self-hosted video processing suite for local media libraries. It provides a browser UI for scanning video folders, managing processing jobs, detecting scenes, splitting videos, generating subtitles, repairing frame pacing, tracking deleted files, and working with R18/scraped metadata.

## Start Here

- [Installation](Installation.md)
- [First Run Setup](First-Run-Setup.md)
- [File Browser](File-Browser.md)
- [Task Queue](Task-Queue.md)
- [Directory Monitors](Directory-Monitors.md)
- [Actresses and R18](Actresses-and-R18.md)
- [Scraper](Scraper.md)
- [Tools](Tools.md)
- [Settings](Settings.md)
- [Troubleshooting](Troubleshooting.md)

## Main Areas

SceneWhisper is organized around these UI tabs:

| Tab | Purpose |
| --- | --- |
| All Files | Browse scanned media, filter files, queue work, open file details, and manage local file records. |
| Directory Monitors | Schedule recurring work for selected folders. |
| Task Queue | Watch, pause, cancel, reorder, and inspect processing jobs. |
| Actresses | Browse imported R18 actress/work data and manage work downloads. |
| Scraper | Scrape configured websites for video entries and track opened/existing items. |
| Tools | Run one-off checks such as duplicate detection, bookmark checks, subtitle health, and frame pacing analysis. |
| Statistics | Review processing, storage, file coverage, scene, and directory statistics. |
| Deleted History | Review files SceneWhisper marked as deleted. |
| Logs | Search application logs from the browser. |

## Deployment Options

SceneWhisper supports two public deployment paths:

- Unraid Community Applications / Docker template using `ghcr.io/master-oogwayxxx/scenewhisper:latest`.
- Docker Compose from this repository, with separate frontend and backend services.

See [Installation](Installation.md) for both paths.
