// The log, sessions, and apps_script/Code.gs (run in Node against a fake spreadsheet).
import { test } from "node:test";
import assert from "node:assert/strict";
import { WB, vocab } from "./web.mjs";
import { loadAppsScript, fakeFetch } from "../scripts/fake_apps_script.mjs";

const { seededRandom, DEF_TO_WORD, WORD_TO_DEF, SENTENCE, Log, Session, scoreRows, checkSheetUrl } = WB;

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

// The rows in one student's tab.
const sheetRows = (script, user) => {
  const [header, ...rows] = script.sheets.get(user).cells;
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

  assert.deepEqual([...script.sheets.keys()], ["Ada"]);
  const rows = sheetRows(script, "Ada");
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

  // Scores from Ada's tab match.
  await log.refresh("Ada");
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
  await log.refresh("Bo");
  assert.equal(right(), 4);
});

test("resending rows the Sheet already has does not duplicate them", async () => {
  const { script, log } = setup();
  const row = log.append({ user: "Ada", event: "answer", word: "abundant", outcome: "correct", response_ms: 5 });
  await log.flush();
  const again = script.post(JSON.stringify({ rows: [row, row] }));
  assert.deepEqual(again.ids, [row.id, row.id]);
  assert.equal(again.added, 0);
  assert.equal(sheetRows(script, "Ada").length, 1);
  assert.deepEqual(script.get({ action: "rows", user: "ada" }).rows.length, 1);
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
  await log.refresh("Cy");
  assert.equal(log.tallies("Cy").hostile.wrong, 1);
  assert.equal(sheetRows(script, "Cy").length, 1);
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
  assert.equal(sheetRows(script, "Di").length, 1);
});

test("without a Sheet URL everything stays on the device", async () => {
  const { log, fetch } = setup({ url: "" });
  const s = Session.start({ vocab, log, user: "Ed", group: 1, mode: "mixed", rng: seededRandom(2) });
  play(s, 3, () => false);
  await log.flush();
  await log.refresh("Ed");
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
  assert.throws(() => Session.start({ vocab, log, user: "LOG", group: 1, mode: "mixed" }), /another name/);
});

