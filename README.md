# Box Folding Detection and Monitoring

Local prototype using the existing YOLO model, a Python inference service, an ASP.NET Core API/SignalR backend, and a React dashboard.

## Model and video

The model is at `detection-service/weights/best.pt`. The detection service processes `vid1.mp4`, `vid2.mp4`, then `vid3.mp4` from `detection-service/videos/` in order, and stops after the last clip by default. The model class IDs are `0 workarea`, `1 stage0`, `2 stage1`, `3 stage2`, `4 hand`, and `5 idlehand`.

## Prerequisites

- Windows 10/11, PowerShell
- Python 3.10 or 3.11, .NET 10 SDK, Node.js 20.19+ or 22.12+
- The supplied `best.pt` and a compatible recorded video

## Install and run

From `C:\BoxFoldingSystem`, open three PowerShell terminals and run:

```powershell
./scripts/start-backend.ps1
./scripts/start-detection.ps1
./scripts/start-frontend.ps1
```

The detection script creates `.venv` and installs `requirements.txt` on its first run. To run tracker tests after the service dependencies are installed, use `detection-service\.venv\Scripts\python.exe -m pytest detection-service\tests`. For manual frontend setup, run `cd frontend; npm install; npm run dev`. The frontend URL is `http://localhost:5173`, backend `http://localhost:5000`, and detection service `http://localhost:8000`.

## Configuration

`detection-service/.env.example` documents the optional local settings. Copy it to `.env` to override `MODEL_PATH`, the comma-separated `VIDEO_PATHS` sequence, `CONFIDENCE_THRESHOLD` (default `0.50`), `STAGE_CONFIDENCE_THRESHOLD` (default `0.80`), `STAGE_CONFIRMATION_DETECTIONS` (default `2`), `STAGE2_COMPLETION_GAP_SECONDS` (default `1.0`), `RESET_CONFIRM_FRAMES` (default `5`), `FRAME_SKIP` (default `0`, infer each captured frame; raise only after measuring), `DISPLAY_WIDTH`/`DISPLAY_HEIGHT` (default `960`/`540`), `JPEG_QUALITY` (default `70`), `STATUS_INTERVAL_SECONDS` (default `0.75`, minimum `0.5`), `BACKEND_URL`, or `VIDEO_LOOP` (default `false`). Set `VIDEO_LOOP=true` to repeat the entire sequence. Relative paths resolve from `detection-service`. The frontend URLs are in `frontend/.env.development`.

## NVIDIA GPU inference

The detection service automatically selects CUDA GPU 0 when the installed PyTorch build can access it, and otherwise uses CPU. To use an NVIDIA GPU, install its current NVIDIA driver, stop the detection service, and remove the CPU-only PyTorch packages from its virtual environment with `detection-service\.venv\Scripts\python.exe -m pip uninstall -y torch torchvision torchaudio`. Then select **Windows → Pip → Python → CUDA** at the [official PyTorch install selector](https://pytorch.org/get-started/locally/) and run the generated install command using `detection-service\.venv\Scripts\python.exe -m pip` in place of `pip`. Restart the service and verify `torch.cuda.is_available()` is `True`; `GET http://localhost:8000/health` and the dashboard Settings page show the active inference device. The PyTorch selector chooses a compatible CUDA wheel for its current release and driver requirements.

## API checks

- `GET http://localhost:5000/health` — ASP.NET health
- `GET http://localhost:5000/api/monitoring/status` — latest detections
- `GET http://localhost:5000/api/cycles` — completed cycles
- `GET http://localhost:5000/api/reports/summary` — totals and hourly counts
- `GET http://localhost:5000/hubs/monitoring` — SignalR hub negotiation endpoint
- `GET http://localhost:8000/health` — model/video/inference availability
- `GET http://localhost:8000/api/status` — current detection state
- `GET http://localhost:8000/video` — annotated MJPEG stream

The Python service posts live stage status and completed cycle events to the backend. Capture, inference and MJPEG delivery use independent latest-frame flow; if inference falls behind, obsolete frames are skipped rather than queued. The display is resized to fit the configured dimensions, while inference uses the original frame resolution. JPEG data is encoded once per inference result. All six model classes (`workarea`, `stage0`, `stage1`, `stage2`, `hand`, `idlehand`) remain mapped. A cycle starts after `workarea` and `stage0` are confirmed in distinct sampled frames. It advances in order through `stage0`, `stage1`, then `stage2`; each transition timestamp and confidence is saved in `stageTimeline`. A cycle completes only after stage2 is confirmed and no further stage2 detection is seen for the configured gap. The completion time is the last stage2 detection time; the cycle also stores total duration and per-stage durations. A confirmed stage2 is finalized at its last detection time when a clip ends. After completion, the tracker requires five sampled frames containing only `workarea` before it rearms. `hand` and `idlehand` are reported as operator states and do not start or complete cycles. Cycle records are de-duplicated by cycle ID. Report duration statistics include completed cycles only. Timestamps are stored in UTC. `/health` exposes aggregated capture/inference FPS, inference and encoding durations, skipped frames, resolution and latest frame age. Downtime and idle-time are not inferred by this prototype.

### First-run stage averages

After each completed cycle, the dashboard saves each stage duration under its source video in browser local storage. For the baseline, it first averages a stage's cycles within each video, then averages those per-video averages equally. This keeps a video with more cycles from outweighing another video. For example, stage 0 durations of 1, 2, and 3 minutes across three videos produce a 2-minute baseline; stage 2 durations of 4, 2, and 4 minutes produce 3.33 minutes. The baseline becomes more representative as each configured video completes. The Reports API uses the same per-video weighting for stage averages.

## Troubleshooting

- **Model unavailable:** confirm `detection-service/weights/best.pt` exists and Ultralytics can load it.
- **Video unavailable:** confirm all configured `VIDEO_PATHS` exist under `detection-service` and are readable by OpenCV.
- **No detections:** verify class IDs in your model match the four configured class IDs and lower `CONFIDENCE_THRESHOLD` carefully.
- **Dashboard says disconnected:** start backend and detection service; check their `/health` endpoints and keep the Vite origin at port 5173.
- **Backend doesn't start:** ensure .NET 10 SDK is installed and port 5000 is free.

## Verification checklist

1. Start all three services and verify health endpoints.
2. Confirm detection reports the model and video as available.
3. Open the dashboard and confirm the annotated feed and per-class confidence updates.
4. Check the process state transitions and a completed cycle appears once in history.
5. Verify reports use only recorded completed cycles and export a CSV.
6. Stop a service and confirm the UI shows that service as unavailable.

## Prototype limits

Data is in memory and resets when the backend restarts. The stage tracker requires the ordered `stage0` → `stage1` → `stage2` sequence with confidence confirmation. `stage2` is finalized after its detections stop, while its event time remains the last detected stage2 frame. Validate the stage order and confirmation settings against the actual line footage before relying on cycle counts. The video is a single shared inference source; multiple browsers do not run separate inference.
