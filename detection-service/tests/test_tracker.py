from datetime import datetime, timezone
from app.tracker import ProcessTracker

def test_process_waits_for_fold_confirmation_and_completes_once():
    tracker = ProcessTracker(confirm_frames=2, threshold=.9)
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
    tracker = ProcessTracker(confirm_frames=2, threshold=.9)
    ready = [{"className": n, "confidence": .95} for n in ("work_area", "raw_box", "hand")]
    tracker.update(ready)
    assert tracker.update(ready + [{"className": "folded_box", "confidence": .89}])["completedCycle"] is None
    tracker.update(ready + [{"className": "folded_box", "confidence": .95}])
    assert tracker.update(ready)["completedCycle"] is None
