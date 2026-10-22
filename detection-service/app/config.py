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
FOLDED_CONFIRMATION_THRESHOLD = float(os.getenv("FOLDED_CONFIRMATION_THRESHOLD", "0.90"))
BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:5000").rstrip("/")
VIDEO_LOOP = os.getenv("VIDEO_LOOP", "false").lower() == "true"
