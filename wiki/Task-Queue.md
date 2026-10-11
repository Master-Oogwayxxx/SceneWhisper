# Task Queue

The Task Queue tab shows current and historical processing jobs.

## Task Types

SceneWhisper supports these task types:

| Task | Purpose |
| --- | --- |
| Scene | Detect scene boundaries. |
| Split | Split video using detected or generated scene boundaries. |
| Subtitle | Generate subtitles with Whisper. |
| All | Run the standard combined workflow. |
| Merge | Merge selected inputs. |
| Analyze + Frame Pacing Repair | Analyze frame pacing, then queue repair when needed. |
| Frame Pacing Repair | Repair frame pacing with NVENC processing. |
| Remux | Remux video without a full transcode. |

## Statuses

Tasks can be queued, processing, completed, failed, cancelled, or paused.

## Queue Controls

Depending on task state, you can:

- Pause or unpause work
- Cancel a task
- Delete task records
- Reorder queued tasks
- Inspect logs and errors
- Retry by creating a new task from the relevant file

## Progress

Tasks report stage-specific progress where available:

- Scene detection
- Video splitting
- Video reencoding
- Frame pacing analysis
- Frame pacing repair
- Remuxing
- Merging
- Subtitle generation

## Processing Hours

Processing Hours in Settings can restrict when queued work runs. This is useful when GPU, CPU, or disk activity should only happen during certain local-time windows.

## Concurrency

Concurrency is configured in Settings. Scene detection, splitting, subtitle generation, and frame pacing analysis each have their own limits.
