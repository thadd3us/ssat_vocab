// The study log: append-only rows, one per event (session_start | answer | session_end).
//
// Rows are written to an outbox in localStorage first, then sent to the Google
// Sheet (apps_script/Code.gs) when the network allows. A row leaves the outbox
// only once the Sheet confirms it has that row's id, and the Sheet ignores ids it
// already has, so resending after a dropped connection never double-counts.
//
// Scores come from the Sheet's summary (cached locally, for starting offline)
// plus whatever is still in the outbox. With no Sheet URL configured, the
// outbox simply keeps everything and the app works on this device alone.
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
// Keep in sync with summary_() in apps_script/Code.gs.
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
    this.summary = storage.get("summary", { users: [], tallies: {} });
    this.error = "";
    this.syncing = false;
    this._inflight = null;
    this._again = false;
    this._retry = null;
    this._failures = 0;
  }

  get syncEnabled() { return !!this.url; }
  get pending() { return this.outbox.length; }

  users() {
    const all = new Set([...this.summary.users, ...this.outbox.map((r) => r.user)]);
    return [...all].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  }

  // {word: {right, wrong, sum_ms, n_ms, last_seen}} for one user, Sheet + outbox.
  tallies(user) {
    const t = addTallies(this.summary.tallies, tally(this.outbox));
    return t[user] || {};
  }

  // Validate a name; reuse an existing user's spelling if it matches case-insensitively.
  canonicalName(name) {
    name = name.split(/\s+/).filter(Boolean).join(" ");
    if (!NAME_RE.test(name)) {
      throw new Error("Names are 1-24 letters, digits, spaces, - or _, starting with a letter.");
    }
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
      const ackedIds = new Set(acked.map((r) => r.id));
      this.outbox = this.outbox.filter((r) => !ackedIds.has(r.id));
      this.summary = {
        users: [...new Set([...this.summary.users, ...acked.map((r) => r.user)])].sort(),
        tallies: addTallies(this.summary.tallies, tally(acked)),
      };
      this.storage.set("outbox", this.outbox);
      this.storage.set("summary", this.summary);
      this.onChange();
    }
  }

  // Re-read the summary from the Sheet. Keeps the cached one if offline.
  async refresh() {
    if (!this.url) return;
    try {
      // Send first so the summary we get back already includes our rows.
      await this.flush();
      const s = await this._call("GET");
      this.summary = { users: s.users, tallies: s.tallies };
      this.storage.set("summary", this.summary);
      this.onChange();
    } catch (e) {
      this.error = `Couldn't reach the Sheet (${e.message}); showing saved scores.`;
      this.onChange();
    }
  }

  async _call(method, body) {
    const url = method === "GET" ? `${this.url}?action=summary` : this.url;
    const res = await this.fetch(url, method === "GET" ? { method } : {
      method,
      // text/plain keeps this a "simple" request: no CORS preflight, which Apps Script can't answer.
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    let data;
    try { data = await res.json(); } catch { throw new Error("unexpected reply (is the web app deployed for Anyone?)"); }
    if (!data.ok) throw new Error(data.error || "error from the Sheet");
    return data;
  }
}

Object.assign(WB, { NAME_RE, browserStorage, newId, tally, Log });
})();
