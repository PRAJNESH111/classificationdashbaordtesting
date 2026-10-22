from datetime import datetime, timezone
from uuid import uuid4

class ProcessTracker:
    """A cycle starts when work area, raw box and hand are visible, and ends
    after folded_box remains above the confirmation confidence for 5 frames."""
    def __init__(self, confirm_frames: int = 5, reset_confirm_frames: int = 5, threshold: float = 0.80):
        self.confirm_frames = confirm_frames
        self.reset_confirm_frames = reset_confirm_frames
        self.threshold = threshold
        self.active = None
        self.folded_frames = 0
        self.awaiting_reset = False
        self.reset_frames = 0
        self.cycles = []

    def update(self, detections: list[dict], now: datetime | None = None) -> dict:
        now = now or datetime.now(timezone.utc)
        by_name = {}
        for detection in detections:
            name = detection["className"]
            by_name[name] = max(by_name.get(name, 0), detection["confidence"])

        # After completion, require a stable empty work area before rearming.
        # This prevents one persistent folded box from completing repeatedly.
        if self.awaiting_reset:
            only_work_area = "work_area" in by_name and all(
                name == "work_area" for name in by_name
            )
            self.reset_frames = self.reset_frames + 1 if only_work_area else 0
            if self.reset_frames >= self.reset_confirm_frames:
                self.awaiting_reset = False
                self.reset_frames = 0
            else:
                return {
                    "state": "waiting",
                    "activeCycle": None,
                    "completedCycle": None,
                    "awaitingReset": True,
                    "resetFrames": self.reset_frames,
                }

        ready = by_name.get("work_area", 0) > 0 and by_name.get("raw_box", 0) > 0 and by_name.get("hand", 0) > 0
        if self.active is None and ready:
            self.active = {"cycleId": str(uuid4()), "startedAt": now.isoformat()}
            self.folded_frames = 0
        if self.active:
            if by_name.get("folded_box", 0) >= self.threshold:
                self.folded_frames += 1
            else:
                self.folded_frames = 0
            if self.folded_frames >= self.confirm_frames:
                completed = {**self.active, "completedAt": now.isoformat(), "durationSeconds": max(0, (now - datetime.fromisoformat(self.active['startedAt'])).total_seconds()), "status": "completed"}
                self.cycles.append(completed)
                self.active = None
                self.folded_frames = 0
                self.awaiting_reset = True
                self.reset_frames = 0
                return {"state": "completed", "activeCycle": None, "completedCycle": completed, "awaitingReset": True}
        state = "in_progress" if self.active else ("waiting" if by_name.get("work_area", 0) else "unavailable")
        elapsed = (now - datetime.fromisoformat(self.active["startedAt"])).total_seconds() if self.active else None
        return {"state": state, "activeCycle": ({**self.active, "elapsedSeconds": elapsed} if self.active else None), "completedCycle": None, "awaitingReset": False}
