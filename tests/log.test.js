// The log, sessions, and apps_script/Code.gs (run in Node against a fake spreadsheet).
import { test } from "node:test";
import assert from "node:assert/strict";
import { WB, vocab } from "./web.mjs";
import { loadAppsScript, fakeFetch } from "../scripts/fake_apps_script.mjs";

const { seededRandom, DEF_TO_WORD, WORD_TO_DEF, Log, Session, scoreRows } = WB;

function memoryStorage() {
  const m = new Map();
  return { get: (k, d) => (m.has(k) ? JSON.parse(m.get(k)) : d), set: (k, v) => m.set(k, JSON.stringify(v)), m };
}
const noTimers = { setTimeout: () => 0, clearTimeout: () => {} };

function setup({ url = "https://sheet.example/exec", fail } = {}) {
  const script = loadAppsScript();
  const fetch = fakeFetch(script, { fail });
  const storage = memoryStorage();
  const log = new Log({ url, storage, fetch, timers: noTimers });
  return { script, fetch, storage, log };
}

function play(s, n, rightPattern) {
  const results = [];
  for (let i = 0; i < n; i++) {
    const want = rightPattern(i);
    const idx = s.q.answerIndex;
    const r = s.answer(want ? idx : (idx + 1) % s.q.options.length, 1000 + i);
    assert.equal(r.correct, want);
    results.push(r);
  }
  return results;
}

const sheetRows = (script) => {
  const [header, ...rows] = script.sheets.get("log").cells;
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
};

test("a full session lands in the Sheet, in order, once", async () => {
  const { script, log } = setup();
  const s = Session.start({ vocab, log, user: "Ada", group: 2, mode: WORD_TO_DEF, rng: seededRandom(123) });
  const results = play(s, 25, (i) => i % 4 !== 0);
  assert.equal(results.filter((r) => r.correct).length, 18);
  const end = s.end();
  assert.equal(end.right, 18);
  assert.equal(end.wrong, 7);
  await log.flush();
  assert.equal(log.pending, 0);

  const rows = sheetRows(script);
  assert.deepEqual(rows.map((r) => r.event), ["session_start", ...Array(25).fill("answer"), "session_end"]);
  assert.equal(new Set(rows.map((r) => r.id)).size, 27);
  const a = rows[1];
  assert.equal(a.user, "Ada");
  assert.equal(Number(a.grp), 2);
  assert.equal(a.mode, "word_to_def");
  assert.equal(a.outcome, "wrong");
  assert.equal(Number(a.response_ms), 1000);
  assert.match(a.ts, /^\d{4}-\d\d-\d\dT.*Z$/);
  assert.equal(a.word, vocab.group(2)[0].word);
  assert.equal(a.stage_before, "new");
  assert.equal(a.stage_after, "missed");
  assert.equal(JSON.parse(a.options).length, 5);
  assert.equal(rows[3].word, a.word); // the missed word comes back after exactly one other

  // Scores from the Sheet's summary match.
  await log.refresh();
  const scores = scoreRows(vocab, log.tallies("Ada"), 2);
  assert.equal(scores.reduce((n, r) => n + r.right, 0), 18);
  assert.equal(scores.reduce((n, r) => n + r.wrong, 0), 7);
  assert.ok(scores.find((r) => r.word === a.word).wrong >= 1);
  assert.ok(scores.find((r) => r.word === a.word).avg_ms >= 1000);
});

test("scores count outbox rows before they reach the Sheet, and never twice", async () => {
  let down = true;
  const { log } = setup({ fail: () => down });
  const s = Session.start({ vocab, log, user: "Bo", group: 1, mode: DEF_TO_WORD, rng: seededRandom(1) });
  play(s, 4, () => true);
  await log.flush();
  assert.equal(log.pending, 5);
  assert.match(log.error, /Will retry/);
  const right = () => scoreRows(vocab, log.tallies("Bo")).reduce((n, r) => n + r.right, 0);
  assert.equal(right(), 4);
  down = false;
  await log.flush();
  assert.equal(log.pending, 0);
  assert.equal(log.error, "");
  assert.equal(right(), 4);
  await log.refresh();
  assert.equal(right(), 4);
});

test("resending rows the Sheet already has does not duplicate them", async () => {
  const { script, log } = setup();
  const row = log.append({ user: "Ada", event: "answer", word: "abundant", outcome: "correct", response_ms: 5 });
  await log.flush();
  const again = script.post(JSON.stringify({ rows: [row, row] }));
  assert.deepEqual(again.ids, [row.id, row.id]);
  assert.equal(again.added, 0);
  assert.equal(sheetRows(script).length, 1);
  assert.equal(script.get({ action: "summary" }).tallies.Ada.abundant.right, 1);
});

