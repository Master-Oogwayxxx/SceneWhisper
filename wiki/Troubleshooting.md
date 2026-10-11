# Troubleshooting

## Web UI Does Not Load

Check that the frontend container is running and that port `5175` is available.

For Docker Compose:

```bash
cd app
docker compose logs -f frontend
```

## Backend Is Unreachable

Check the backend container and port `8010`.

```bash
cd app
docker compose logs -f backend
```

## No Files Appear After Install

Confirm:

- The video library volume maps to `/videos`.
- The host path contains supported video files.
- A scan has been run from Settings.
- Ignore patterns are not excluding the files.
- The backend logs do not show permission errors.

## GPU Is Not Detected

Confirm NVIDIA drivers and Docker GPU runtime support:

```bash
nvidia-smi
docker run --rm --gpus all nvidia/cuda:12.0-base nvidia-smi
```

For Unraid, install the NVIDIA Driver plugin and confirm Docker can access the GPU.

For CPU-only systems, set:

```text
NVIDIA_VISIBLE_DEVICES=void
```

## Models Fail To Download

Check:

- Network access from the container
- Free disk space in the Hugging Face cache volume
- Whether the model requires `HF_TOKEN`
- Container logs for Hugging Face or download errors

## Tasks Stall Or Time Out

Review:

- Task Queue errors
- Logs tab
- Processing Hours settings
- Scene, split, subtitle, and frame pacing timeout settings
- Concurrency settings
- GPU availability for GPU-dependent workflows

## Scans Are Too Broad

Use selective scan or add ignore patterns in Settings. For recurring automation, prefer Directory Monitors scoped to the folders that need processing.

## Scraper Finds Existing Items

Run a fresh library scan so local file existence is current, then rerun or refresh scraper results.

## Subtitles Are Missing Or Orphaned

Use Tools > Subtitle Health Check to find missing, empty, and orphaned subtitles. Use orphan cleanup only after confirming the listed subtitles are safe to remove.
