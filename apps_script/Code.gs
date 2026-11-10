/**
 * @OnlyCurrentDoc
 *
 * Word Bank log, kept in the Google Sheet this script is bound to.
 *
 * The @OnlyCurrentDoc line above limits the permission Google asks for to
 * "this spreadsheet only" (spreadsheets.currentonly). Without it, Apps Script
 * sees SpreadsheetApp and asks for access to every spreadsheet you own.
 *
 * Setup (once): in the Sheet, Extensions → Apps Script, paste this file over
 * Code.gs, then Deploy → New deployment → Web app, Execute as: Me, Who has
 * access: Anyone. Put the /exec URL in web/config.js.
 *
 * The page talks to it with two calls; nobody using the page needs a Google account.
 *   POST  {"rows": [{id, ts, user, event, ...}, ...]}
 *         Appends rows to the "log" tab. Rows whose id is already there are
 *         skipped, so the page can safely resend after a dropped connection.
 *         -> {"ok": true, "ids": [...every id now stored...], "added": n}
 *   GET   ?action=summary
 *         -> {"ok": true, "users": [...],
 *             "tallies": {user: {word: {right, wrong, unknown, sum_ms, n_ms, last_seen}}}}
 *
 * The log is append-only as far as the page is concerned: this script never
 * edits or deletes a row. (You can, by hand, in the Sheet.)
 *
 * The page sends POST bodies as text/plain so the browser skips the CORS
 * preflight, which Apps Script can't answer.
 */

var SHEET_NAME = "log";
var COLUMNS = [
  "id", "ts", "received", "user", "session_id", "event", "grp", "mode", "word", "outcome",
  "response_ms", "chosen", "prompt", "options", "stage_before", "stage_after", "detail",
];
var MAX_ROWS_PER_POST = 500;

function doGet(e) {
  return respond_(function () {
    var action = (e && e.parameter && e.parameter.action) || "summary";
    if (action !== "summary") throw new Error("unknown action: " + action);
    return summary_(readRows_());
  });
}

function doPost(e) {
  return respond_(function () {
    var body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    var rows = body.rows || [];
    if (!Array.isArray(rows) || rows.length > MAX_ROWS_PER_POST) throw new Error("bad rows");
    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      return append_(rows);
    } finally {
      lock.releaseLock();
    }
  });
}

function respond_(fn) {
  var out;
  try {
    out = fn();
    out.ok = true;
  } catch (err) {
    out = { ok: false, error: String(err && err.message || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.getRange(1, 1, 1, COLUMNS.length).setValues([COLUMNS]).setFontWeight("bold");
    sh.setFrozenRows(1);
  }
  return sh;
}

function append_(rows) {
  var sh = sheet_();
  var last = sh.getLastRow();
  var existing = {};
  if (last > 1) {
    sh.getRange(2, 1, last - 1, 1).getValues().forEach(function (r) { existing[String(r[0])] = true; });
  }
  var now = new Date().toISOString();
  var ids = [];
  var values = [];
  rows.forEach(function (row) {
    var id = String(row.id || "");
    if (!id) return;
    ids.push(id);
    if (existing[id]) return;
    existing[id] = true;
    values.push(COLUMNS.map(function (c) {
      if (c === "received") return now;
      var v = row[c];
      if (v === null || v === undefined) return "";
      return typeof v === "object" ? JSON.stringify(v) : v;
    }));
  });
  if (values.length) {
    var range = sh.getRange(last + 1, 1, values.length, COLUMNS.length);
    range.setNumberFormat("@"); // plain text: keep timestamps and words exactly as sent
    range.setValues(values);
  }
  return { ids: ids, added: values.length };
}

function readRows_() {
  var sh = sheet_();
  var last = sh.getLastRow();
  if (last < 2) return [];
  var header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  return sh.getRange(2, 1, last - 1, header.length).getValues().map(function (r) {
    var row = {};
    header.forEach(function (h, i) { row[h] = r[i]; });
    return row;
  });
}

// Keep in sync with tally() in web/log.js.
function summary_(rows) {
  var users = {};
  var tallies = {};
  rows.forEach(function (r) {
    var user = String(r.user || "");
    if (!user) return;
    users[user] = true;
    if (r.event !== "answer" || !r.word) return;
    var byWord = tallies[user] || (tallies[user] = {});
    var t = byWord[r.word] ||
      (byWord[r.word] = { right: 0, wrong: 0, unknown: 0, sum_ms: 0, n_ms: 0, last_seen: null });
    if (r.outcome === "correct") t.right++;
    else if (r.outcome === "wrong") t.wrong++;
    else if (r.outcome === "unknown") t.unknown++; // "I don't know"
    var ms = Number(r.response_ms);
    if (r.response_ms !== "" && isFinite(ms)) { t.sum_ms += ms; t.n_ms++; }
    var ts = String(r.ts || "");
    if (ts && (!t.last_seen || ts > t.last_seen)) t.last_seen = ts;
  });
  return { users: Object.keys(users).sort(), tallies: tallies };
}
