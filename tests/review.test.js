// Review mode: drilling a student's most-missed words from their whole history.
import { test } from "node:test";
import assert from "node:assert/strict";
import { WB, vocab } from "./web.mjs";

const { seededRandom, WORD_TO_DEF, Log, Session, reviewWords, REVIEW, REVIEW_SIZE } = WB;

const noTimers = { setTimeout: () => 0, clearTimeout: () => {} };
function memoryStorage() {
  const m = new Map();
  return { get: (k, d) => (m.has(k) ? JSON.parse(m.get(k)) : d), set: (k, v) => m.set(k, JSON.stringify(v)) };
}
const newLog = () => new Log({ url: "", storage: memoryStorage(), timers: noTimers });

const t = (right, wrong, unknown = 0) => ({ right, wrong, unknown, sum_ms: 0, n_ms: 0, last_seen: null });

test("review ranks missed words by the share of tries that went wrong", () => {
  const [a, b, c, d, e] = vocab.entries.map((x) => x.word);
  const words = reviewWords(vocab, { [a]: t(3, 1), [b]: t(0, 2), [c]: t(1, 1), [d]: t(5, 0), [e]: t(1, 0, 1) });
  // b 100%, then c and e at 50% (tied on misses: list order), then a at 25%; d was never missed.
  assert.deepEqual(words.map((r) => r.word), [b, c, e, a]);
  assert.deepEqual(words.map((r) => r.miss_rate), [1, 0.5, 0.5, 0.25]);
});

test("review takes the top 20, and ties on rate go to the word missed more often", () => {
  const tallies = Object.fromEntries(vocab.entries.slice(0, 30).map((x, i) => [x.word, t(0, 1 + (i % 3))]));
  const words = reviewWords(vocab, tallies);
  assert.equal(words.length, REVIEW_SIZE);
  assert.ok(words.slice(0, 10).every((r) => r.wrong === 3));
});

test("a review session drills the missed words and they fall down the list as they're learned", () => {
  const log = newLog();
  assert.throws(() => Session.start({ vocab, log, user: "Ada", group: REVIEW, mode: WORD_TO_DEF }), /Nothing to review/);

  // Miss three words of group 1, get the rest right.
  const g = Session.start({ vocab, log, user: "Ada", group: 1, mode: WORD_TO_DEF, rng: seededRandom(3) });
  const missed = new Set();
  while (missed.size < 3) {
    const w = g.q.word;
    const wrong = !missed.has(w) && missed.size < 3 && g.queue.stages[w] === "new";
    if (wrong) missed.add(w);
    g.answer(wrong ? (g.q.answerIndex + 1) % g.q.options.length : g.q.answerIndex, 900);
  }
  g.end();

  const s = Session.start({ vocab, log, user: "Ada", group: REVIEW, mode: WORD_TO_DEF, rng: seededRandom(4) });
  assert.deepEqual(new Set(s.words), missed);
  // Survives a reload.
  const r = Session.fromJSON(JSON.parse(JSON.stringify(s)), { vocab, log });
  assert.deepEqual(r.words, s.words);
  assert.equal(r.group, REVIEW);
  // Right answers all round: every word's miss rate drops.
  const before = Object.fromEntries(reviewWords(vocab, log.tallies("Ada")).map((x) => [x.word, x.miss_rate]));
  for (let i = 0; i < 6; i++) r.answer(r.q.answerIndex, 800);
  for (const x of reviewWords(vocab, log.tallies("Ada"))) assert.ok(x.miss_rate < before[x.word], x.word);
});