test("the question shown does not leak the answer", () => {
  const { log } = setup({ url: "" });
  const q = Session.start({ vocab, log, user: "Ada", group: 1, mode: DEF_TO_WORD }).question;
  assert.deepEqual(Object.keys(q).sort(), ["mode", "options", "prompt", "seq"]);
  const w = Session.start({ vocab, log, user: "Ada", group: 1, mode: WORD_TO_DEF }).question;
  assert.equal(w.prompt, "salacious");
  const f = Session.start({ vocab, log, user: "Ada", group: 1, mode: SENTENCE }).question;
  assert.deepEqual(Object.keys(f).sort(), ["mode", "options", "prompt", "seq"]);
  assert.ok(f.prompt.includes("___") && !f.prompt.includes("salacious"));
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

test("switching mode mid-session re-asks the same word the new way", () => {
  const { log } = setup({ url: "" });
  const s = Session.start({ vocab, log, user: "Ada", group: 2, mode: WORD_TO_DEF, rng: seededRandom(5) });
  play(s, 4, (i) => i % 2 === 0);
  const before = s.progress();
  const word = s.queue.current;
  const q = s.setMode(SENTENCE);
  assert.equal(q.mode, SENTENCE);
  assert.ok(q.seq > before.asked, "a new seq, so the page re-renders the options");
  assert.equal(s.queue.current, word);
  assert.deepEqual(s.progress(), before);
  assert.equal(s.setMode(SENTENCE).seq, q.seq, "same mode is a no-op");
  assert.throws(() => s.setMode("nope"), /mode must be/);
  play(s, 3, () => true);
  const answers = log.outbox.filter((r) => r.event === "answer").slice(-3);
  assert.ok(answers.every((r) => r.mode === SENTENCE && r.detail.session_mode === SENTENCE));
  s.setMode("mixed");
  const r = Session.fromJSON(JSON.parse(JSON.stringify(s)), { vocab, log });
  assert.equal(r.mode, "mixed");
  assert.deepEqual(r.question, s.question);
});

test("Code.gs rejects junk", () => {
  const script = loadAppsScript();
  assert.equal(script.post("not json").ok, false);
  assert.equal(script.get({ action: "drop_table" }).ok, false);
  assert.deepEqual(script.get({}), { ok: true, users: [] });
  assert.equal(script.post(JSON.stringify({ rows: [{ id: "x", user: "../etc" }] })).ok, false);
});

test("each right answer banks a coin from the chosen set, and the student's tab counts them", async () => {
  const { script, log } = setup();
  const s = Session.start({ vocab, log, user: "Ada", group: 1, mode: WORD_TO_DEF, rng: seededRandom(4),
                            coinSet: "greek" });
  const results = play(s, 12, (i) => i % 3 !== 0);
  const greek = new Set(WB.COIN_SET_BY_ID.greek.coins.map((c) => c.id));
  for (const r of results) {
    if (r.correct) assert.ok(greek.has(r.coin.id), r.coin.id);
    else assert.equal(r.coin, null);
  }
  assert.equal(s.earned.length, 8);
  const want = {};
  for (const id of s.earned) want[id] = (want[id] || 0) + 1;
  assert.deepEqual(log.coins("Ada"), want); // still in the outbox

  await log.flush();
  assert.deepEqual(log.coins("Ada"), want); // moved into the cached summary, not counted twice
  await log.refresh("Ada");
  assert.deepEqual(log.coins("Ada"), want); // from Ada's tab
  assert.equal(JSON.parse(sheetRows(script, "Ada")[0].detail).coin_set, "greek");

  // Another device, nothing cached, loads the same coins from Ada's tab.
  const ipad = new Log({ url: "x", storage: memoryStorage(), fetch: fakeFetch(script), timers: noTimers });
  await ipad.refresh("Ada");
  assert.deepEqual(ipad.coins("Ada"), want);
  assert.deepEqual(ipad.coins("Bo"), {});

  // The coin set survives a reload mid-session.
  const again = Session.fromJSON(JSON.parse(JSON.stringify(s)), { vocab, log });
  assert.equal(again.coinSet, "greek");
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
  await log.refresh("Ada");
  assert.deepEqual(sheetRows(script, "Ada").at(-1).outcome, "unknown");
  const t = log.tallies("Ada")[first];
  assert.deepEqual([t.right, t.wrong, t.unknown], [0, 0, 1]);
  assert.equal(scoreRows(vocab, log.tallies("Ada")).find((x) => x.word === first).unknown, 1);
});

test("each student gets their own tab, and a fresh device loads it", async () => {
  const { script, log } = setup();
  const a = Session.start({ vocab, log, user: "Ada", group: 1, mode: WORD_TO_DEF, rng: seededRandom(4) });
  play(a, 5, (i) => i !== 2);
  const b = Session.start({ vocab, log, user: "Bo", group: 2, mode: DEF_TO_WORD, rng: seededRandom(5) });
  play(b, 3, () => false);
  await log.flush();
  assert.deepEqual([...script.sheets.keys()].sort(), ["Ada", "Bo"]);
  assert.equal(sheetRows(script, "Ada").length, 6);
  assert.equal(sheetRows(script, "Bo").length, 4);
  // A tab the parent made by hand isn't a student.
  script.sheets.set("Charts", { getName: () => "Charts", getLastRow: () => 0, getLastColumn: () => 0 });

  // Another iPad, nothing cached: the list of names, then Ada's tab.
  const ipad = new Log({ url: "x", storage: memoryStorage(), fetch: fakeFetch(script), timers: noTimers });
  await ipad.refresh();
  assert.deepEqual(ipad.users(), ["Ada", "Bo"]);
  assert.deepEqual(ipad.tallies("Ada"), {});
  await ipad.refresh("Ada");
  const right = (who) => scoreRows(vocab, ipad.tallies(who)).reduce((n, r) => n + r.right, 0);
  assert.equal(right("Ada"), 4);
  const t = Object.values(ipad.tallies("Ada"));
  assert.equal(t.reduce((n, x) => n + x.wrong, 0), 1);
  assert.ok(t.every((x) => x.n_ms === x.right + x.wrong && x.sum_ms > 0)); // response_ms came back as numbers
  assert.deepEqual(ipad.tallies("Bo"), {}); // not loaded yet
  await ipad.refresh("Bo");
  assert.equal(scoreRows(vocab, ipad.tallies("Bo")).reduce((n, r) => n + r.wrong, 0), 3);
  assert.equal(ipad.canonicalName("bo"), "Bo");
});

test("a row stored but not acknowledged is counted once after loading the tab", async () => {
  const { script, storage } = setup();
  let lose = true;
  const fetch = async (url, opts) => {
    const res = await fakeFetch(script)(url, opts);
    if (lose && opts.method === "POST") { lose = false; throw new TypeError("Load failed"); }
    return res;
  };
  const log = new Log({ url: "x", storage, fetch, timers: noTimers });
  log.append({ user: "Cy", event: "answer", word: "hostile", outcome: "correct", response_ms: 9 });
  await log.flush(); // landed in the Sheet, reply lost: still in the outbox
  assert.equal(log.pending, 1);
  log.flush = async () => {}; // stay "offline" for sending, but read the tab
  await log.refresh("Cy");
  assert.equal(log.tallies("Cy").hostile.right, 1);
  delete log.flush;
  await log.flush();
  assert.equal(log.pending, 0);
  assert.equal(log.tallies("Cy").hostile.right, 1);
});

test("an old single log tab is split into a tab per student", () => {
  const script = loadAppsScript();
  // The old layout: one "log" tab with a user column.
  const cols = ["id", "ts", "received", "user", "event", "word", "outcome", "response_ms"];
  const tab = script.spreadsheet.insertSheet("log");
  tab.cells.push(cols,
    ["1", "2026-01-01T00:00:00Z", "r", "Ada", "answer", "abundant", "correct", "1200"],
    ["2", "2026-01-01T00:00:01Z", "r", "Bo", "answer", "hostile", "wrong", "800"],
    ["3", "2026-01-01T00:00:02Z", "r", "Ada", "answer", "hostile", "correct", "700"]);
  assert.deepEqual(script.get({ action: "users" }).users.sort(), ["Ada", "Bo"]);
  assert.ok(script.sheets.has("log (split into tabs)"));
  assert.ok(!script.sheets.has("log"));
  const ada = script.get({ action: "rows", user: "Ada" });
  assert.deepEqual(ada.rows.map((r) => r[ada.columns.indexOf("word")]), ["abundant", "hostile"]);
  assert.equal(sheetRows(script, "Ada")[0].ts, "2026-01-01T00:00:00Z");
  // Running again changes nothing.
  assert.equal(script.get({ action: "rows", user: "Bo" }).rows.length, 1);
});

test("checkSheetUrl: catches the spreadsheet link, a dead link, and a working one", async () => {
  const script = loadAppsScript();
  await assert.rejects(checkSheetUrl("https://docs.google.com/spreadsheets/d/abc/edit", fakeFetch(script)), /web app link/);
  await assert.rejects(checkSheetUrl("hello", fakeFetch(script)), /doesn't look like a link/);
  await assert.rejects(checkSheetUrl("https://x/exec", async () => { throw new TypeError("Load failed"); }), /Couldn't reach/);
  await assert.rejects(checkSheetUrl("https://x/exec", async () => ({ ok: true, json: async () => { throw new SyntaxError(); } })),
                       /deployed for Anyone/);
  assert.deepEqual(await checkSheetUrl(" https://x/exec ", fakeFetch(script)), []);
});

test("switching Sheets forgets the old Sheet's scores but keeps unsent rows", async () => {
  const { log } = setup();
  log.append({ user: "Ada", event: "answer", word: "abundant", outcome: "correct", response_ms: 5 });
  await log.refresh("Ada");
  assert.equal(log.tallies("Ada").abundant.right, 1);
  log.setUrl("");
  assert.deepEqual(log.summary, { users: [], tallies: {}, coins: {} });
  assert.deepEqual(log.tallies("Ada"), {});
  log.append({ user: "Ada", event: "answer", word: "hostile", outcome: "wrong", response_ms: 5 });
  assert.equal(log.tallies("Ada").hostile.wrong, 1);
});
