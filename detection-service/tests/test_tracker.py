from datetime import datetime, timedelta, timezone
from app.tracker import ProcessTracker

BASE = datetime(2026, 1, 1, tzinfo=timezone.utc)
READY = [
    {"className": name, "confidence": .95}
    for name in ("work_area", "raw_box", "hand")
]
FOLDED = READY + [{"className": "folded_box", "confidence": .85}]
ONLY_WORK_AREA = [{"className": "work_area", "confidence": .95}]


def test_completion_time_is_last_folded_box_detection_time():
    tracker = ProcessTracker(threshold=.8, completion_gap_seconds=1, min_folded_detections=2)
    tracker.update(READY, BASE)
    tracker.update(FOLDED, BASE + timedelta(seconds=2))
    last_folded = BASE + timedelta(seconds=2.4)
    tracker.update(FOLDED, last_folded)

    result = tracker.update(READY, BASE + timedelta(seconds=3.5))
    cycle = result["completedCycle"]
    assert result["state"] == "completed"
    assert cycle["completedAt"] == last_folded.isoformat()
    assert cycle["durationSeconds"] == 2.4


def test_low_confidence_and_single_folded_hit_do_not_complete():
    tracker = ProcessTracker(threshold=.8, completion_gap_seconds=1, min_folded_detections=2)
    tracker.update(READY, BASE)
    tracker.update(READY + [{"className": "folded_box", "confidence": .79}], BASE + timedelta(seconds=1))
    tracker.update(FOLDED, BASE + timedelta(seconds=2))
    result = tracker.update(READY, BASE + timedelta(seconds=3.1))
    assert result["completedCycle"] is None
    assert result["activeCycle"] is not None


def test_completed_cycle_waits_for_work_area_only_before_rearming():
    tracker = ProcessTracker(
        reset_confirm_frames=2,
        threshold=.8,
        completion_gap_seconds=1,
        min_folded_detections=2,
    )
    tracker.update(READY, BASE)
    tracker.update(FOLDED, BASE + timedelta(seconds=1))
    tracker.update(FOLDED, BASE + timedelta(seconds=1.2))
    completed = tracker.update(READY, BASE + timedelta(seconds=2.3))
    assert completed["completedCycle"] is not None

    # Persistent detections from the same box do not start a duplicate cycle.
    assert tracker.update(FOLDED, BASE + timedelta(seconds=2.4))["activeCycle"] is None
    assert tracker.update(READY, BASE + timedelta(seconds=2.5))["activeCycle"] is None

    assert tracker.update(ONLY_WORK_AREA, BASE + timedelta(seconds=2.6))["awaitingReset"] is True
    assert tracker.update(ONLY_WORK_AREA, BASE + timedelta(seconds=2.7))["awaitingReset"] is False
    assert tracker.update(READY, BASE + timedelta(seconds=2.8))["state"] == "in_progress"


def test_video_end_uses_last_qualifying_folded_detection():
    tracker = ProcessTracker(threshold=.8, completion_gap_seconds=1, min_folded_detections=2)
    tracker.update(READY, BASE)
    tracker.update(FOLDED, BASE + timedelta(seconds=1))
    last_folded = BASE + timedelta(seconds=1.3)
    tracker.update(FOLDED, last_folded)
    cycle = tracker.finish()
    assert cycle is not None
    assert cycle["completedAt"] == last_folded.isoformat()
