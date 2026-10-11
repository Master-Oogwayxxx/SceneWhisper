# Installation

SceneWhisper can run from the Unraid template or from Docker Compose.

## Unraid Community Applications

Install SceneWhisper from Community Applications when available. If you add the template repository manually, use:

```text
https://github.com/Master-Oogwayxxx/SceneWhisper/tree/main/templates
```

The Unraid template uses:

```text
ghcr.io/master-oogwayxxx/scenewhisper:latest
```

Default template values:

| Setting | Default | Purpose |
| --- | --- | --- |
| Web UI Port | `5175` | Browser interface |
| Video Library | `/mnt/user/videos` -> `/videos` | Media scanned and processed by SceneWhisper |
| App Data | `/mnt/user/appdata/scenewhisper/data` -> `/data` | Database, logs, and runtime state |
| Hugging Face Cache | `/mnt/user/appdata/scenewhisper/hf-cache` -> `/root/.cache/huggingface` | Persistent model cache |
| Timezone | `America/Los_Angeles` | Container timezone |
| Hugging Face Token | empty | Optional token for private or rate-limited models |
| NVIDIA Visible Devices | `all` | GPU selection; use `void` for CPU-only |

After the container starts, open:

```text
http://<your-unraid-ip>:5175
```

## Docker Compose

Clone the repository:

```bash
git clone https://github.com/Master-Oogwayxxx/SceneWhisper.git
cd SceneWhisper/app
```

Build and start:

```bash
docker compose build
docker compose up -d
```

Services:

| Service | Purpose | URL |
| --- | --- | --- |
| `SceneWhisper` | Frontend UI | `http://localhost:5175` |
| `SceneWhisper-worker` | Backend API and worker | `http://localhost:8010` |

Useful commands:

```bash
docker compose logs -f backend
docker compose logs -f frontend
docker compose down
```

## GPU and CPU Hosts

GPU hosts should have NVIDIA drivers and NVIDIA Container Toolkit available. Verify Docker GPU access with:

```bash
docker run --rm --gpus all nvidia/cuda:12.0-base nvidia-smi
```

For CPU-only Compose hosts, remove or comment the GPU reservation in `app/docker-compose.yml` and set:

```yaml
NVIDIA_VISIBLE_DEVICES: void
```

For CPU-only Unraid installs, set `NVIDIA_VISIBLE_DEVICES` to `void` in the template advanced settings.
