import asyncio
import logging
import os
import threading
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone

import cv2
import httpx
import torch
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from ultralytics import YOLO

from .config import (
    BACKEND_URL, CONFIDENCE_THRESHOLD, FRAME_SKIP, MODEL_PATH, RESET_CONFIRM_FRAMES,
    STAGE2_COMPLETION_GAP_SECONDS, STAGE_CONFIDENCE_THRESHOLD,
    STAGE_CONFIRMATION_DETECTIONS, VIDEO_LOOP, VIDEO_PATHS,
)
from .tracker import ProcessTracker

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("boxfolding")
CLASS_NAMES = {0: "workarea", 1: "stage0", 2: "stage1", 3: "stage2", 4: "hand", 5: "idlehand"}


class Runtime:
    def __init__(self):
        self.model = None
        self.device = "cpu"
        self.device_name = "CPU"
        self.video_index = 0
        self.capture_thread = None
        self.inference_task = None
        self.publisher_task = None
        self.running = False
        self.error = None
        self.lock = asyncio.Lock()
        self.capture_lock = threading.Lock()
        self.latest_capture = None  # (sequence, frame, capture timestamp, source index)
        self.capture_sequence = 0
        self.latest = {"state": "unavailable", "detections": [], "updatedAt": None, "activeCycle": None, "frame": None}
        self.frame_event = asyncio.Event()
        self.loop = None
        self.tracker = self.new_tracker()
        self.client = None
        self.status_snapshot = None
        self.cycle_queue = asyncio.Queue()
        self.metrics = {"capturedFrames": 0, "inferredFrames": 0, "obsoleteFramesSkipped": 0,
                        "inferenceSecondsTotal": 0.0, "inferenceSecondsMax": 0.0,
                        "annotationJpegSecondsTotal": 0.0, "captureFps": 0.0,
                        "inferenceFps": 0.0, "outputFps": 0.0, "frameAgeMs": None,
                        "sourceResolution": None, "outputResolution": None}
        self.capture_window = 0
        self.inference_window = 0
        self.last_status_publish = 0.0
        self.metric_window = time.monotonic()
        self.last_inferred_sequence = 0
        self.active_source_index = None
        self.finalized_source = False
        self.last_annotated_at = None

    @staticmethod
    def new_tracker():
        return ProcessTracker(reset_confirm_frames=RESET_CONFIRM_FRAMES, threshold=STAGE_CONFIDENCE_THRESHOLD,
                              stage_confirm_detections=STAGE_CONFIRMATION_DETECTIONS,
                              stage2_completion_gap_seconds=STAGE2_COMPLETION_GAP_SECONDS)

    def capture_loop(self):
        """The sole owner/reader of VideoCapture; replaces the shared frame, never queues it."""
        index = 0
        while self.running:
            if not VIDEO_PATHS:
                self.error = "No video sources configured"
                break
            self.video_index = index
            path = VIDEO_PATHS[index]
            cap = cv2.VideoCapture(str(path))
            if not cap.isOpened():
                cap.release()
                self.error = f"Could not open video: {path}"
                log.error(self.error)
                break
            fps = cap.get(cv2.CAP_PROP_FPS)
            interval = 1.0 / (fps if 1 <= fps <= 120 else 25.0)
            self.loop.call_soon_threadsafe(self.set_video_name, path.name)
            while self.running:
                started = time.monotonic()
                ok, frame = cap.read()
                if not ok:
                    break
                self.capture_sequence += 1
                timestamp = datetime.now(timezone.utc)
                with self.capture_lock:
                    self.latest_capture = (self.capture_sequence, frame, timestamp, index)
                self.metrics["capturedFrames"] += 1
                self.capture_window += 1
                self.metrics["sourceResolution"] = {"width": int(frame.shape[1]), "height": int(frame.shape[0])}
                self.loop.call_soon_threadsafe(self.frame_event.set)
                delay = interval - (time.monotonic() - started)
                if delay > 0:
                    time.sleep(delay)
            cap.release()
            if not self.running:
                break
            next_index = index + 1
            if next_index >= len(VIDEO_PATHS):
                if VIDEO_LOOP:
                    next_index = 0
                else:
                    self.error = "Video sequence finished"
                    self.running = False
                    break
            index = next_index
        self.running = False
        self.loop.call_soon_threadsafe(self.frame_event.set)

    def set_video_name(self, name):
        self.latest["videoName"] = name

    async def publish(self, path, body):
        try:
            response = await self.client.post(f"{BACKEND_URL}/api/{path}", json=body)
            response.raise_for_status()
            return True
        except Exception as exc:
            log.warning("Could not publish %s: %s", path, exc)
            return False

    async def publisher_loop(self):
        while self.running or self.status_snapshot is not None or not self.cycle_queue.empty():
            # Completed cycles take priority and use an unbounded reliable queue.
            try:
                cycle = self.cycle_queue.get_nowait()
            except asyncio.QueueEmpty:
                cycle = None
            if cycle is not None:
                if await self.publish("cycles", cycle):
                    self.cycle_queue.task_done()
                else:
                    self.cycle_queue.put_nowait(cycle)
                    self.cycle_queue.task_done()
                    await asyncio.sleep(1)
                continue
            if self.status_snapshot is not None:
                if time.monotonic() - self.last_status_publish >= STATUS_INTERVAL:
                    snapshot, self.status_snapshot = self.status_snapshot, None
                    await self.publish("monitoring/status", snapshot)
                    self.last_status_publish = time.monotonic()
                    continue
                await asyncio.sleep(.03)
                continue
            await asyncio.sleep(.03)

    def update_metric_rates(self):
        now = time.monotonic()
        elapsed = now - self.metric_window
        if elapsed >= 1:
            self.metrics["captureFps"] = round(self.capture_window / elapsed, 2)
            self.metrics["inferenceFps"] = round(self.inference_window / elapsed, 2)
            self.metrics["outputFps"] = self.metrics["inferenceFps"]
            self.metric_window = now
            self.capture_window = 0
            self.inference_window = 0
            log.info("Video metrics: capture %.1f FPS, inference/output %.1f/%.1f FPS, age %s ms",
                     self.metrics["captureFps"], self.metrics["inferenceFps"], self.metrics["outputFps"], self.metrics["frameAgeMs"])

    async def infer_loop(self):
        while True:
            with self.capture_lock:
                captured = self.latest_capture
            if not self.running and (captured is None or captured[0] == self.last_inferred_sequence):
                if not self.finalized_source:
                    completed = self.tracker.finish()
                    if completed:
                        self.cycle_queue.put_nowait(completed)
                    self.finalized_source = True
                break
            if captured is None or captured[0] == self.last_inferred_sequence:
                self.frame_event.clear()
                try:
                    await asyncio.wait_for(self.frame_event.wait(), timeout=.1)
                except asyncio.TimeoutError:
                    continue
                continue
            sequence, frame, captured_at, source_index = captured
            if self.active_source_index is not None and source_index != self.active_source_index:
                completed = self.tracker.finish()
                if completed:
                    self.cycle_queue.put_nowait(completed)
                self.tracker = self.new_tracker()
                self.finalized_source = False
            self.active_source_index = source_index
            gap = sequence - self.last_inferred_sequence
            if self.last_inferred_sequence and gap > 1:
                self.metrics["obsoleteFramesSkipped"] += gap - 1
            self.last_inferred_sequence = sequence
            # FRAME_SKIP is an inference sampling interval; each tracker update is unique.
            if FRAME_SKIP and (sequence - 1) % (FRAME_SKIP + 1):
                continue
            started = time.perf_counter()
            try:
                result = (await asyncio.to_thread(self.model.predict, frame, conf=CONFIDENCE_THRESHOLD,
                                                  device=self.device, verbose=False))[0]
                detections = []
                if result.boxes is not None:
                    for box in result.boxes:
                        class_id = int(box.cls[0].item())
                        if class_id not in CLASS_NAMES:
                            continue
                        x1, y1, x2, y2 = [float(v) for v in box.xyxy[0].tolist()]
                        detections.append({"classId": class_id, "className": CLASS_NAMES[class_id],
                                           "confidence": float(box.conf[0].item()), "box": [x1, y1, x2, y2]})
                tracker_update = self.tracker.update(detections, now=captured_at, source_video=VIDEO_PATHS[source_index].name)
                annotated = result.plot()
                height, width = annotated.shape[:2]
                scale = min(DISPLAY_WIDTH / width, DISPLAY_HEIGHT / height)
                if scale < 1:
                    annotated = cv2.resize(annotated, (int(width * scale), int(height * scale)), interpolation=cv2.INTER_AREA)
                encode_started = time.perf_counter()
                ok, encoded = cv2.imencode(".jpg", annotated, [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY])
                encode_seconds = time.perf_counter() - encode_started
                self.metrics["annotationJpegSecondsTotal"] += encode_seconds
                self.metrics["outputResolution"] = {"width": int(annotated.shape[1]), "height": int(annotated.shape[0])}
                inference_seconds = time.perf_counter() - started
                self.metrics["inferredFrames"] += 1
                self.inference_window += 1
                self.metrics["inferenceSecondsTotal"] += inference_seconds
                self.metrics["inferenceSecondsMax"] = max(self.metrics["inferenceSecondsMax"], inference_seconds)
                self.metrics["averageInferenceMs"] = round(self.metrics["inferenceSecondsTotal"] * 1000 / self.metrics["inferredFrames"], 2)
                self.metrics["averageAnnotationJpegMs"] = round(self.metrics["annotationJpegSecondsTotal"] * 1000 / self.metrics["inferredFrames"], 2)
                self.last_annotated_at = time.monotonic()
                self.metrics["frameAgeMs"] = round(max(0, (datetime.now(timezone.utc) - captured_at).total_seconds() * 1000), 1)
                async with self.lock:
                    last_completed = tracker_update.get("completedCycle") or self.latest.get("lastCompletedCycle")
                    self.latest = {"state": tracker_update["state"], "processState": tracker_update.get("processState", tracker_update["state"]),
                                   "currentStage": tracker_update.get("currentStage"), "candidateStage": tracker_update.get("candidateStage"),
                                   "awaitingReset": tracker_update.get("awaitingReset", False), "operatorState": tracker_update.get("operatorState", "unknown"),
                                   "detections": detections, "updatedAt": captured_at.isoformat(), "activeCycle": tracker_update["activeCycle"],
                                   "lastCompletedCycle": last_completed, "videoName": VIDEO_PATHS[source_index].name,
                                   "frame": encoded.tobytes() if ok else None}
                    snapshot = {k: v for k, v in self.latest.items() if k != "frame"}
                self.status_snapshot = snapshot  # one latest status snapshot, older snapshots coalesce
                if tracker_update.get("completedCycle"):
                    self.cycle_queue.put_nowait(tracker_update["completedCycle"])
                self.update_metric_rates()
            except Exception as exc:
                self.error = str(exc)
                log.exception("Inference failed")
                await asyncio.sleep(.2)


