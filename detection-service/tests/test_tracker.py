from datetime import datetime, timedelta, timezone
from app.tracker import ProcessTracker

BASE = datetime(2026, 1, 1, tzinfo=timezone.utc)
WORK = {"className": "workarea", "confidence": .95}
STAGE0 = {"className": "stage0", "confidence": .90}
STAGE1 = {"className": "stage1", "confidence": .91}
STAGE2 = {"className": "stage2", "confidence": .92}
READY0 = [WORK, STAGE0]
ONLY_WORK_AREA = [WORK]


def start_cycle(tracker):
    tracker.update(READY0, BASE)
    return tracker.update(READY0, BASE + timedelta(seconds=.2))


def advance_to_stage1(tracker):
    tracker.update([WORK, STAGE1], BASE + timedelta(seconds=1))
    return tracker.update([WORK, STAGE1], BASE + timedelta(seconds=1.2))


def test_stage_sequence_records_transition_times_and_total_duration():
    tracker = ProcessTracker(stage_confirm_detections=2, threshold=.8, stage2_completion_gap_seconds=1)
    assert start_cycle(tracker)["activeCycle"]["currentStage"] == "stage0"
    advance_to_stage1(tracker)
    tracker.update([WORK, STAGE2], BASE + timedelta(seconds=2))
    pending = tracker.update([WORK, STAGE2], BASE + timedelta(seconds=2.2))
    assert pending["activeCycle"]["currentStage"] == "stage2"
    assert pending["activeCycle"]["completionPending"] is True

    result = tracker.update([WORK], BASE + timedelta(seconds=3.3))
    cycle = result["completedCycle"]
    assert result["state"] == "completed"
    assert [event["stage"] for event in cycle["stageTimeline"]] == ["stage0", "stage1", "stage2"]
    assert cycle["startedAt"] == BASE.isoformat()
    assert cycle["stageTimeline"][1]["enteredAt"] == (BASE + timedelta(seconds=1)).isoformat()
    assert cycle["stageTimeline"][2]["enteredAt"] == (BASE + timedelta(seconds=2)).isoformat()
    assert cycle["completedAt"] == (BASE + timedelta(seconds=2.2)).isoformat()
    assert cycle["durationSeconds"] == 2.2
    assert cycle["stageDurationsSeconds"] == {"stage0": 1.0, "stage1": 1.0, "stage2": .2}


def test_stage2_does_not_complete_without_stage1():
    tracker = ProcessTracker(stage_confirm_detections=2, threshold=.8)
    start_cycle(tracker)
    tracker.update([WORK, STAGE2], BASE + timedelta(seconds=1))
    result = tracker.update([WORK, STAGE2], BASE + timedelta(seconds=1.2))
    assert result["activeCycle"]["currentStage"] == "stage0"
    assert result["completedCycle"] is None


def test_cycle_rearms_only_after_workarea_alone_is_stable():
    tracker = ProcessTracker(
        reset_confirm_frames=2,
        stage_confirm_detections=2,
        threshold=.8,
        stage2_completion_gap_seconds=1,
    )
    start_cycle(tracker)
    advance_to_stage1(tracker)
    tracker.update([WORK, STAGE2], BASE + timedelta(seconds=2))
    tracker.update([WORK, STAGE2], BASE + timedelta(seconds=2.2))
    completed = tracker.update([WORK], BASE + timedelta(seconds=3.3))
    assert completed["completedCycle"] is not None

    blocked = tracker.update(READY0, BASE + timedelta(seconds=3.4))
    assert blocked["activeCycle"] is None
    assert blocked["awaitingReset"] is True
    tracker.update(ONLY_WORK_AREA, BASE + timedelta(seconds=3.5))
    rearmed = tracker.update(ONLY_WORK_AREA, BASE + timedelta(seconds=3.6))
    assert rearmed["awaitingReset"] is False
    assert tracker.update(READY0, BASE + timedelta(seconds=3.7))["activeCycle"] is None
    assert tracker.update(READY0, BASE + timedelta(seconds=3.8))["activeCycle"]["currentStage"] == "stage0"


def test_hand_and_idlehand_are_reported_without_advancing_stage():
    tracker = ProcessTracker(stage_confirm_detections=2)
    first = tracker.update([WORK, STAGE0, {"className": "hand", "confidence": .9}], BASE)
    assert first["operatorState"] == "active"
    assert first["processState"] == "running"
    idle = tracker.update([WORK, STAGE0, {"className": "idlehand", "confidence": .9}], BASE + timedelta(seconds=.2))
    assert idle["operatorState"] == "idle"
    assert idle["processState"] == "idle"
    assert idle["activeCycle"]["currentStage"] == "stage0"


def test_video_end_completes_confirmed_stage2_at_last_detection_time():
    tracker = ProcessTracker(stage_confirm_detections=2, threshold=.8)
    start_cycle(tracker)
    advance_to_stage1(tracker)
    tracker.update([WORK, STAGE2], BASE + timedelta(seconds=2))
    last_seen = BASE + timedelta(seconds=2.2)
    tracker.update([WORK, STAGE2], last_seen)
    completed = tracker.finish()
    assert completed is not None
    assert completed["completedAt"] == last_seen.isoformat()
