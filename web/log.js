// The study log: append-only rows, one per event (session_start | answer | session_end).
//
// Rows are written to an outbox in localStorage first, then sent to the Google
// Sheet (apps_script/Code.gs) when the network allows. A row leaves the outbox
// only once the Sheet confirms it has that row's id, and the Sheet ignores ids it
// already has, so resending after a dropped connection never double-counts.
//
// The Sheet has a tab per student. Scores come from that student's tab (loaded
// when they're picked, tallied here, and cached locally for starting offline)
// plus whatever is still in the outbox. With no Sheet URL, the outbox simply
// keeps everything and the app works on this device alone.
//
// The Sheet URL isn't in the code: the page asks for it once and keeps it in
// localStorage (see app.js).
(() => {
"use strict";
const WB = (globalThis.WB ||= {});

const NAME_RE = /^[A-Za-z][A-Za-z0-9 _-]{0,23}$/;
const CHUNK = 200;
const RETRY_MS = [5e3, 15e3, 60e3, 300e3];

const browserStorage = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

function newId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID().replaceAll("-", "");
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}

const emptyTally = () => ({ right: 0, wrong: 0, unknown: 0, sum_ms: 0, n_ms: 0, last_seen: null });

// Per-user, per-word tallies of answer rows:
// {user: {word: {right, wrong, unknown, sum_ms, n_ms, last_seen}}}. "unknown" is "I don't know".
function tally(rows, into = {}) {
  for (const r of rows) {
    if (!r.user || r.event !== "answer" || !r.word) continue;
    const byWord = (into[r.user] ||= {});
    const t = (byWord[r.word] ||= emptyTally());
    if (r.outcome === "correct") t.right++;
    else if (r.outcome === "wrong") t.wrong++;
    else if (r.outcome === "unknown") t.unknown++;
    if (Number.isFinite(r.response_ms)) { t.sum_ms += r.response_ms; t.n_ms++; }
    if (r.ts && (!t.last_seen || r.ts > t.last_seen)) t.last_seen = r.ts;
  }
  return into;
}

// Coins banked, per user: {user: {coin_id: n}}, from answer rows' detail.coin.
function coinTally(rows, into = {}) {
  for (const r of rows) {
    if (!r.user || r.event !== "answer") continue;
    let d = r.detail;
    if (typeof d === "string") { try { d = JSON.parse(d); } catch { continue; } }
    const id = d?.coin;
    if (!id) continue;
    const byCoin = (into[r.user] ||= {});
    byCoin[id] = (byCoin[id] || 0) + 1;
  }
  return into;
}

function addCoins(a = {}, b = {}) {
  const out = structuredClone(a);
  for (const [user, coins] of Object.entries(b)) {
    const u = (out[user] ||= {});
    for (const [id, n] of Object.entries(coins)) u[id] = (u[id] || 0) + n;
  }
  return out;
}

function addTallies(a, b) {
  const out = structuredClone(a);
  for (const [user, words] of Object.entries(b)) {
    const u = (out[user] ||= {});
    for (const [word, t] of Object.entries(words)) {
      const x = (u[word] ||= emptyTally());
      x.right += t.right; x.wrong += t.wrong; x.unknown += t.unknown || 0;
      x.sum_ms += t.sum_ms; x.n_ms += t.n_ms;
      if (t.last_seen && (!x.last_seen || t.last_seen > x.last_seen)) x.last_seen = t.last_seen;
    }
  }
  return out;
}

class Log {
  constructor({ url = "", storage = browserStorage, fetch = globalThis.fetch?.bind(globalThis),
                timers = globalThis, onChange = () => {} } = {}) {
    this.url = url;
    this.storage = storage;
    this.fetch = fetch;
    this.timers = timers;
    this.onChange = onChange;
    this.outbox = storage.get("outbox", []);
    // What we know of the Sheet: its student tabs, and each loaded tab's word tallies and coins.
    this.summary = { coins: {}, ...storage.get("summary", { users: [], tallies: {} }) };
    this.sheetIds = new Set(); // ids seen in the Sheet this visit; never counted twice
    this.error = "";
    this.syncing = false;
    this.loading = 0;
    this._inflight = null;
    this._again = false;
    this._retry = null;
    this._failures = 0;
  }

  get syncEnabled() { return !!this.url; }

  // Point at a different Sheet (or "" for this device only). Forgets the old Sheet's
  // scores; unsent rows stay in the outbox and go to the new one.
  setUrl(url) {
    if (url === this.url) return;
    this.url = url;
    this.summary = { users: [], tallies: {}, coins: {} };
    this.sheetIds = new Set();
    this.storage.set("summary", this.summary);
    this.error = "";
    this._failures = 0;
    this.timers.clearTimeout(this._retry);
    this.onChange();
  }
  get pending() { return this.outbox.length; }

  users() {
    const all = new Set([...this.summary.users, ...this.outbox.map((r) => r.user)]);
    return [...all].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  }

  // {word: {right, wrong, unknown, sum_ms, n_ms, last_seen}} for one user, Sheet + outbox.
  tallies(user) {
    const unsent = this.outbox.filter((r) => r.user === user && !this.sheetIds.has(r.id));
    return addTallies({ [user]: this.summary.tallies[user] || {} }, tally(unsent))[user];
  }

  // {coin_id: n} banked by one user, Sheet + outbox.
  coins(user) {
    const unsent = this.outbox.filter((r) => r.user === user && !this.sheetIds.has(r.id));
    return addCoins({ [user]: this.summary.coins[user] || {} }, coinTally(unsent))[user];
  }

  // Validate a name; reuse an existing user's spelling if it matches case-insensitively.
  canonicalName(name) {
    name = name.split(/\s+/).filter(Boolean).join(" ");
    if (!NAME_RE.test(name)) {
      throw new Error("Names are 1-24 letters, digits, spaces, - or _, starting with a letter.");
    }
    if (name.toLowerCase() === "log") throw new Error("Pick another name (that one's taken by the Sheet).");
    return this.users().find((u) => u.toLowerCase() === name.toLowerCase()) || name;
  }

  append(fields) {
    const row = { id: newId(), ts: new Date().toISOString(), ...fields };
    this.outbox.push(row);
    this.storage.set("outbox", this.outbox);
    this.onChange();
    this.flush();
    return row;
  }

  // Send the outbox to the Sheet. Safe to call any time; concurrent calls coalesce.
  flush() {
    if (!this.url || !this.outbox.length) return Promise.resolve();
    if (this._inflight) { this._again = true; return this._inflight; }
    this.timers.clearTimeout(this._retry);
    this.syncing = true;
    this.onChange();
    this._inflight = this._send().then(
      () => { this.error = ""; this._failures = 0; },
      (e) => {
        this.error = `Not saved to the Sheet yet (${e.message}). Will retry.`;
        const delay = RETRY_MS[Math.min(this._failures++, RETRY_MS.length - 1)];
        this._retry = this.timers.setTimeout(() => this.flush(), delay);
      },
    ).finally(() => {
      this._inflight = null;
      this.syncing = false;
      this.onChange();
      if (this._again) { this._again = false; if (!this.error) this.flush(); }
    });
    return this._inflight;
  }

  async _send() {
    while (this.outbox.length) {
      const batch = this.outbox.slice(0, CHUNK);
      const res = await this._call("POST", { rows: batch });
      const stored = new Set(res.ids);
      const acked = batch.filter((r) => stored.has(r.id));
      if (!acked.length) throw new Error("the Sheet didn't accept any rows");
      // Move acked rows from the outbox into the cached summary in one step.
      // A row the Sheet already had (its reply got lost) is in a tab we loaded; don't count it again.
      const fresh = acked.filter((r) => !this.sheetIds.has(r.id));
      const ackedIds = new Set(acked.map((r) => r.id));
      for (const id of ackedIds) this.sheetIds.add(id);
      this.outbox = this.outbox.filter((r) => !ackedIds.has(r.id));
      this.summary = {
        users: [...new Set([...this.summary.users, ...acked.map((r) => r.user)])].sort(),
        tallies: addTallies(this.summary.tallies, tally(fresh)),
        coins: addCoins(this.summary.coins, coinTally(fresh)),
      };
      this.storage.set("outbox", this.outbox);
      this.storage.set("summary", this.summary);
      this.onChange();
    }
  }

  // Re-read the list of students from the Sheet, and load the given students' tabs.
  // Keeps the cached scores if offline.
  async refresh(...users) {
    if (!this.url) return;
    const url = this.url;
    this.loading++;
    this.onChange();
    try {
      // Send first so the tabs we read back already have our rows.
      await this.flush();
      const [list, ...tabs] = await Promise.all([
        this._call("GET", { action: "users" }),
        ...users.filter(Boolean).map((user) => this._call("GET", { action: "rows", user })),
      ]);
      if (url !== this.url) return; // switched Sheets meanwhile
      const tallies = { ...this.summary.tallies };
      const coins = { ...this.summary.coins };
      for (const tab of tabs) {
        const rows = sheetRows(tab);
        for (const r of rows) this.sheetIds.add(r.id);
        tallies[tab.user] = tally(rows)[tab.user] || {};
        coins[tab.user] = coinTally(rows)[tab.user] || {};
      }
      const names = new Set(list.users);
      for (const t of [tallies, coins]) {
        for (const u of Object.keys(t)) if (!names.has(u)) delete t[u]; // tab gone
      }
      this.summary = { users: list.users, tallies, coins };
      this.storage.set("summary", this.summary);
    } catch (e) {
      if (url === this.url) this.error = `Couldn't reach the Sheet (${e.message}); showing saved scores.`;
    } finally {
      this.loading--;
      this.onChange();
    }
  }

  async _call(method, body) {
    const url = method === "GET" ? withParams(this.url, body) : this.url;
    const res = await this.fetch(url, method === "GET" ? { method } : {
      method,
      // text/plain keeps this a "simple" request: no CORS preflight, which Apps Script can't answer.
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(body),
    });
    return parseReply(res);
  }
}

// GET ?action=... against a Sheet URL.
function withParams(url, params) {
  return url + (url.includes("?") ? "&" : "?") + new URLSearchParams(params);
}

async function parseReply(res) {
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  let data;
  try { data = await res.json(); } catch { throw new Error("unexpected reply (is the web app deployed for Anyone?)"); }
  if (!data.ok) throw new Error(data.error || "error from the Sheet");
  return data;
}

// A tab's {user, columns, rows: [[...]]} as row objects, with the user filled in and
// numbers turned back into numbers (the Sheet stores everything as text).
function sheetRows(tab) {
  return tab.rows.map((values) => {
    const r = { user: tab.user };
    tab.columns.forEach((c, i) => { r[c] = values[i]; });
    r.id = String(r.id);
    r.ts = String(r.ts || "");
    r.response_ms = r.response_ms === "" || r.response_ms == null ? null : Number(r.response_ms);
    r.grp = r.grp === "" || r.grp == null ? null : Number(r.grp);
    return r;
  });
}

const SHORT_LINK_RE = /^https?:\/\/(www\.)?(tinyurl\.com|bit\.ly|goo\.gl|t\.co|tiny\.cc|is\.gd|rb\.gy|ow\.ly|shorturl\.at)\//i;

// Check a pasted Sheet URL before saving it: resolves to the list of students.
async function checkSheetUrl(url, fetch = globalThis.fetch.bind(globalThis)) {
  url = url.trim();
  if (/docs\.google\.com\/spreadsheets/.test(url)) {
    throw new Error("That's the link to the spreadsheet itself. The app needs the web app link: " +
                    "in Apps Script, Deploy → Manage deployments, copy the URL ending in /exec.");
  }
  if (!/^https?:\/\//.test(url) && !url.startsWith("/")) throw new Error("That doesn't look like a link.");
  // A short link's redirect has no CORS header for this page, so the browser blocks every call through it.
  if (SHORT_LINK_RE.test(url)) {
    throw new Error("Short links (tinyurl and the like) can't be used here: the browser blocks the app from " +
                    "following them. Paste the full link ending in /exec.");
  }
  let res;
  try { res = await fetch(withParams(url, { action: "users" })); }
  catch (e) { throw new Error(`Couldn't reach it (${e.message}). Check the link and your connection.`); }
  return (await parseReply(res)).users;
}

Object.assign(WB, { NAME_RE, browserStorage, newId, tally, coinTally, sheetRows, checkSheetUrl, Log });
})();
