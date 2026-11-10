"""Word list loading, grouping, and multiple-choice question building."""

from __future__ import annotations

import json
import random
from dataclasses import dataclass
from pathlib import Path

GROUP_SIZE = 20
N_OPTIONS = 5  # SSAT-style A-E

# Question modes.
WORD_TO_DEF = "word_to_def"  # show the word, pick its definition
DEF_TO_WORD = "def_to_word"  # show the definition, pick the word
MIXED = "mixed"
MODES = (WORD_TO_DEF, DEF_TO_WORD, MIXED)

# Near-synonyms the word list doesn't cross-reference. Never offered together,
# since either could fairly be called right. (Found by reviewing the list;
# pairs sharing a listed synonym are caught automatically.)
NEAR_SYNONYMS = [
    {"impetuous", "rash"},
    {"coerce", "compel"},
    {"potent", "robust"},
    {"zealous", "avid"},
    {"scorn", "spurn", "rebuff"},
    {"steadfast", "staunch"},
    {"servile", "submissive"},
    {"demean", "disparage"},
    {"wary", "prudent"},
    {"desolate", "forlorn"},
    {"paltry", "petty"},
    {"eradicate", "obliterate"},
]


@dataclass(frozen=True)
class Entry:
    rank: int
    word: str
    pos: str
    definition: str
    synonyms: tuple[str, ...]
    antonyms: tuple[str, ...]
    distractors: tuple[str, ...]


class Vocab:
    def __init__(self, entries: list[Entry]):
        self.entries = entries
        self.by_word = {e.word.lower(): e for e in entries}

    @classmethod
    def load(cls, path: Path) -> "Vocab":
        entries = []
        with open(path) as f:
            for line in f:
                if line.strip():
                    d = json.loads(line)
                    entries.append(
                        Entry(
                            rank=d["rank"],
                            word=d["word"].strip(),
                            pos=d.get("pos", ""),
                            definition=d["definition"].strip(),
                            synonyms=tuple(d.get("synonyms", ())),
                            antonyms=tuple(d.get("antonyms", ())),
                            distractors=tuple(d.get("distractors", ())),
                        )
                    )
        entries.sort(key=lambda e: e.rank)
        return cls(entries)

    @property
    def groups(self) -> list[list[Entry]]:
        """Consecutive chunks of GROUP_SIZE, in rank order. The last may be short."""
        return [self.entries[i : i + GROUP_SIZE] for i in range(0, len(self.entries), GROUP_SIZE)]

    def group(self, n: int) -> list[Entry]:
        """1-indexed group."""
        groups = self.groups
        if not 1 <= n <= len(groups):
            raise KeyError(n)
        return groups[n - 1]

    def _too_close(self, target: Entry, other_word: str) -> bool:
        """Would `other_word` also be a correct answer for `target`?"""
        w = other_word.lower()
        if w == target.word.lower():
            return True
        if w in {s.lower() for s in target.synonyms}:
            return True
        t = target.word.lower()
        if any(t in group and w in group for group in NEAR_SYNONYMS):
            return True
        other = self.by_word.get(w)
        if other is None:
            return False
        if other.definition.lower() == target.definition.lower():
            return True
        other_syns = {s.lower() for s in other.synonyms}
        return t in other_syns or bool(other_syns & {s.lower() for s in target.synonyms})

    def build_question(
        self, target: Entry, mode: str, rng: random.Random, pool: list[Entry] | None = None
    ) -> dict:
        """Build a multiple-choice question.

        Half the wrong answers come from the target's curated distractors and
        half are random words from `pool` (the study group, falling back to the
        whole list). In WORD_TO_DEF mode only distractors that are themselves in
        the word list can be used, since we need their definitions.
        """
        if mode == MIXED:
            mode = rng.choice((WORD_TO_DEF, DEF_TO_WORD))
        n_wrong = N_OPTIONS - 1
        n_from_distractors = n_wrong // 2

        candidates = [d for d in target.distractors if not self._too_close(target, d)]
        if mode == WORD_TO_DEF:
            candidates = [d for d in candidates if d.lower() in self.by_word]
        rng.shuffle(candidates)

        wrong: list[str] = []
        seen_texts = {self._answer_text(target, mode).lower()}

        def take(words, limit=n_wrong):
            added = 0
            for w in words:
                if len(wrong) >= n_wrong or added >= limit:
                    return
                text = self._answer_text_for_word(w, mode)
                if text.lower() in seen_texts or self._too_close(target, w):
                    continue
                seen_texts.add(text.lower())
                wrong.append(w)
                added += 1

        take(candidates, limit=n_from_distractors)
        random_pool = [e.word for e in (pool or self.entries)]
        rng.shuffle(random_pool)
        take(random_pool)
        if len(wrong) < n_wrong:  # tiny pool: top up from distractors, then everything
            take(candidates)
            everything = [e.word for e in self.entries]
            rng.shuffle(everything)
            take(everything)

        option_words = [target.word] + wrong
        rng.shuffle(option_words)
        return {
            "mode": mode,
            "word": target.word,
            "pos": target.pos,
            "prompt": target.word if mode == WORD_TO_DEF else target.definition,
            "options": [self._answer_text_for_word(w, mode) for w in option_words],
            "option_words": option_words,
            "answer_index": option_words.index(target.word),
        }

    @staticmethod
    def _answer_text(target: Entry, mode: str) -> str:
        return target.definition if mode == WORD_TO_DEF else target.word

    def _answer_text_for_word(self, word: str, mode: str) -> str:
        if mode == WORD_TO_DEF:
            return self.by_word[word.lower()].definition
        return word
