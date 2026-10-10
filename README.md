# SceneWhisper

SceneWhisper is a Docker Compose packaged video processing app with a Python
FastAPI backend worker and a browser-based frontend service. This repository is
organized for Unraid and Docker deployment, including Community Applications
template files and a GHCR release workflow.

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
│   ├── frontend/             # Frontend container build context
│   ├── icons/                # Unraid Docker icons
│   └── docker-compose.yml
├── docker/
│   └── unraid/               # Single-container Unraid image build files
├── unraid/
│   ├── ca_profile.xml
│   └── templates/
└── README.md
```

## Prerequisites

- Docker
- Docker Compose v2
- NVIDIA drivers and NVIDIA Container Toolkit for GPU acceleration
- `uv` for local backend development and tests

Check the host tools:

```bash
docker --version
docker compose version
nvidia-smi
```

## Docker Compose

Clone the repository:

```bash
git clone git@github.com:Master-Oogwayxxx/SceneWhisper.git
cd SceneWhisper
```

Run Compose commands from the `app` directory:

```bash
cd app
docker compose build
docker compose up -d
```

The default services are:

- `SceneWhisper-worker`: backend API and worker on `http://localhost:8010`
- `SceneWhisper`: frontend UI on `http://localhost:5175`

Stop the stack:

```bash
docker compose down
```

Follow logs:

```bash
docker compose logs -f backend
docker compose logs -f frontend
```

## Volumes and Ports

The Compose file uses these defaults:

| Host path | Container path | Purpose |
| --- | --- | --- |
| `/mnt/user/videos` | `/videos` | Video library |
| `/mnt/user/appdata/docker-compose-projects/SceneWhisper/data` | `/data` | Runtime app data |
| `/mnt/user/appdata/docker-compose-projects/SceneWhisper/hf-cache` | `/root/.cache/huggingface` | Hugging Face model cache |

Default ports:

- Frontend: `5175`
- Backend: `8010`

## GPU and CPU Hosts

GPU hosts use all available NVIDIA GPUs by default:

```yaml
NVIDIA_VISIBLE_DEVICES: all
NVIDIA_DRIVER_CAPABILITIES: compute,utility,video
```

For CPU-only hosts, remove or comment the Compose GPU device reservation and set:

```yaml
NVIDIA_VISIBLE_DEVICES: void
```

You can verify Docker GPU access with:

```bash
docker run --rm --gpus all nvidia/cuda:12.0-base nvidia-smi
```

## Backend Development

Run backend commands from `app/backend`:

```bash
uv run pytest
uv run uvicorn main:app --reload --host 0.0.0.0 --port 8010
```

Backend source is under `app/backend/src`, with tests in `app/backend/tests`.

## Unraid Community Applications

SceneWhisper includes Unraid Community Applications metadata and a dedicated
single-container image definition:

```text
unraid/ca_profile.xml
unraid/templates/scenewhisper.xml
docker/unraid/Dockerfile
```

The published image is expected at:

```text
ghcr.io/Master-Oogwayxxx/scenewhisper:latest
```

Template defaults:

- Web UI: `http://[IP]:5175`
- Video library: `/mnt/user/videos` mapped to `/videos`
- App data: `/mnt/user/appdata/scenewhisper/data` mapped to `/data`
- Model cache: `/mnt/user/appdata/scenewhisper/hf-cache`
- Optional secret: `HF_TOKEN`

Unraid GPU users should install the NVIDIA Driver plugin and confirm Docker GPU
runtime support is available. CPU-only users can set `NVIDIA_VISIBLE_DEVICES` to
`void` in the template advanced settings.

For local template testing before Community Applications submission, add this
template repository URL in Unraid Docker settings:

```text
https://github.com/Master-Oogwayxxx/SceneWhisper/tree/main/unraid/templates
```

## Maintainer Release Flow

1. Push changes to `main` or run the `Publish Unraid Image` workflow manually.
2. Confirm the GHCR package `ghcr.io/Master-Oogwayxxx/scenewhisper:latest` is public.
3. Validate the repository at `https://ca.unraid.net/submit/new`.
4. Submit the public GitHub repository URL after validation passes.

Before submitting to Community Applications, confirm:

- `.github/workflows/publish-unraid-image.yml` is committed so GHCR publishes on `main`.
- `ghcr.io/Master-Oogwayxxx/scenewhisper:latest` exists and is public.
- `unraid/ca_profile.xml` and `unraid/templates/scenewhisper.xml` use reachable raw GitHub URLs from the public repository.
- The icon URL resolves to `app/icons/scene_whisper.png`.

## Troubleshooting

If the GPU is not detected, confirm the NVIDIA Container Toolkit is installed and
Docker has been restarted:

```bash
sudo apt install nvidia-container-toolkit
sudo systemctl restart docker
```

If a port is already in use, check the conflicting process or change the port
mapping in `app/docker-compose.yml`:

```bash
lsof -i :8010
lsof -i :5175
```

## License

MIT License. See [LICENSE](LICENSE).
