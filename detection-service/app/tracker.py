from datetime import datetime, timezone
from uuid import uuid4


class ProcessTracker:
    """Tracks one box cycle and timestamps completion at the last folded-box hit."""

    def __init__(
        self,
        reset_confirm_frames: int = 5,
        threshold: float = 0.80,
        completion_gap_seconds: float = 1.0,
        min_folded_detections: int = 2,
    ):
        self.reset_confirm_frames = reset_confirm_frames
        self.threshold = threshold
        self.completion_gap_seconds = completion_gap_seconds
        self.min_folded_detections = min_folded_detections
        self.active = None
        self.last_folded_at = None
        self.folded_detections = 0
        self.awaiting_reset = False
        self.reset_frames = 0
        self.cycles = []

    def _complete(self, completed_at: datetime) -> dict:
        started_at = datetime.fromisoformat(self.active["startedAt"])
        completed = {
            **self.active,
            "completedAt": completed_at.isoformat(),
            "durationSeconds": max(0, (completed_at - started_at).total_seconds()),
            "status": "completed",
        }
        self.cycles.append(completed)
        self.active = None
        self.last_folded_at = None
        self.folded_detections = 0
        self.awaiting_reset = True
        self.reset_frames = 0
        return {
            "state": "completed",
            "activeCycle": None,
            "completedCycle": completed,
            "awaitingReset": True,
        }

    def _clear_folded_candidate(self) -> None:
        self.last_folded_at = None
        self.folded_detections = 0

    def update(self, detections: list[dict], now: datetime | None = None) -> dict:
        now = now or datetime.now(timezone.utc)
        if now.tzinfo is None:
            now = now.replace(tzinfo=timezone.utc)

        # Multiple detections for the same class in one frame count as one hit;
        # keep the strongest confidence for threshold checks.
        by_name = {}
        for detection in detections:
            name = detection["className"]
            by_name[name] = max(by_name.get(name, 0), detection["confidence"])

        # Rearm only after a stable baseline: work area visible, every other
        # class absent for the configured number of processed frames.
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

        ready = (
            by_name.get("work_area", 0) > 0
            and by_name.get("raw_box", 0) > 0
            and by_name.get("hand", 0) > 0
        )
        if self.active is None and ready:
            self.active = {"cycleId": str(uuid4()), "startedAt": now.isoformat()}

        if self.active:
            folded_detected = by_name.get("folded_box", 0) >= self.threshold
            if folded_detected:
                # If a long gap passed without a sampled folded detection, the
                # previous cluster ended before this new hit.
                if (
                    self.last_folded_at is not None
                    and (now - self.last_folded_at).total_seconds() >= self.completion_gap_seconds
                    and self.folded_detections >= self.min_folded_detections
                ):
                    return self._complete(self.last_folded_at)
                if (
                    self.last_folded_at is not None
                    and (now - self.last_folded_at).total_seconds() >= self.completion_gap_seconds
                ):
                    self._clear_folded_candidate()
                self.last_folded_at = now
                self.folded_detections += 1
            elif self.last_folded_at is not None:
                gap = (now - self.last_folded_at).total_seconds()
                if gap >= self.completion_gap_seconds:
                    if self.folded_detections >= self.min_folded_detections:
                        return self._complete(self.last_folded_at)
                    self._clear_folded_candidate()

        elapsed = (
            (now - datetime.fromisoformat(self.active["startedAt"])).total_seconds()
            if self.active
            else None
        )
        state = "in_progress" if self.active else ("waiting" if "work_area" in by_name else "unavailable")
        return {
            "state": state,
            "activeCycle": ({**self.active, "elapsedSeconds": elapsed} if self.active else None),
            "completedCycle": None,
            "awaitingReset": False,
            "foldedBoxLastSeenAt": self.last_folded_at.isoformat() if self.last_folded_at else None,
        }

    def finish(self) -> dict | None:
        """Finalize a confirmed folded-box cluster at end of a recording."""
        if (
            self.active
            and self.last_folded_at is not None
            and self.folded_detections >= self.min_folded_detections
        ):
            return self._complete(self.last_folded_at)["completedCycle"]
        self.active = None
        self._clear_folded_candidate()
        return None
