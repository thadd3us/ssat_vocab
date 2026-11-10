import random
import sys
from pathlib import Path

import pytest

from ssat_vocab.vocab import DEF_TO_WORD, MIXED, N_OPTIONS, WORD_TO_DEF, Vocab

WORDS = Path(__file__).parent.parent / "ssat_vocab.jsonl"


@pytest.fixture(scope="module")
def vocab():
    return Vocab.load(WORDS)


def test_groups_preserve_order(vocab):
    groups = vocab.groups
    assert len(groups) == 26
    assert [len(g) for g in groups[:-1]] == [20] * 25
    assert len(groups[-1]) == 5
    flat = [e for g in groups for e in g]
    assert [e.rank for e in flat] == list(range(1, 506))
    assert vocab.group(1)[0].word == "salacious"
    with pytest.raises(KeyError):
        vocab.group(0)
    with pytest.raises(KeyError):
        vocab.group(27)


@pytest.mark.parametrize("mode", [WORD_TO_DEF, DEF_TO_WORD])
def test_every_word_builds_a_sound_question(vocab, mode):
    rng = random.Random(0)
    for g in vocab.groups:
        for target in g:
            for _ in range(5):
                q = vocab.build_question(target, mode, rng, pool=g)
                opts = q["options"]
                assert len(opts) == N_OPTIONS
                assert len({o.lower() for o in opts}) == N_OPTIONS, opts
                assert q["option_words"][q["answer_index"]] == target.word
                right = target.definition if mode == WORD_TO_DEF else target.word
                assert opts[q["answer_index"]] == right
                # No other option is also correct.
                for i, w in enumerate(q["option_words"]):
                    if i != q["answer_index"]:
                        assert not vocab._too_close(target, w), (target.word, w)


def test_half_the_wrong_answers_are_curated_distractors(vocab):
    rng = random.Random(1)
    target = vocab.by_word["hostile"]
    for _ in range(20):
        q = vocab.build_question(target, DEF_TO_WORD, rng, pool=vocab.group(1))
        wrong = [w for w in q["option_words"] if w != "hostile"]
        from_distractors = [w for w in wrong if w in target.distractors]
        assert len(from_distractors) >= 2


def test_answer_position_is_shuffled(vocab):
    rng = random.Random(2)
    target = vocab.entries[0]
    positions = {vocab.build_question(target, WORD_TO_DEF, rng)["answer_index"] for _ in range(100)}
    assert positions == set(range(N_OPTIONS))


def test_mixed_resolves_to_a_concrete_mode(vocab):
    rng = random.Random(3)
    modes = {vocab.build_question(vocab.entries[0], MIXED, rng)["mode"] for _ in range(50)}
    assert modes == {WORD_TO_DEF, DEF_TO_WORD}


def test_definitions_are_unique(vocab):
    seen = {}
    for e in vocab.entries:
        assert e.definition.lower() not in seen, (e.word, seen.get(e.definition.lower()))
        seen[e.definition.lower()] = e.word


def test_shared_definitions_never_appear_together():
    """If two words ever share a definition again, never offer both."""
    from ssat_vocab.vocab import Entry
    def entry(rank, word, definition):
        return Entry(rank, word, "adj.", definition, (), (), ())
    words = [entry(1, "frugal", "careful with money"), entry(2, "thrifty", "careful with money")]
    words += [entry(i, f"filler{i}", f"meaning {i}") for i in range(3, 12)]
    v = Vocab(words)
    rng = random.Random(4)
    for mode in (WORD_TO_DEF, DEF_TO_WORD):
        for _ in range(50):
            q = v.build_question(words[0], mode, rng)
            assert "thrifty" not in q["option_words"]


@pytest.mark.parametrize("a,b", [("rash", "impetuous"), ("scorn", "spurn"), ("spurn", "rebuff"),
                                 ("coerce", "compel"), ("wary", "prudent"), ("avid", "zealous"),
                                 ("frugal", "thrifty"), ("eradicate", "obliterate"),
                                 ("loquacious", "garrulous"), ("lugubrious", "melancholy"),
                                 ("obsequious", "servile"), ("laconic", "terse"), ("placate", "appease"),
                                 ("exonerate", "vindicate"), ("equivocal", "ambiguous"), ("pugnacious", "belligerent"),
                                 ("egregious", "flagrant"), ("clandestine", "covert"), ("paucity", "dearth")])
def test_near_synonyms_never_offered_together(vocab, a, b):
    rng = random.Random(5)
    target = vocab.by_word[a]
    group = next(g for g in vocab.groups if target in g)
    for mode in (WORD_TO_DEF, DEF_TO_WORD):
        for _ in range(100):
            q = vocab.build_question(target, mode, rng, pool=group + [vocab.by_word[b]])
            assert b not in q["option_words"]


def test_near_synonym_words_exist(vocab):
    from ssat_vocab.vocab import NEAR_SYNONYMS
    for group in NEAR_SYNONYMS:
        for w in group:
            assert w in vocab.by_word, w


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-q"]))
