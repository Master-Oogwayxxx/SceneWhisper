# SceneWhisper

SceneWhisper is a self-hosted video processing app for local and JAV video
libraries.
It combines a React web UI, a FastAPI worker/API, ffmpeg processing, scene
detection, subtitle tooling, and optional NVIDIA GPU acceleration.

## Features

- Scan local and JAV video libraries and track processed files.
- Run scene detection, video splitting, subtitle generation, and subtitle cleanup
  workflows.
- Organize JAV collections with browser-based library management and metadata
  workflows.
- Manage processing tasks, queue state, logs, deleted file history, and runtime
  settings from the browser UI.
- Use GPU acceleration on hosts with NVIDIA drivers and the NVIDIA Container
  Toolkit, or run in CPU-only mode.
- Cache Hugging Face models on a persistent volume so downloads survive container
  updates.

## Quick Start on Unraid

Install from Community Applications when the template is available there, or add
the template repository manually in Unraid Docker settings:

```text
https://github.com/Master-Oogwayxxx/SceneWhisper/tree/main/templates
```

The Unraid template uses this published image:

```text
ghcr.io/master-oogwayxxx/scenewhisper:latest
```

Default template values:

| Setting                | Default                                                                 | Purpose                                    |
| ---------------------- | ----------------------------------------------------------------------- | ------------------------------------------ |
| Web UI Port            | `5175`                                                                  | Browser interface                          |
| Video Library          | `/mnt/user/videos` -> `/videos`                                         | Local/JAV videos to scan and process       |
| App Data               | `/mnt/user/appdata/scenewhisper/data` -> `/data`                        | Database, logs, and runtime state          |
| Hugging Face Cache     | `/mnt/user/appdata/scenewhisper/hf-cache` -> `/root/.cache/huggingface` | Model cache                                |
| Timezone               | `America/Los_Angeles`                                                   | Container timezone                         |
| Hugging Face Token     | empty                                                                   | Optional private/rate-limited model access |
| NVIDIA Visible Devices | `all`                                                                   | GPU selection, or `void` for CPU-only      |

After the container starts, open:

```text
http://<your-unraid-ip>:5175
```

For GPU hosts, install the Unraid NVIDIA Driver plugin and confirm Docker GPU
runtime support before troubleshooting SceneWhisper. CPU-only hosts can set
`NVIDIA_VISIBLE_DEVICES` to `void` in the template advanced settings.

## Docker Compose

Clone the repository:

```bash
git clone https://github.com/Master-Oogwayxxx/SceneWhisper.git
cd SceneWhisper/app
```

Build and start the stack:

```bash
docker compose build
docker compose up -d
```

The Compose services are:

- `SceneWhisper-worker`: backend API and worker on `http://localhost:8010`
- `SceneWhisper`: frontend UI on `http://localhost:5175`

Useful Compose commands:

```bash
docker compose logs -f backend
docker compose logs -f frontend
docker compose down
```

The Compose file uses these default host paths:

| Host path                                                         | Container path             | Purpose                  |
| ----------------------------------------------------------------- | -------------------------- | ------------------------ |
| `/mnt/user/videos`                                                | `/videos`                  | Local/JAV video library  |
| `/mnt/user/appdata/docker-compose-projects/SceneWhisper/data`     | `/data`                    | Runtime app data         |
| `/mnt/user/appdata/docker-compose-projects/SceneWhisper/hf-cache` | `/root/.cache/huggingface` | Hugging Face model cache |

Update `app/docker-compose.yml` if your videos, app data, ports, or GPU settings
differ from the defaults.

## GPU and CPU Notes

GPU hosts use all available NVIDIA GPUs by default:

```yaml
NVIDIA_VISIBLE_DEVICES: all
NVIDIA_DRIVER_CAPABILITIES: compute,utility,video
```

For CPU-only Compose hosts, remove or comment the GPU device reservation in
`app/docker-compose.yml` and set:

```yaml
NVIDIA_VISIBLE_DEVICES: void
```

Verify Docker GPU access with:

```bash
docker run --rm --gpus all nvidia/cuda:12.0-base nvidia-smi
```

## Local Development

Backend commands run from `app/backend`:

```bash
uv run pytest
uv run uvicorn main:app --reload --host 0.0.0.0 --port 8010
```

Frontend commands run from `app/frontend`:

```bash
npm run dev
npm run build
npm run lint
npm test
```

## Project Layout

```text
SceneWhisper/
├── app/
│   ├── backend/              # Python 3.11 FastAPI API and worker
│   │   ├── src/
│   │   ├── tests/
│   │   ├── main.py
│   │   ├── pyproject.toml
│   │   └── Dockerfile
│   ├── frontend/             # React + Vite + TypeScript UI
│   ├── icons/                # Unraid Docker icons
│   └── docker-compose.yml
├── docker/
│   └── unraid/               # Single-container Unraid image build files
├── templates/
│   └── scenewhisper.xml      # Community Applications Docker template
├── ca_profile.xml            # Community Applications repository profile
└── README.md
```

Backend source lives under `app/backend/src`, split into `api`, `crud`,
`models`, `schemas`, and `workers`. Backend tests live in `app/backend/tests`.
Frontend source lives under `app/frontend/src`, with API clients in `src/api`,
feature components in `src/components`, and shared UI primitives in
`src/components/ui`.

## Troubleshooting

If the web UI does not load, confirm the container is running and that port
`5175` is not already in use.

If the backend is unreachable, check backend logs and confirm port `8010` is
available for Compose deployments.

If the GPU is not detected, confirm NVIDIA drivers and container runtime support:

```bash
nvidia-smi
docker run --rm --gpus all nvidia/cuda:12.0-base nvidia-smi
```

If models fail to download, check network access, free disk space in the Hugging
Face cache volume, and whether your chosen model requires `HF_TOKEN`.

## License

Apache License 2.0. See [LICENSE](LICENSE).