DISPLAY_WIDTH = max(160, int(os.getenv("DISPLAY_WIDTH", "960")))
DISPLAY_HEIGHT = max(90, int(os.getenv("DISPLAY_HEIGHT", "540")))
JPEG_QUALITY = min(95, max(40, int(os.getenv("JPEG_QUALITY", "70"))))
STATUS_INTERVAL = max(.5, float(os.getenv("STATUS_INTERVAL_SECONDS", ".75")))
runtime = Runtime()


@asynccontextmanager
async def lifespan(app: FastAPI):
    runtime.running = False
    runtime.loop = asyncio.get_running_loop()
    limits = httpx.Limits(max_connections=4, max_keepalive_connections=2)
    runtime.client = httpx.AsyncClient(timeout=httpx.Timeout(2.0), limits=limits)
    if torch.cuda.is_available():
        runtime.device, runtime.device_name = 0, torch.cuda.get_device_name(0)
    else:
        runtime.device, runtime.device_name = "cpu", "CPU"
    log.info("Using inference device: %s", runtime.device_name)
    try:
        if not MODEL_PATH.is_file():
            runtime.error = f"Model file not found: {MODEL_PATH}"
        elif not VIDEO_PATHS or any(not path.is_file() for path in VIDEO_PATHS):
            missing = [str(p) for p in VIDEO_PATHS if not p.is_file()]
            runtime.error = "Video file(s) not found: " + ", ".join(missing)
        else:
            runtime.model = YOLO(str(MODEL_PATH))
            runtime.running = True
            runtime.capture_thread = threading.Thread(target=runtime.capture_loop, name="video-capture", daemon=True)
            runtime.capture_thread.start()
            runtime.inference_task = asyncio.create_task(runtime.infer_loop())
            runtime.publisher_task = asyncio.create_task(runtime.publisher_loop())
    except Exception as exc:
        runtime.error = str(exc)
        log.exception("Could not start detection")
    yield
    runtime.running = False
    runtime.frame_event.set()
    if runtime.capture_thread:
        await asyncio.to_thread(runtime.capture_thread.join, 3)
    for task in (runtime.inference_task, runtime.publisher_task):
        if task:
            task.cancel()
    await asyncio.gather(*(t for t in (runtime.inference_task, runtime.publisher_task) if t), return_exceptions=True)
    if runtime.client:
        await runtime.client.aclose()


