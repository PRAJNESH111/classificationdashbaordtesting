import os
from pathlib import Path
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")

def resolve_path(raw_value: str) -> Path:
    value = Path(raw_value)
    return value if value.is_absolute() else (ROOT / value).resolve()

def path_setting(name: str, default: str) -> Path:
    return resolve_path(os.getenv(name, default))

MODEL_PATH = path_setting("MODEL_PATH", "weights/best.pt")
VIDEO_PATHS = [
    resolve_path(value.strip())
    for value in os.getenv(
        "VIDEO_PATHS",
        "videos/vid1.mp4,videos/vid2.mp4,videos/vid3.mp4",
    ).split(",")
    if value.strip()
]
CONFIDENCE_THRESHOLD = float(os.getenv("CONFIDENCE_THRESHOLD", "0.50"))
STAGE_CONFIDENCE_THRESHOLD = float(
    os.getenv("STAGE_CONFIDENCE_THRESHOLD", os.getenv("FOLDED_CONFIRMATION_THRESHOLD", "0.80"))
)
STAGE_CONFIRMATION_DETECTIONS = max(1, int(os.getenv("STAGE_CONFIRMATION_DETECTIONS", "2")))
STAGE2_COMPLETION_GAP_SECONDS = max(0.1, float(os.getenv("STAGE2_COMPLETION_GAP_SECONDS", "1.0")))
RESET_CONFIRM_FRAMES = max(1, int(os.getenv("RESET_CONFIRM_FRAMES", "5")))
FRAME_SKIP = max(0, int(os.getenv("FRAME_SKIP", "3")))
BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:5000").rstrip("/")
VIDEO_LOOP = os.getenv("VIDEO_LOOP", "false").lower() == "true"
