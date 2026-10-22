import asyncio
import json
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone

import cv2
import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from ultralytics import YOLO

from .config import BACKEND_URL, CONFIDENCE_THRESHOLD, FOLDED_CONFIRMATION_THRESHOLD, MODEL_PATH, VIDEO_LOOP, VIDEO_PATHS
from .tracker import ProcessTracker

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("boxfolding")
CLASS_NAMES = {0: "work_area", 1: "raw_box", 2: "folded_box", 3: "hand"}

class Runtime:
    def __init__(self):
        self.model = None
        self.cap = None
        self.video_index = 0
        self.lock = asyncio.Lock()
        self.latest = {"state": "unavailable", "detections": [], "updatedAt": None, "activeCycle": None}
        self.tracker = ProcessTracker(threshold=FOLDED_CONFIRMATION_THRESHOLD)
        self.task = None
        self.publisher_task = None
        self.outgoing = asyncio.Queue(maxsize=20)
        self.running = False
        self.error = None

    async def publish(self, path: str, body: dict):
        try:
            async with httpx.AsyncClient(timeout=2) as client:
                response = await client.post(f"{BACKEND_URL}/api/{path}", json=body)
                response.raise_for_status()
        except Exception as exc:
            log.warning("Could not publish %s: %s", path, exc)

    async def publisher_loop(self):
        while True:
            item = await self.outgoing.get()
            try:
                if item is None:
                    return
                path, body = item
                await self.publish(path, body)
            finally:
                self.outgoing.task_done()

    async def infer_loop(self):
        loop = asyncio.get_running_loop()
        while self.running:
            fps = float(self.cap.get(cv2.CAP_PROP_FPS))
            if not 1 <= fps <= 120:
                fps = 25.0
            frame_interval = 1.0 / fps
            frame_started = loop.time()
            ok, frame = self.cap.read()
            if not ok:
                next_index = self.video_index + 1
                if next_index >= len(VIDEO_PATHS) and VIDEO_LOOP:
                    next_index = 0
                if next_index < len(VIDEO_PATHS):
                    self.cap.release()
                    self.video_index = next_index
                    self.cap = cv2.VideoCapture(str(VIDEO_PATHS[self.video_index]))
                    if self.cap.isOpened():
                        # A production cycle must not span separate recordings.
                        self.tracker = ProcessTracker(threshold=FOLDED_CONFIRMATION_THRESHOLD)
                        log.info("Playing next video (%d/%d): %s", self.video_index + 1, len(VIDEO_PATHS), VIDEO_PATHS[self.video_index].name)
                        await asyncio.sleep(0.01)
                        continue
                    runtime.error = f"Could not open video: {VIDEO_PATHS[self.video_index]}"
                else:
                    runtime.error = "Video sequence finished"
                self.running = False
                async with self.lock:
                    self.latest.update(state="unavailable", error=runtime.error, frame=None)
                if self.publisher_task:
                    await self.outgoing.put(None)
                log.info("Video processing stopped: %s", runtime.error)
                return
            try:
                predictions = await asyncio.to_thread(self.model.predict, frame, conf=CONFIDENCE_THRESHOLD, verbose=False)
                result = predictions[0]
                detections = []
                if result.boxes is not None:
                    for box in result.boxes:
                        class_id = int(box.cls[0].item())
                        if class_id not in CLASS_NAMES:
                            continue
                        x1, y1, x2, y2 = [float(v) for v in box.xyxy[0].tolist()]
                        detections.append({"classId": class_id, "className": CLASS_NAMES[class_id], "confidence": float(box.conf[0].item()), "box": [x1, y1, x2, y2]})
                tracker_update = self.tracker.update(detections)
                annotated = result.plot()
                ok, encoded = cv2.imencode(".jpg", annotated, [cv2.IMWRITE_JPEG_QUALITY, 82])
                async with self.lock:
                    self.latest = {"state": tracker_update["state"], "detections": detections, "updatedAt": datetime.now(timezone.utc).isoformat(), "activeCycle": tracker_update["activeCycle"], "videoName": VIDEO_PATHS[self.video_index].name, "frame": encoded.tobytes() if ok else None}
                status = {k: v for k, v in self.latest.items() if k != "frame"}
                # Publishing has its own worker so an unavailable backend never
                # stalls frame inference. Coalesce queued status snapshots.
                if self.outgoing.empty():
                    self.outgoing.put_nowait(("monitoring/status", status))
                if tracker_update["completedCycle"]:
                    try:
                        self.outgoing.put_nowait(("cycles", tracker_update["completedCycle"]))
                    except asyncio.QueueFull:
                        log.error("Publisher queue full; cycle event could not be queued")
                # Keep playback close to the source video's frame rate and give
                # FastAPI's event loop time to serve health, SignalR and clients.
                await asyncio.sleep(max(0.0, frame_interval - (loop.time() - frame_started)))
            except Exception as exc:
                log.exception("Inference failed")
                self.error = str(exc)
                await asyncio.sleep(.5)

