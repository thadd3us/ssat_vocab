import random
import sys
from collections import Counter

import pytest

from ssat_vocab.engine import StudyQueue, Stage

WORDS = [f"w{i:02d}" for i in range(1, 21)]


def ask(q: StudyQueue, correct: bool):
    """Answer the current word; return (word, transition)."""
    w = q.current
    return w, q.answer(correct)


def test_starts_in_order():
    q = StudyQueue(WORDS)
    assert q.order == WORDS
    assert q.current == "w01"


def test_correct_goes_to_back():
    q = StudyQueue(WORDS)
    _, t = ask(q, True)
    assert q.order == WORDS[1:] + ["w01"]
    assert t.stage_after is Stage.LEARNED
    assert t.slot == 21


def test_miss_comes_back_after_one_other_word():
    q = StudyQueue(WORDS)
    ask(q, False)  # miss w01
    assert q.order[:3] == ["w02", "w01", "w03"]
    assert q.stages["w01"] is Stage.MISSED


def test_full_recovery_path():
    q = StudyQueue(WORDS)
    shown = []
    def step(correct):
        w, _ = ask(q, correct)
        shown.append(w)

    step(False)  # w01 missed -> slot 3
    step(True)   # w02 right
    step(True)   # w01 right from MISSED -> slot 5
    assert q.stages["w01"] is Stage.RECOVERING
    assert q.order[:4] == ["w03", "w04", "w05", "w01"]
    step(True); step(True); step(True)  # w03 w04 w05
    step(True)   # w01 right from RECOVERING -> back, not yet learned
    assert shown == ["w01", "w02", "w01", "w03", "w04", "w05", "w01"]
    assert q.stages["w01"] is Stage.REVIEW
    assert q.order[-1] == "w01"
    # Next time around, a right answer makes it learned.
    while q.current != "w01":
        ask(q, True)
    ask(q, True)
    assert q.stages["w01"] is Stage.LEARNED


def test_miss_during_recovery_resets_to_slot_3():
    q = StudyQueue(WORDS)
    ask(q, False)   # w01 missed
    ask(q, True)    # w02
    ask(q, True)    # w01 -> recovering at slot 5
    for _ in range(3):
        ask(q, True)
    w, t = ask(q, False)
    assert w == "w01" and t.stage_before is Stage.RECOVERING
    assert t.stage_after is Stage.MISSED
    assert q.order[1] == "w01"


def test_learned_word_missed_later_is_relearned():
    q = StudyQueue(WORDS)
    ask(q, True)  # w01 learned
    while q.current != "w01":
        ask(q, True)
    ask(q, False)
    assert q.stages["w01"] is Stage.MISSED
    assert "w01" in q.mastered  # mastery sticks; the word is still re-drilled
    assert q.order[1] == "w01"


def test_all_correct_completes_in_one_pass():
    q = StudyQueue(WORDS)
    for expected in WORDS:
        w, _ = ask(q, True)
        assert w == expected
    assert q.complete
    assert q.order == WORDS  # cycled all the way around


def test_never_same_word_twice_in_a_row_when_avoidable():
    rng = random.Random(1)
    q = StudyQueue(WORDS)
    prev = None
    for _ in range(2000):
        w, _ = ask(q, rng.random() < 0.6)
        assert w != prev
        prev = w


def test_two_consecutive_misses_interleave():
    q = StudyQueue(WORDS)
    ask(q, False)  # w01 -> slot 3
    ask(q, False)  # w02 -> slot 3: w01, w02, w03...
    assert q.order[:4] == ["w01", "w02", "w03", "w04"]


def test_single_word_queue():
    q = StudyQueue(["only"])
    ask(q, False)
    assert q.current == "only"
    ask(q, True); ask(q, True); ask(q, True)
    assert q.complete


def test_short_queue_clamps_slots():
    q = StudyQueue(["a", "b", "c"])
    ask(q, False)  # a -> slot 3: [b, a, c]
    assert q.order == ["b", "a", "c"]
    ask(q, True)   # b -> back: [a, c, b]
    ask(q, True)   # a right from MISSED -> slot 5 clamps to end: [c, b, a]
    assert q.order == ["c", "b", "a"]


@pytest.mark.parametrize("accuracy,max_gap", [(0.9, 60), (0.7, 100), (0.5, 200)])
def test_no_word_is_starved(accuracy, max_gap):
    """Every word comes up within a bounded number of questions (100 seeded runs)."""
    for seed in range(100):
        rng = random.Random(seed)
        q = StudyQueue(WORDS)
        last_seen = {w: 0 for w in WORDS}
        for i in range(1, 1000):
            w, _ = ask(q, rng.random() < accuracy)
            last_seen[w] = i
            worst = max(last_seen, key=lambda x: i - last_seen[x])
            assert i - last_seen[worst] <= max_gap, (seed, worst, i)


def test_two_persistent_misses_ping_pong():
    """Documented quirk: two words missed over and over hold the front."""
    q = StudyQueue(WORDS)
    shown = [ask(q, False)[0] for _ in range(6)]
    assert shown == ["w01", "w02", "w01", "w02", "w01", "w02"]


@pytest.mark.parametrize("accuracy,max_questions", [(0.9, 140), (0.8, 160), (0.6, 600)])
def test_session_length_is_reasonable(accuracy, max_questions):
    """Simulated learners finish in a sane number of questions (100 seeded runs)."""
    for seed in range(100):
        rng = random.Random(seed)
        q = StudyQueue(WORDS)
        while not q.complete:
            ask(q, rng.random() < accuracy)
            assert q.asked <= max_questions, seed


def test_miss_after_mastered_keeps_mastery_but_redrills():
    q = StudyQueue(["a", "b", "c"])
    ask(q, True)            # a learned -> [b, c, a]
    ask(q, False)           # b missed  -> [c, b, a]
    ask(q, True)            # c learned -> [b, a, c]
    assert q.mastered == {"a", "c"}
    ask(q, True)            # b recovering -> [a, c, b]
    ask(q, False)           # a missed again -> [c, a, b]
    assert q.mastered == {"a", "c"}
    assert q.stages["a"] is Stage.MISSED and q.order[1] == "a"
    assert not q.complete   # b still needs a cold right answer


def test_back_offset_3_starves_tail():
    """Why "back 3 slots" isn't the default: with all-correct answers the last
    three words of the list never come up."""
    q = StudyQueue(WORDS, back_offset=3)
    seen = Counter(ask(q, True)[0] for _ in range(1000))
    assert set(WORDS) - set(seen) == {"w18", "w19", "w20"}


def test_rejects_bad_input():
    with pytest.raises(ValueError):
        StudyQueue([])
    with pytest.raises(ValueError):
        StudyQueue(["a", "a"])


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-q"]))