test("a lost reply is retried safely", async () => {
  // The Sheet stores the rows but the reply never arrives (fetch throws after the POST lands).
  const { script, storage } = setup();
  let first = true;
  const fetch = async (url, opts) => {
    const res = await fakeFetch(script)(url, opts);
    if (first && opts.method === "POST") { first = false; throw new TypeError("Load failed"); }
    return res;
  };
  const log = new Log({ url: "x", storage, fetch, timers: noTimers });
  log.append({ user: "Cy", event: "answer", word: "hostile", outcome: "wrong", response_ms: 9 });
  await log.flush();
  assert.equal(log.pending, 1);
  await log.flush();
  assert.equal(log.pending, 0);
  await log.refresh();
  assert.equal(log.tallies("Cy").hostile.wrong, 1);
  assert.equal(sheetRows(script).length, 1);
});

test("the outbox survives a reload", async () => {
  const { storage, script } = setup();
  const offline = new Log({ url: "x", storage, fetch: async () => { throw new TypeError("offline"); }, timers: noTimers });
  offline.append({ user: "Di", event: "session_start", grp: 1 });
  await offline.flush();
  const reloaded = new Log({ url: "x", storage, fetch: fakeFetch(script), timers: noTimers });
  assert.equal(reloaded.pending, 1);
  assert.deepEqual(reloaded.users(), ["Di"]);
  await reloaded.flush();
  assert.equal(sheetRows(script).length, 1);
});

test("without a Sheet URL everything stays on the device", async () => {
  const { log, fetch } = setup({ url: "" });
  const s = Session.start({ vocab, log, user: "Ed", group: 1, mode: "mixed", rng: seededRandom(2) });
  play(s, 3, () => false);
  await log.flush();
  await log.refresh();
  assert.equal(fetch.calls.length, 0);
  assert.equal(log.pending, 4);
  assert.equal(scoreRows(vocab, log.tallies("Ed")).reduce((n, r) => n + r.wrong, 0), 3);
});

test("names: validated, and matched case-insensitively", () => {
  const { log } = setup({ url: "" });
  for (const bad of ["", "../etc/passwd", "a/b", "x".repeat(40), "1abc", "bob.sqlite"]) {
    assert.throws(() => Session.start({ vocab, log, user: bad, group: 1, mode: "mixed" }), bad);
  }
  assert.equal(log.pending, 0);
  Session.start({ vocab, log, user: "Ada", group: 1, mode: "mixed" });
  assert.equal(Session.start({ vocab, log, user: "  ada ", group: 1, mode: "mixed" }).user, "Ada");
  Session.start({ vocab, log, user: "Grace  Hopper", group: 1, mode: "mixed" });
  assert.deepEqual(log.users(), ["Ada", "Grace Hopper"]);
});

test("the question shown does not leak the answer", () => {
  const { log } = setup({ url: "" });
  const q = Session.start({ vocab, log, user: "Ada", group: 1, mode: DEF_TO_WORD }).question;
  assert.deepEqual(Object.keys(q).sort(), ["mode", "options", "prompt", "seq"]);
  const w = Session.start({ vocab, log, user: "Ada", group: 1, mode: WORD_TO_DEF }).question;
  assert.equal(w.prompt, "salacious");
  assert.ok(!("pos" in w) && !("answerIndex" in w));
});

test("a session survives a page reload", () => {
  const { log } = setup({ url: "" });
  const s = Session.start({ vocab, log, user: "Ada", group: 3, mode: "mixed", rng: seededRandom(9) });
  play(s, 7, (i) => i % 3 !== 0);
  const r = Session.fromJSON(JSON.parse(JSON.stringify(s)), { vocab, log });
  assert.deepEqual(r.question, s.question);
  assert.deepEqual(r.progress(), s.progress());
  assert.equal(r.id, s.id);
  play(r, 3, () => true);
  assert.equal(r.progress().asked, 10);
});

test("Code.gs rejects junk", () => {
  const script = loadAppsScript();
  assert.equal(script.post("not json").ok, false);
  assert.equal(script.get({ action: "drop_table" }).ok, false);
  assert.deepEqual(script.get({}), { ok: true, users: [], tallies: {} });
});

test("\"I don't know\" re-drills like a miss but is logged and scored separately", async () => {
  const { script, log } = setup();
  const s = Session.start({ vocab, log, user: "Ada", group: 1, mode: DEF_TO_WORD, rng: seededRandom(7) });
  const first = s.queue.current;
  const r = s.answer(null, 800);
  assert.equal(r.unknown, true);
  assert.equal(r.correct, false);
  assert.equal(r.chosen_word, null);
  assert.equal(r.stage_after, "missed");
  assert.equal(s.queue.order[1], first); // slot 3, same as a miss
  assert.deepEqual([r.progress.right, r.progress.wrong, r.progress.unknown], [0, 0, 1]);
  await log.refresh();
  assert.deepEqual(sheetRows(script).at(-1).outcome, "unknown");
  const t = log.tallies("Ada")[first];
  assert.deepEqual([t.right, t.wrong, t.unknown], [0, 0, 1]);
  assert.equal(scoreRows(vocab, log.tallies("Ada")).find((x) => x.word === first).unknown, 1);
});
