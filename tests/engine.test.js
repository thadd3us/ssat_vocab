import { test } from "node:test";
import assert from "node:assert/strict";
import { WB } from "./web.mjs";

const { StudyQueue, Stage, seededRandom } = WB;

const WORDS = Array.from({ length: 20 }, (_, i) => `w${String(i + 1).padStart(2, "0")}`);
const ask = (q, correct) => { const w = q.current; return [w, q.answer(correct)]; };

test("starts in order", () => {
  const q = new StudyQueue(WORDS);
  assert.deepEqual(q.order, WORDS);
  assert.equal(q.current, "w01");
});

test("correct goes to back", () => {
  const q = new StudyQueue(WORDS);
  const [, t] = ask(q, true);
  assert.deepEqual(q.order, [...WORDS.slice(1), "w01"]);
  assert.equal(t.stageAfter, Stage.LEARNED);
  assert.equal(t.slot, 21);
});

test("miss comes back after one other word", () => {
  const q = new StudyQueue(WORDS);
  ask(q, false);
  assert.deepEqual(q.order.slice(0, 3), ["w02", "w01", "w03"]);
  assert.equal(q.stages.w01, Stage.MISSED);
});

test("full recovery path", () => {
  const q = new StudyQueue(WORDS);
  const shown = [];
  const step = (c) => shown.push(ask(q, c)[0]);
  step(false); step(true); step(true);
  assert.equal(q.stages.w01, Stage.RECOVERING);
  assert.deepEqual(q.order.slice(0, 3), ["w03", "w04", "w01"]); // slot 4
  step(true); step(true); step(true);
  assert.equal(q.stages.w01, Stage.REVIEW);
  assert.deepEqual(q.order.slice(0, 4), ["w05", "w06", "w07", "w01"]); // slot 5
  step(true); step(true); step(true); step(true);
  assert.deepEqual(shown, ["w01", "w02", "w01", "w03", "w04", "w01", "w05", "w06", "w07", "w01"]);
  assert.equal(q.stages.w01, Stage.LEARNED);
  assert.ok(!q.order.slice(0, 13).includes("w01")); // out of the rotation
});

test("miss during recovery resets to slot 3", () => {
  const q = new StudyQueue(WORDS);
  ask(q, false); ask(q, true); ask(q, true);
  for (let i = 0; i < 2; i++) ask(q, true);
  const [w, t] = ask(q, false);
  assert.equal(w, "w01");
  assert.equal(t.stageBefore, Stage.RECOVERING);
  assert.equal(t.stageAfter, Stage.MISSED);
  assert.equal(q.order[1], "w01");
});

test("learned word missed in review is redrilled but stays mastered", () => {
  const q = new StudyQueue(WORDS);
  for (let i = 0; i < 20; i++) ask(q, true);
  assert.ok(q.complete);
  assert.equal(q.current, "w01"); // review: oldest mastered first
  ask(q, false);
  assert.equal(q.stages.w01, Stage.MISSED);
  assert.ok(q.mastered.has("w01"));
  assert.equal(ask(q, true)[0], "w02"); // one other question...
  assert.equal(q.current, "w01");       // ...then back to w01
});

test("mastered words aren't re-asked while others are still being learned", () => {
  // The 18/20 bug: once a word was mastered it went to the back of the list, so
  // the last few unmastered words waited behind every word already known.
  const q = new StudyQueue(WORDS);
  const shown = [];
  shown.push(ask(q, false)[0]); // w01 missed first
  while (!q.complete) shown.push(ask(q, true)[0]);
  assert.equal(shown.length, 23); // 20 words + w01 three more times
  const counts = Object.fromEntries(WORDS.map((w) => [w, shown.filter((x) => x === w).length]));
  assert.equal(counts.w01, 4);
  assert.ok(WORDS.slice(1).every((w) => counts[w] === 1), JSON.stringify(counts));
});

test("at the end of a group, only the needed spacing is filled with mastered words", () => {
  const q = new StudyQueue(WORDS);
  for (let i = 0; i < 19; i++) ask(q, true); // w01..w19 mastered
  const shown = [ask(q, false)[0]];          // w20 missed
  while (!q.complete) shown.push(ask(q, true)[0]);
  // w20 again after 1 spacer, then 2, then 3: 6 mastered words, not a lap of all 19.
  assert.deepEqual(shown.map((w) => (w === "w20" ? "X" : ".")).join(""), "X.X..X...X");
  assert.deepEqual(shown.filter((w) => w !== "w20"), WORDS.slice(0, 6)); // oldest first, no repeats
});

test("all correct completes in one pass", () => {
  const q = new StudyQueue(WORDS);
  for (const expected of WORDS) assert.equal(ask(q, true)[0], expected);
  assert.ok(q.complete);
  assert.deepEqual(q.order, WORDS);
});

test("never the same word twice in a row", () => {
  const rng = seededRandom(1);
  const q = new StudyQueue(WORDS);
  let prev = null;
  for (let i = 0; i < 2000; i++) {
    const [w] = ask(q, rng() < 0.6);
    assert.notEqual(w, prev);
    prev = w;
  }
});

test("two consecutive misses interleave", () => {
  const q = new StudyQueue(WORDS);
  ask(q, false); ask(q, false);
  assert.deepEqual(q.order.slice(0, 4), ["w01", "w02", "w03", "w04"]);
});

test("single word queue", () => {
  const q = new StudyQueue(["only"]);
  ask(q, false);
  assert.equal(q.current, "only");
  ask(q, true); ask(q, true); ask(q, true);
  assert.ok(q.complete);
});

