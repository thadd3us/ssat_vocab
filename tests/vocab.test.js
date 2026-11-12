import { test } from "node:test";
import assert from "node:assert/strict";
import { WB, vocab } from "./web.mjs";

const { Vocab, DEF_TO_WORD, WORD_TO_DEF, SENTENCE, MIXED, N_OPTIONS, seededRandom } = WB;

test("groups preserve order", () => {
  const g = vocab.groups;
  assert.equal(g.length, 52);
  assert.deepEqual(g.slice(0, -1).map((x) => x.length), Array(51).fill(20));
  assert.equal(g.at(-1).length, 18);
  assert.deepEqual(g.flat().map((e) => e.rank), Array.from({ length: 1038 }, (_, i) => i + 1));
  assert.equal(vocab.group(1)[0].word, "salacious");
  assert.throws(() => vocab.group(0));
  assert.throws(() => vocab.group(53));
});

test("groups 1-6 stay as they were studied; Manhattan Review's words start at group 7", () => {
  assert.equal(vocab.entries[119].word, "formidable");
  assert.equal(vocab.entries[120].word, "whimsical"); // Manhattan's first word
  assert.equal(vocab.group(6).at(-1).word, "formidable");
});

for (const mode of [WORD_TO_DEF, DEF_TO_WORD, SENTENCE]) {
  test(`every word builds a sound question (${mode})`, () => {
    const rng = seededRandom(0);
    for (const g of vocab.groups) {
      for (const target of g) {
        for (let k = 0; k < 5; k++) {
          const q = vocab.buildQuestion(target, mode, rng, g);
          assert.equal(q.options.length, N_OPTIONS[mode]);
          assert.equal(new Set(q.options.map((o) => o.toLowerCase())).size, N_OPTIONS[mode], q.options.join(" | "));
          assert.equal(q.optionWords[q.answerIndex], target.word);
          assert.equal(q.options[q.answerIndex], mode === WORD_TO_DEF ? target.definition : target.word);
          q.optionWords.forEach((w, i) => {
            if (i !== q.answerIndex) assert.ok(!vocab.tooClose(target, w), `${target.word} / ${w}`);
          });
        }
      }
    }
  });
}

test("half the wrong answers are curated distractors", () => {
  const rng = seededRandom(1);
  const target = vocab.get("hostile");
  for (let k = 0; k < 20; k++) {
    const q = vocab.buildQuestion(target, DEF_TO_WORD, rng, vocab.group(1));
    const fromDistractors = q.optionWords.filter((w) => w !== "hostile" && target.distractors.includes(w));
    assert.ok(fromDistractors.length >= Math.floor((N_OPTIONS[DEF_TO_WORD] - 1) / 2));
  }
});

test("sentence questions: the sentence is the prompt, mostly curated distractors, same part of speech", () => {
  const rng = seededRandom(6);
  let fromDistractors = 0, n = 0;
  for (const g of vocab.groups) {
    for (const target of g) {
      const q = vocab.buildQuestion(target, SENTENCE, rng, g);
      assert.equal(q.prompt, target.sentence);
      for (const w of q.optionWords) {
        assert.ok(vocab.samePos(target, w), `${target.word} (${target.pos}) / ${w} (${vocab.get(w)?.pos})`);
        if (w !== target.word && target.distractors.includes(w)) fromDistractors++;
      }
      n++;
    }
  }
  assert.ok(fromDistractors / n >= 3, `${fromDistractors / n} distractors per question`);
});

test("parts of speech: a v./n. word fits a verb or a noun blank", () => {
  assert.ok(vocab.samePos({ pos: "v." }, vocab.entries.find((e) => e.pos === "v./n.").word));
  assert.ok(vocab.samePos({ pos: "n." }, vocab.entries.find((e) => e.pos === "v./n.").word));
  assert.ok(!vocab.samePos({ pos: "adj." }, vocab.entries.find((e) => e.pos === "v./n.").word));
  assert.ok(vocab.samePos({ pos: "adj." }, "notaword"));
});

test("answer position is shuffled", () => {
  const rng = seededRandom(2);
  const pos = new Set(Array.from({ length: 100 }, () => vocab.buildQuestion(vocab.entries[0], WORD_TO_DEF, rng).answerIndex));
  assert.equal(pos.size, N_OPTIONS[WORD_TO_DEF]);
});