runtime = Runtime()

@asynccontextmanager
async def lifespan(app: FastAPI):
    if not MODEL_PATH.is_file():
        runtime.error = f"Model file not found: {MODEL_PATH}"
        log.error(runtime.error)
    else:
        try:
            runtime.model = YOLO(str(MODEL_PATH))
            missing_videos = [path for path in VIDEO_PATHS if not path.is_file()]
            if not VIDEO_PATHS or missing_videos:
                runtime.error = "Video file(s) not found: " + ", ".join(str(path) for path in missing_videos)
            else:
                runtime.cap = cv2.VideoCapture(str(VIDEO_PATHS[0]))
                if not runtime.cap.isOpened():
                    runtime.error = f"Could not open video: {VIDEO_PATHS[0]}"
                else:
                    runtime.running = True
                    runtime.latest["videoName"] = VIDEO_PATHS[0].name
                    runtime.publisher_task = asyncio.create_task(runtime.publisher_loop())
                    runtime.task = asyncio.create_task(runtime.infer_loop())
        except Exception as exc:
            runtime.error = str(exc)
            log.exception("Could not start detection")
    yield
    runtime.running = False
    if runtime.task:
        runtime.task.cancel()
    if runtime.publisher_task:
        runtime.publisher_task.cancel()
    if runtime.cap:
        runtime.cap.release()

app = FastAPI(title="Box Folding Detection Service", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["*"],
)

@app.get("/health")
async def health():
    return {"service": "detection-service", "modelAvailable": MODEL_PATH.is_file(), "videoAvailable": bool(VIDEO_PATHS) and all(path.is_file() for path in VIDEO_PATHS), "videos": [path.name for path in VIDEO_PATHS], "currentVideo": VIDEO_PATHS[runtime.video_index].name if VIDEO_PATHS and runtime.video_index < len(VIDEO_PATHS) else None, "running": runtime.running, "error": runtime.error}

@app.get("/api/status")
async def status():
    async with runtime.lock:
        return {k: v for k, v in runtime.latest.items() if k != "frame"} | {"modelAvailable": MODEL_PATH.is_file(), "videoAvailable": bool(VIDEO_PATHS) and all(path.is_file() for path in VIDEO_PATHS), "videos": [path.name for path in VIDEO_PATHS], "error": runtime.error}

async def frames():
    while True:
        async with runtime.lock:
            frame = runtime.latest.get("frame")
            running = runtime.running
        if not running and not frame:
            break
        if frame:
            yield b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + frame + b"\r\n"
        await asyncio.sleep(.04)

@app.get("/video")
async def video():
    if not runtime.running:
        raise HTTPException(503, runtime.error or "Video inference is unavailable")
    return StreamingResponse(frames(), media_type="multipart/x-mixed-replace; boundary=frame")