test("short queue pads slots with mastered words", () => {
  const q = new StudyQueue(["a", "b", "c"]);
  ask(q, false);                         // a -> slot 3
  assert.deepEqual(q.order, ["b", "a", "c"]);
  ask(q, true);                          // b mastered
  ask(q, true);                          // a recovering -> slot 4, but only c is left to learn
  const next = Array.from({ length: 7 }, () => ask(q, true)[0]);
  // c, a spacer, a (-> slot 5), three spacers, a
  assert.deepEqual(next, ["c", "b", "a", "c", "b", "c", "a"]);
});

// Bounds sit a little above the worst of 100 seeds (40, 91, 249). With fixed slots 3/4/5, a few hard
// words cycle near the front, so unseen words wait longer than when "almost" words went to the back
// of the list (33, 55, 107; the old one-list engine: 33, 71, 133).
for (const [accuracy, maxGap] of [[0.9, 45], [0.7, 100], [0.5, 260]]) {
  test(`no unmastered word is starved at accuracy ${accuracy}`, () => {
    for (let seed = 0; seed < 100; seed++) {
      const rng = seededRandom(seed);
      const q = new StudyQueue(WORDS);
      const last = Object.fromEntries(WORDS.map((w) => [w, 0]));
      for (let i = 1; !q.complete; i++) {
        last[ask(q, rng() < accuracy)[0]] = i;
        const waiting = WORDS.filter((w) => !q.mastered.has(w)).map((w) => i - last[w]);
        assert.ok(Math.max(0, ...waiting) <= maxGap, `seed ${seed} step ${i}`);
      }
    }
  });
}

test("after completion every word keeps coming up in review", () => {
  for (let seed = 0; seed < 50; seed++) {
    const rng = seededRandom(seed);
    const q = new StudyQueue(WORDS);
    while (!q.complete) ask(q, rng() < 0.8);
    const last = Object.fromEntries(WORDS.map((w) => [w, q.asked]));
    for (let i = 0; i < 500; i++) {
      last[ask(q, rng() < 0.8)[0]] = q.asked;
      assert.ok(Math.max(...WORDS.map((w) => q.asked - last[w])) <= 100, `seed ${seed}`); // worst seen: 82
    }
  }
});

test("two persistent misses ping-pong", () => {
  const q = new StudyQueue(WORDS);
  const shown = Array.from({ length: 6 }, () => ask(q, false)[0]);
  assert.deepEqual(shown, ["w01", "w02", "w01", "w02", "w01", "w02"]);
});

// Bounds sit a little above the worst of 100 seeds (61, 85, 189; with "almost" sent to the back of the
// list: 76, 109, 288; the old one-list engine: 94, 190, 488).
for (const [accuracy, maxQuestions] of [[0.9, 70], [0.8, 95], [0.6, 200]]) {
  test(`session length is reasonable at accuracy ${accuracy}`, () => {
    for (let seed = 0; seed < 100; seed++) {
      const rng = seededRandom(seed);
      const q = new StudyQueue(WORDS);
      while (!q.complete) {
        ask(q, rng() < accuracy);
        assert.ok(q.asked <= maxQuestions, `seed ${seed}`);
      }
    }
  });
}

test("a mastered word missed as a spacer keeps mastery but is redrilled", () => {
  const q = new StudyQueue(["a", "b", "c"]);
  ask(q, true); ask(q, false); ask(q, true); // a, c mastered; b missed -> [c, b]
  assert.deepEqual(q.mastered, new Set(["a", "c"]));
  assert.equal(ask(q, true)[0], "b");        // b recovering, padded with spacers
  const [w, t] = ask(q, false);              // spacer a, missed
  assert.equal(w, "a");
  assert.equal(t.stageAfter, Stage.MISSED);
  assert.deepEqual(q.mastered, new Set(["a", "c"]));
  assert.ok(!q.complete);                    // b still needs a cold right answer
});

test("rejects bad input", () => {
  assert.throws(() => new StudyQueue([]));
  assert.throws(() => new StudyQueue(["a", "a"]));
});

test("round-trips through JSON", () => {
  const q = new StudyQueue(WORDS);
  ask(q, false); ask(q, true); ask(q, true);
  const r = StudyQueue.fromJSON(JSON.parse(JSON.stringify(q)));
  assert.deepEqual(r.order, q.order);
  assert.deepEqual(r.stages, q.stages);
  assert.deepEqual(r.mastered, q.mastered);
  assert.equal(r.asked, 3);
  for (let i = 0; i < 30; i++) assert.equal(ask(r, i % 3 > 0)[0], ask(q, i % 3 > 0)[0]);
});

test("restores a session saved by the older one-list engine", () => {
  const stages = Object.fromEntries(WORDS.map((w, i) => [w, i < 18 ? Stage.LEARNED : Stage.REVIEW]));
  const old = { queue: ["w19", "w20", ...WORDS.slice(0, 18)], stages, mastered: WORDS.slice(0, 18), backOffset: 0, asked: 40 };
  const q = StudyQueue.fromJSON(old);
  assert.equal(q.current, "w19"); // the two unmastered words come first, not after all 18
  ask(q, true);
  assert.equal(q.current, "w20");
});

test("dontKnow places the word like a miss", () => {
  const q = new StudyQueue(WORDS);
  const t = q.dontKnow();
  assert.equal(t.stageAfter, Stage.MISSED);
  assert.deepEqual(q.order.slice(0, 3), ["w02", "w01", "w03"]);
});
