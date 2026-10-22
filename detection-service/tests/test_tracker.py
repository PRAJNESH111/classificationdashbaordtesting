from datetime import datetime, timezone
from app.tracker import ProcessTracker

def test_process_waits_for_fold_confirmation_and_completes_once():
    tracker = ProcessTracker(confirm_frames=2, threshold=.8)
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    ready = [{"className": "work_area", "confidence": .95}, {"className": "raw_box", "confidence": .9}, {"className": "hand", "confidence": .91}]
    assert tracker.update(ready, now)["state"] == "in_progress"
    folded = ready + [{"className": "folded_box", "confidence": .91}]
    assert tracker.update(folded, now)["completedCycle"] is None
    result = tracker.update(folded, now)
    assert result["state"] == "completed"
    assert result["completedCycle"]["status"] == "completed"
    assert tracker.update(ready, now)["completedCycle"] is None

def test_low_confidence_and_interruption_do_not_complete():
    tracker = ProcessTracker(confirm_frames=2, threshold=.8)
    ready = [{"className": n, "confidence": .95} for n in ("work_area", "raw_box", "hand")]
    tracker.update(ready)
    assert tracker.update(ready + [{"className": "folded_box", "confidence": .79}])["completedCycle"] is None
    tracker.update(ready + [{"className": "folded_box", "confidence": .85}])
    assert tracker.update(ready)["completedCycle"] is None

def test_completed_cycle_waits_for_work_area_only_before_rearming():
    tracker = ProcessTracker(confirm_frames=2, reset_confirm_frames=2, threshold=.8)
    ready = [{"className": n, "confidence": .95} for n in ("work_area", "raw_box", "hand")]
    tracker.update(ready)
    folded = ready + [{"className": "folded_box", "confidence": .9}]
    tracker.update(folded)
    assert tracker.update(folded)["completedCycle"] is not None

    # Continued detections for the same box cannot immediately start/count it again.
    assert tracker.update(folded)["activeCycle"] is None
    assert tracker.update(ready)["activeCycle"] is None

    only_work_area = [{"className": "work_area", "confidence": .95}]
    assert tracker.update(only_work_area)["awaitingReset"] is True
    assert tracker.update(only_work_area)["awaitingReset"] is False
    assert tracker.update(ready)["state"] == "in_progress"
