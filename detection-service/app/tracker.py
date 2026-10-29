from datetime import datetime, timezone
from uuid import uuid4


class ProcessTracker:
    """Tracks a confirmed stage0 -> stage1 -> stage2 box-folding cycle."""

    STAGES = ("stage0", "stage1", "stage2")

    def __init__(
        self,
        reset_confirm_frames: int = 5,
        threshold: float = 0.80,
        stage_confirm_detections: int = 2,
        stage2_completion_gap_seconds: float = 1.0,
    ):
        self.reset_confirm_frames = reset_confirm_frames
        self.threshold = threshold
        self.stage_confirm_detections = stage_confirm_detections
        self.stage2_completion_gap_seconds = stage2_completion_gap_seconds
        self.active = None
        self.awaiting_reset = False
        self.reset_frames = 0
        self.stage0_candidate_at = None
        self.stage0_candidate_confidence = 0.0
        self.stage0_hits = 0
        self.stage1_candidate_at = None
        self.stage1_candidate_confidence = 0.0
        self.stage1_hits = 0
        self.stage2_candidate_at = None
        self.stage2_candidate_confidence = 0.0
        self.stage2_last_seen_at = None
        self.stage2_hits = 0
        self.cycles = []

    @staticmethod
    def _iso(value: datetime | None) -> str | None:
        return value.isoformat() if value else None

    def _clear_stage_candidates(self):
        self.stage0_candidate_at = None
        self.stage0_candidate_confidence = 0.0
        self.stage0_hits = 0
        self.stage1_candidate_at = None
        self.stage1_candidate_confidence = 0.0
        self.stage1_hits = 0
        self.stage2_candidate_at = None
        self.stage2_candidate_confidence = 0.0
        self.stage2_last_seen_at = None
        self.stage2_hits = 0

    def _complete(self, operator_state: str = "unknown") -> dict:
        completed_at = self.stage2_last_seen_at
        started_at = datetime.fromisoformat(self.active["startedAt"])
        stage_times = {
            item["stage"]: datetime.fromisoformat(item["enteredAt"])
            for item in self.active["stageTimeline"]
        }
        stage0_at = stage_times["stage0"]
        stage1_at = stage_times["stage1"]
        stage2_at = stage_times["stage2"]
        cycle = {
            **self.active,
            "currentStage": "stage2",
            "completedAt": completed_at.isoformat(),
            "durationSeconds": max(0.0, (completed_at - started_at).total_seconds()),
            "stageDurationsSeconds": {
                "stage0": max(0.0, (stage1_at - stage0_at).total_seconds()),
                "stage1": max(0.0, (stage2_at - stage1_at).total_seconds()),
                "stage2": max(0.0, (completed_at - stage2_at).total_seconds()),
            },
            "status": "completed",
        }
        self.cycles.append(cycle)
        self.active = None
        self.awaiting_reset = True
        self.reset_frames = 0
        self._clear_stage_candidates()
        return {
            "state": "completed",
            "processState": "running" if operator_state == "active" else "idle" if operator_state == "idle" else "completed",
            "activeCycle": None,
            "completedCycle": cycle,
            "currentStage": "stage2",
            "awaitingReset": True,
            "operatorState": "unknown",
        }

    def _snapshot(self, now: datetime, operator_state: str, candidate_stage: str | None = None) -> dict:
        if self.active is None:
            return {
                "state": "waiting",
                "processState": "running" if operator_state == "active" else "idle" if operator_state == "idle" else "waiting",
                "activeCycle": None,
                "completedCycle": None,
                "currentStage": None,
                "candidateStage": candidate_stage,
                "awaitingReset": self.awaiting_reset,
                "resetFrames": self.reset_frames,
                "operatorState": operator_state,
            }

        stage_events = self.active["stageTimeline"]
        stage_started = datetime.fromisoformat(stage_events[-1]["enteredAt"])
        current_stage = self.active["currentStage"]
        active_cycle = {
            **self.active,
            "elapsedSeconds": max(0.0, (now - datetime.fromisoformat(self.active["startedAt"])).total_seconds()),
            "stageElapsedSeconds": max(0.0, (now - stage_started).total_seconds()),
            "completionPending": current_stage == "stage2",
        }
        return {
            "state": "in_progress",
            "processState": "running" if operator_state == "active" else "idle" if operator_state == "idle" else "in_progress",
            "activeCycle": active_cycle,
            "completedCycle": None,
            "currentStage": current_stage,
            "candidateStage": candidate_stage,
            "awaitingReset": False,
            "operatorState": operator_state,
        }

    def update(self, detections: list[dict], now: datetime | None = None, source_video: str | None = None) -> dict:
        now = now or datetime.now(timezone.utc)
        if now.tzinfo is None:
            now = now.replace(tzinfo=timezone.utc)

        # Use the highest confidence if a class has multiple boxes in one frame.
        by_name = {}
        for detection in detections:
            name = detection["className"]
            by_name[name] = max(by_name.get(name, 0.0), detection["confidence"])

        operator_state = (
            "active" if by_name.get("hand", 0.0) >= self.threshold
            else "idle" if by_name.get("idlehand", 0.0) >= self.threshold
            else "unknown"
        )

        # After a completed cycle, rearm only on a stable work-area-only view.
        if self.awaiting_reset:
            only_work_area = "workarea" in by_name and all(name == "workarea" for name in by_name)
            self.reset_frames = self.reset_frames + 1 if only_work_area else 0
            if self.reset_frames >= self.reset_confirm_frames:
                self.awaiting_reset = False
                self.reset_frames = 0
            else:
                return self._snapshot(now, operator_state)

        # Start timing at the first confirmed stage0 frame, with work area present.
        if self.active is None:
            if "workarea" in by_name and by_name.get("stage0", 0.0) >= self.threshold:
                if self.stage0_candidate_at is None:
                    self.stage0_candidate_at = now
                    self.stage0_candidate_confidence = by_name["stage0"]
                self.stage0_hits += 1
                self.stage0_candidate_confidence = max(self.stage0_candidate_confidence, by_name["stage0"])
                if self.stage0_hits >= self.stage_confirm_detections:
                    started_at = self.stage0_candidate_at
                    self.active = {
                        "cycleId": str(uuid4()),
                        "startedAt": started_at.isoformat(),
                        "currentStage": "stage0",
                        "sourceVideo": source_video,
                        "stageTimeline": [{
                            "stage": "stage0",
                            "enteredAt": started_at.isoformat(),
                            "confidence": self.stage0_candidate_confidence,
                        }],
                    }
                    self.stage0_candidate_at = None
                    self.stage0_hits = 0
            else:
                self.stage0_candidate_at = None
                self.stage0_candidate_confidence = 0.0
                self.stage0_hits = 0

        candidate_stage = None
        if self.active:
            current = self.active["currentStage"]
            if current == "stage0":
                if by_name.get("stage1", 0.0) >= self.threshold:
                    if self.stage1_candidate_at is None:
                        self.stage1_candidate_at = now
                        self.stage1_candidate_confidence = by_name["stage1"]
                    self.stage1_hits += 1
                    self.stage1_candidate_confidence = max(self.stage1_candidate_confidence, by_name["stage1"])
                    candidate_stage = "stage1"
                    if self.stage1_hits >= self.stage_confirm_detections:
                        self.active["currentStage"] = "stage1"
                        self.active["stageTimeline"].append({
                            "stage": "stage1",
                            "enteredAt": self.stage1_candidate_at.isoformat(),
                            "confidence": self.stage1_candidate_confidence,
                        })
                        self.stage1_candidate_at = None
                        self.stage1_candidate_confidence = 0.0
                        self.stage1_hits = 0
                else:
                    self.stage1_candidate_at = None
                    self.stage1_candidate_confidence = 0.0
                    self.stage1_hits = 0

            elif current == "stage1":
                if by_name.get("stage2", 0.0) >= self.threshold:
                    if (
                        self.stage2_last_seen_at is not None
                        and (now - self.stage2_last_seen_at).total_seconds() >= self.stage2_completion_gap_seconds
                        and self.stage2_hits >= self.stage_confirm_detections
                    ):
                        return self._complete(operator_state)
                    if self.stage2_candidate_at is None:
                        self.stage2_candidate_at = now
                        self.stage2_candidate_confidence = by_name["stage2"]
                    self.stage2_hits += 1
                    self.stage2_candidate_confidence = max(self.stage2_candidate_confidence, by_name["stage2"])
                    self.stage2_last_seen_at = now
                    candidate_stage = "stage2"
                    if self.stage2_hits >= self.stage_confirm_detections:
                        self.active["currentStage"] = "stage2"
                        self.active["stageTimeline"].append({
                            "stage": "stage2",
                            "enteredAt": self.stage2_candidate_at.isoformat(),
                            "confidence": self.stage2_candidate_confidence,
                        })
                else:
                    if self.stage2_last_seen_at is not None:
                        gap = (now - self.stage2_last_seen_at).total_seconds()
                        if gap >= self.stage2_completion_gap_seconds:
                            if self.stage2_hits >= self.stage_confirm_detections:
                                return self._complete(operator_state)
                            self.stage2_candidate_at = None
                            self.stage2_candidate_confidence = 0.0
                            self.stage2_last_seen_at = None
                            self.stage2_hits = 0

            elif current == "stage2":
                if by_name.get("stage2", 0.0) >= self.threshold:
                    if (
                        self.stage2_last_seen_at is not None
                        and (now - self.stage2_last_seen_at).total_seconds() >= self.stage2_completion_gap_seconds
                    ):
                        return self._complete(operator_state)
                    self.stage2_last_seen_at = now
                    self.stage2_hits += 1
                    candidate_stage = "stage2"
                elif self.stage2_last_seen_at is not None:
                    gap = (now - self.stage2_last_seen_at).total_seconds()
                    if gap >= self.stage2_completion_gap_seconds:
                        return self._complete(operator_state)

        return self._snapshot(now, operator_state, candidate_stage)

    def finish(self) -> dict | None:
        """Close a cycle at video end only if stage2 was confirmed."""
        if (
            self.active
            and self.active["currentStage"] == "stage2"
            and self.stage2_hits >= self.stage_confirm_detections
            and self.stage2_last_seen_at is not None
        ):
            return self._complete()["completedCycle"]
        self.active = None
        self._clear_stage_candidates()
        return None