app = FastAPI(title="Box Folding Detection Service", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173"], allow_credentials=False,
                   allow_methods=["GET"], allow_headers=["*"])


@app.get("/health")
async def health():
    return {"service": "detection-service", "modelAvailable": MODEL_PATH.is_file(),
            "videoAvailable": bool(VIDEO_PATHS) and all(p.is_file() for p in VIDEO_PATHS),
            "videos": [p.name for p in VIDEO_PATHS], "currentVideo": VIDEO_PATHS[runtime.video_index].name if VIDEO_PATHS else None,
            "classNames": CLASS_NAMES, "inferenceDevice": runtime.device_name, "frameSkip": FRAME_SKIP,
            "displayWidth": DISPLAY_WIDTH, "displayHeight": DISPLAY_HEIGHT, "jpegQuality": JPEG_QUALITY,
            "stageConfidenceThreshold": STAGE_CONFIDENCE_THRESHOLD,
            "stageConfirmationDetections": STAGE_CONFIRMATION_DETECTIONS,
            "stage2CompletionGapSeconds": STAGE2_COMPLETION_GAP_SECONDS,
            "running": runtime.running, "error": runtime.error, "metrics": runtime.metrics}


@app.get("/api/status")
async def status():
    async with runtime.lock:
        return {k: v for k, v in runtime.latest.items() if k != "frame"} | {"inferenceDevice": runtime.device_name, "metrics": runtime.metrics, "error": runtime.error}


async def frames():
    last_frame = None
    while True:
        async with runtime.lock:
            frame = runtime.latest.get("frame")
            running = runtime.running
        if frame and frame is not last_frame:
            last_frame = frame
            yield b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + frame + b"\r\n"
        elif not running:
            break
        await asyncio.sleep(.01)


@app.get("/video")
async def video():
    if not runtime.running:
        raise HTTPException(503, runtime.error or "Video inference is unavailable")
    return StreamingResponse(frames(), media_type="multipart/x-mixed-replace; boundary=frame")
