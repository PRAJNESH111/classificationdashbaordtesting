# Box Folding Detection and Monitoring

Local prototype using the existing YOLO model, a Python inference service, an ASP.NET Core API/SignalR backend, and a React dashboard.

## Model and video

The model is at `detection-service/weights/best.pt`. The detection service processes `vid1.mp4`, `vid2.mp4`, then `vid3.mp4` from `detection-service/videos/` in order, and stops after the last clip by default. Preserve the model's original class IDs: `work_area`, `raw_box`, `folded_box`, and `hand`.

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

`detection-service/.env.example` documents the optional local settings. Copy it to `.env` to override `MODEL_PATH`, the comma-separated `VIDEO_PATHS` sequence, `CONFIDENCE_THRESHOLD` (default `0.50`), `FOLDED_CONFIRMATION_THRESHOLD` (default `0.80`), `BACKEND_URL`, or `VIDEO_LOOP` (default `false`). Set `VIDEO_LOOP=true` to repeat the entire sequence. Relative paths resolve from `detection-service`. The frontend URLs are in `frontend/.env.development`.

## API checks

- `GET http://localhost:5000/health` — ASP.NET health
- `GET http://localhost:5000/api/monitoring/status` — latest detections
- `GET http://localhost:5000/api/cycles` — completed cycles
- `GET http://localhost:5000/api/reports/summary` — totals and hourly counts
- `GET http://localhost:5000/hubs/monitoring` — SignalR hub negotiation endpoint
- `GET http://localhost:8000/health` — model/video/inference availability
- `GET http://localhost:8000/api/status` — current detection state
- `GET http://localhost:8000/video` — annotated MJPEG stream

The Python service posts status and completed cycle events to the backend. A cycle completes after five consecutive frames with folded-box confidence at or above the configured threshold. After completion, the tracker requires five consecutive frames containing only `work_area` before it can start another cycle. Cycle records are de-duplicated by cycle ID. Report duration statistics include completed cycles only. Timestamps are stored in UTC. Downtime and idle-time are not inferred by this prototype.

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

Data is in memory and resets when the backend restarts. The cycle tracker starts when work area, raw box and hand appear together, then confirms folded-box confidence for five frames. Validate this rule against the actual line footage before relying on cycle counts. The video is a single shared inference source; multiple browsers do not run separate inference.
