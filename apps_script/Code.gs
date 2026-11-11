/**
 * @OnlyCurrentDoc
 *
 * Word Bank log, kept in the Google Sheet this script is bound to: one tab per
 * student, named after them, one row per event.
 *
 * The @OnlyCurrentDoc line above limits the permission Google asks for to
 * "this spreadsheet only" (spreadsheets.currentonly). Without it, Apps Script
 * sees SpreadsheetApp and asks for access to every spreadsheet you own.
 *
 * Setup (once): in the Sheet, Extensions → Apps Script, paste this file over
 * Code.gs, then Deploy → New deployment → Web app, Execute as: Me, Who has
 * access: Anyone. Paste the /exec URL into the app when it asks.
 *
 * The page talks to it with these calls; nobody using the page needs a Google account.
 *   POST  {"rows": [{id, ts, user, event, ...}, ...]}
 *         Appends each row to its user's tab (making the tab if needed). Rows
 *         whose id is already in that tab are skipped, so the page can safely
 *         resend after a dropped connection.
 *         -> {"ok": true, "ids": [...ids now stored...], "added": n}
 *   GET   ?action=users
 *         -> {"ok": true, "users": [...one per student tab...]}
 *   GET   ?action=rows&user=Ada
 *         -> {"ok": true, "user": "Ada", "columns": [...], "rows": [[...], ...]}
 *         The contents of Ada's tab (the columns the page needs).
 *
 * The log is append-only as far as the page is concerned: this script never
 * edits or deletes a row. (You can, by hand, in the Sheet.)
 *
 * The page sends POST bodies as text/plain so the browser skips the CORS
 * preflight, which Apps Script can't answer.
 */

var COLUMNS = [
  "id", "ts", "received", "user", "session_id", "event", "grp", "mode", "word", "outcome",
  "response_ms", "chosen", "prompt", "options", "stage_before", "stage_after", "detail",
];
// What GET ?action=rows sends back. The rest stays in the Sheet for you to look at.
// (detail carries the coin each right answer banked.)
var READ_COLUMNS = ["id", "ts", "session_id", "event", "grp", "mode", "word", "outcome", "response_ms", "detail"];
// Same rule as NAME_RE in web/log.js. Also keeps tab names plain.
var NAME_RE = /^[A-Za-z][A-Za-z0-9 _-]{0,23}$/;
// Before tabs-per-student, everything went in one tab called "log". It's split up
// automatically on the first call, then renamed to this.
var OLD_LOG = "log";
var OLD_LOG_DONE = "log (split into tabs)";
var MAX_ROWS_PER_POST = 500;

function doGet(e) {
  return respond_(function () {
    var p = (e && e.parameter) || {};
    var action = p.action || "users";
    withLock_(migrateOldLog_);
    if (action === "users") return { users: studentTabs_().map(function (sh) { return sh.getName(); }) };
    if (action === "rows") return readTab_(String(p.user || ""));
    throw new Error("unknown action: " + action);
  });
}

function doPost(e) {
  return respond_(function () {
    var body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    var rows = body.rows || [];
    if (!Array.isArray(rows) || rows.length > MAX_ROWS_PER_POST) throw new Error("bad rows");
    return withLock_(function () {
      migrateOldLog_();
      return appendAll_(rows);
    });
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

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// A student tab is any tab whose first two header cells are ours, so tabs you add
// yourself (charts, notes) are left alone.
function isStudentTab_(sh) {
  if (sh.getLastRow() < 1 || sh.getLastColumn() < 2) return false;
  var h = sh.getRange(1, 1, 1, 2).getValues()[0];
  return h[0] === "id" && h[1] === "ts" && NAME_RE.test(sh.getName()) && sh.getName() !== OLD_LOG;
}

function studentTabs_() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheets().filter(isStudentTab_);
}

// The tab for this user, matched ignoring case (Sheets won't allow "ada" next to "Ada").
function findTab_(user) {
  var want = user.toLowerCase();
  var sheets = SpreadsheetApp.getActiveSpreadsheet().getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getName().toLowerCase() === want) return sheets[i];
  }
  return null;
}

function tabFor_(user) {
  if (!NAME_RE.test(user) || user === OLD_LOG) throw new Error("bad name: " + user);
  var sh = findTab_(user);
  if (sh) {
    if (!isStudentTab_(sh)) throw new Error('there is already a tab called "' + sh.getName() + '"');
    return sh;
  }
  sh = SpreadsheetApp.getActiveSpreadsheet().insertSheet(user);
  sh.getRange(1, 1, 1, COLUMNS.length).setValues([COLUMNS]).setFontWeight("bold");
  sh.setFrozenRows(1);
  return sh;
}

function appendAll_(rows) {
  var byUser = {};
  var order = [];
  rows.forEach(function (row) {
    var user = String(row.user || "");
    if (!byUser[user]) { byUser[user] = []; order.push(user); }
    byUser[user].push(row);
  });
  var ids = [];
  var added = 0;
  var errors = [];
  order.forEach(function (user) {
    try {
      var r = append_(tabFor_(user), byUser[user]);
      ids = ids.concat(r.ids);
      added += r.added;
    } catch (err) {
      errors.push(String(err && err.message || err)); // the page keeps those rows and retries
    }
  });
  if (!ids.length && errors.length) throw new Error(errors.join("; "));
  return { ids: ids, added: added, errors: errors };
}

function append_(sh, rows) {
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
      if (c === "received") return row.received || now;
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

function rowsOf_(sh) {
  var last = sh.getLastRow();
  if (last < 2) return [];
  var header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  return sh.getRange(2, 1, last - 1, header.length).getValues().map(function (r) {
    var row = {};
    header.forEach(function (h, i) { row[h] = r[i]; });
    return row;
  });
}

function readTab_(user) {
  var sh = findTab_(user);
  if (!sh || !isStudentTab_(sh)) return { user: user, columns: READ_COLUMNS, rows: [] };
  return {
    user: sh.getName(),
    columns: READ_COLUMNS,
    rows: rowsOf_(sh).map(function (row) {
      return READ_COLUMNS.map(function (c) { return row[c] === undefined ? "" : row[c]; });
    }),
  };
}

// One-time move from the old single "log" tab into a tab per student. Safe to run
// again: rows already in a student's tab are skipped by id.
function migrateOldLog_() {
  var old = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(OLD_LOG);
  if (!old || old.getLastColumn() < 1 || old.getRange(1, 1).getValues()[0][0] !== "id") return;
  var rows = rowsOf_(old).filter(function (r) { return NAME_RE.test(String(r.user || "")); });
  rows.forEach(function (r) { r.ts = String(r.ts); r.received = String(r.received || ""); });
  appendAll_(rows);
  old.setName(OLD_LOG_DONE);
}
