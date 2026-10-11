# Directory Monitors

Directory Monitors automate recurring work for selected folders.

## What Monitors Do

A monitor watches an indexed directory on a schedule and queues selected task types for files in that directory.

Schedules can be:

- Hourly
- Daily
- Weekly

Daily and weekly schedules can include a specific time. Weekly schedules can include a day of the week.

## Task Selection

Monitors can queue one or more task types, including scene detection, splitting, subtitle generation, frame pacing analysis or repair, and remuxing.

When `All` is used, SceneWhisper expands it into the standard split and subtitle workflow for monitor scheduling.

## Split Scope

Split-related monitors can target:

- Both censored and uncensored videos
- Uncensored videos only
- Censored videos only

## Subtitle Fill

Monitors can fill missing subtitles for files that need them.

## Frame Pacing Scope

Frame pacing monitors can target:

- All matching files
- Split outputs only

Resolution filters can limit frame pacing work to selected resolution buckets.

## Delete After Completion

Some monitor workflows can delete the source video after successful completion. Use this carefully and confirm your output and retention expectations before enabling it.

## Active and Paused Monitors

Monitors can be active or paused. Paused monitors keep their configuration but do not queue new scheduled work.