test("mixed resolves to a concrete mode", () => {
  const rng = seededRandom(3);
  const modes = new Set(Array.from({ length: 50 }, () => vocab.buildQuestion(vocab.entries[0], MIXED, rng).mode));
  assert.deepEqual(modes, new Set([WORD_TO_DEF, DEF_TO_WORD, SENTENCE]));
});

test("definitions are unique", () => {
  const seen = new Map();
  for (const e of vocab.entries) {
    assert.ok(!seen.has(e.definition.toLowerCase()), `${e.word} / ${seen.get(e.definition.toLowerCase())}`);
    seen.set(e.definition.toLowerCase(), e.word);
  }
});

test("shared definitions never appear together", () => {
  const entry = (rank, word, definition) => ({ rank, word, pos: "adj.", definition, synonyms: [], antonyms: [], distractors: [] });
  const words = [entry(1, "frugal", "careful with money"), entry(2, "thrifty", "careful with money")];
  for (let i = 3; i < 12; i++) words.push(entry(i, `filler${i}`, `meaning ${i}`));
  const v = new Vocab(words);
  const rng = seededRandom(4);
  for (const mode of [WORD_TO_DEF, DEF_TO_WORD, SENTENCE]) {
    for (let k = 0; k < 50; k++) assert.ok(!v.buildQuestion(words[0], mode, rng).optionWords.includes("thrifty"));
  }
});

for (const [a, b] of [["rash", "impetuous"], ["scorn", "spurn"], ["spurn", "rebuff"], ["coerce", "compel"],
                      ["wary", "prudent"], ["avid", "zealous"], ["frugal", "thrifty"], ["eradicate", "obliterate"],
                      ["loquacious", "garrulous"], ["lugubrious", "melancholy"], ["obsequious", "servile"],
                      ["laconic", "terse"], ["placate", "appease"], ["exonerate", "vindicate"],
                      ["equivocal", "ambiguous"], ["pugnacious", "belligerent"], ["egregious", "flagrant"],
                      ["clandestine", "covert"], ["paucity", "dearth"]]) {
  test(`near synonyms never offered together: ${a}/${b}`, () => {
    const rng = seededRandom(5);
    const target = vocab.get(a);
    const group = vocab.groups.find((g) => g.includes(target));
    for (const mode of [WORD_TO_DEF, DEF_TO_WORD, SENTENCE]) {
      for (let k = 0; k < 100; k++) {
        assert.ok(!vocab.buildQuestion(target, mode, rng, [...group, vocab.get(b)]).optionWords.includes(b));
      }
    }
  });
}

test("near-synonyms are words in the list, listed on both sides", () => {
  for (const e of vocab.entries) {
    for (const w of e.nearSynonyms) {
      const other = vocab.get(w);
      assert.ok(other, `${e.word}: ${w} isn't in the list`);
      assert.notEqual(other, e, `${e.word} lists itself`);
      assert.ok(other.nearSynonyms.includes(e.word), `${w} doesn't list ${e.word}`);
    }
  }
});

test("near-synonyms from the JSONL keep words apart", () => {
  const entry = (rank, word, nearSynonyms = []) =>
    ({ rank, word, pos: "adj.", definition: `meaning of ${word}`, synonyms: [], antonyms: [], distractors: [], nearSynonyms });
  const v = new Vocab([entry(1, "glad", ["merry"]), entry(2, "merry"), entry(3, "sad")]);
  assert.ok(v.tooClose(v.get("glad"), "merry"));
  assert.ok(v.tooClose(v.get("merry"), "glad"), "checked from either side");
  assert.ok(!v.tooClose(v.get("glad"), "sad"));
});

test("every word has a fill-in-the-blank sentence", () => {
  for (const e of vocab.entries) {
    assert.equal(e.sentence.split("___").length, 2, `${e.word}: exactly one blank`);
    assert.ok(!/\ban?\s+___/i.test(e.sentence), `${e.word}: "a/an" before the blank gives away the first letter`);
    assert.ok(!e.sentence.toLowerCase().includes(e.word.toLowerCase()), `${e.word}: sentence contains the answer`);
  }
});

test("every word has a short explanation", () => {
  for (const e of vocab.entries) {
    assert.ok(e.explanation.length >= 40, `${e.word}: missing or too short`);
    assert.ok(e.explanation.length <= 300, `${e.word}: too long to read between questions`);
  }
});

test("added words are present", () => {
  for (const w of ["pugnacious", "perspicacious", "recalcitrant", "intractable", "sycophant", "pompous"]) assert.ok(vocab.get(w), w);
});
