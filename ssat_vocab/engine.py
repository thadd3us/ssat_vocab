"""Spaced-repetition queue for one study session.

The session is an ordered list of words. The word at the front is asked.
Slots are counted with the word just asked as slot 1, so "slot 3" means
"one other word, then this word again".

  * Miss (any stage)            -> slot 3            stage = MISSED
  * Right while MISSED          -> slot 5            stage = RECOVERING
  * Right while RECOVERING      -> back of the list  stage = REVIEW
  * Right while NEW/REVIEW/...  -> back of the list  stage = LEARNED

A word is LEARNED when it is answered right "cold" (first sight, or a full
trip around the list after recovering); it then counts as mastered for the
session. Learned words stay in rotation as review; a later miss puts them
back into MISSED for re-drilling but does not un-master them. The session is
complete when every word has been mastered (the learner may keep going).

Known quirk: if the learner keeps missing two words back to back, those two
ping-pong at the front (A, B, A, B, ...) until one is answered right. That is
deliberate drilling, but it does hold up the rest of the list.

"Back of the list" is the very end by default. Placing it `back_offset`
slots before the end starves the last `back_offset` words forever when the
learner keeps answering correctly (see tests), so keep it at 0 unless you
also change how the tail is protected.
"""

from __future__ import annotations

import enum
from dataclasses import dataclass

MISS_SLOT = 3
RECOVER_SLOT = 5


class Stage(enum.StrEnum):
    NEW = "new"
    MISSED = "missed"
    RECOVERING = "recovering"
    REVIEW = "review"
    LEARNED = "learned"


@dataclass(frozen=True)
class Transition:
    word: str
    correct: bool
    stage_before: Stage
    stage_after: Stage
    # 1-indexed slot the word was moved to, counting the just-asked word as slot 1.
    slot: int


class StudyQueue:
    def __init__(self, words: list[str], back_offset: int = 0):
        if not words:
            raise ValueError("need at least one word")
        if len(set(words)) != len(words):
            raise ValueError("duplicate words")
        self._queue = list(words)
        self.stages: dict[str, Stage] = {w: Stage.NEW for w in words}
        self.mastered: set[str] = set()
        self.back_offset = back_offset
        self.asked = 0

    @property
    def current(self) -> str:
        return self._queue[0]

    @property
    def order(self) -> list[str]:
        return list(self._queue)

    @property
    def mastered_count(self) -> int:
        return len(self.mastered)

    @property
    def complete(self) -> bool:
        return len(self.mastered) == len(self.stages)

    def answer(self, correct: bool) -> Transition:
        word = self._queue.pop(0)
        before = self.stages[word]
        if not correct:
            after, index = Stage.MISSED, MISS_SLOT - 2
        elif before is Stage.MISSED:
            after, index = Stage.RECOVERING, RECOVER_SLOT - 2
        elif before is Stage.RECOVERING:
            after, index = Stage.REVIEW, len(self._queue) - self.back_offset
        else:
            after, index = Stage.LEARNED, len(self._queue) - self.back_offset
        index = max(0, min(index, len(self._queue)))
        self._queue.insert(index, word)
        self.stages[word] = after
        if after is Stage.LEARNED:
            self.mastered.add(word)
        self.asked += 1
        return Transition(word, correct, before, after, slot=index + 2)
