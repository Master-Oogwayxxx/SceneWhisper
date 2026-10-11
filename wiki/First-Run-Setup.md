# First Run Setup

Use this checklist after installing SceneWhisper.

## 1. Confirm Volumes

Make sure the video library path points at the files you want SceneWhisper to scan.

Common container paths:

| Container path | Purpose |
| --- | --- |
| `/videos` | Video library |
| `/data` | Database, logs, runtime data |
| `/root/.cache/huggingface` | Hugging Face model cache |

## 2. Open the UI

Open the frontend:

```text
http://<host>:5175
```

For Docker Compose on the same machine:

```text
http://localhost:5175
```

## 3. Scan Your Library

Open Settings, then use the Actions tab.

- Run a full scan to index every supported video under the configured library.
- Use selective scan when you only want to index specific top-level folders.
- Enable auto-cleanup on scan if you want missing files cleaned up after scanning.

After the scan, indexed files appear in All Files.

## 4. Set Defaults

Open Settings, then review:

- Default task type
- Default subtitle language
- Default file layout
- Default sort field and direction
- Processing hours
- Scene detection and concurrency settings

## 5. Queue a Test File

From All Files, pick a small file and queue a task such as Scene, Split, Subtitle, All, Remux, or Frame Pacing Repair. Watch progress in Task Queue and confirm logs are clean.

## 6. Add Automation

Once manual processing works, create Directory Monitors for recurring work. Monitors can run hourly, daily, or weekly and can apply selected task types to matching folders.
