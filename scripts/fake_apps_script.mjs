// Runs apps_script/Code.gs in Node against an in-memory spreadsheet, with just
// enough of the Apps Script API (SpreadsheetApp, LockService, ContentService)
// for that file. Used by the tests and by scripts/dev_server.mjs.

import { readFileSync } from "node:fs";
import vm from "node:vm";

const CODE = new URL("../apps_script/Code.gs", import.meta.url);

class FakeSheet {
  constructor(name, book) { this.name = name; this.book = book; this.cells = []; } // cells[row][col], 0-indexed
  getName() { return this.name; }
  setName(n) { this.book.delete(this.name); this.name = n; this.book.set(n, this); return this; }
  getLastRow() { return this.cells.length; }
  getLastColumn() { return Math.max(0, ...this.cells.map((r) => r.length)); }
  setFrozenRows() {}
  getRange(row, col, nRows = 1, nCols = 1) {
    const sheet = this;
    let text = false;
    const range = {
      getValues() {
        return Array.from({ length: nRows }, (_, i) =>
          Array.from({ length: nCols }, (_, j) => sheet.cells[row - 1 + i]?.[col - 1 + j] ?? ""));
      },
      setValues(values) {
        if (values.length !== nRows || values.some((r) => r.length !== nCols)) throw new Error("range size mismatch");
        values.forEach((r, i) => {
          const target = (sheet.cells[row - 1 + i] ||= []);
          // Plain-text cells hold what was written as a string, like Sheets does.
          r.forEach((v, j) => { target[col - 1 + j] = text ? String(v) : v; });
        });
        return range;
      },
      setNumberFormat(f) { text = f === "@"; return range; },
      setFontWeight() { return range; },
    };
    return range;
  }
}

export function loadAppsScript() {
  const sheets = new Map();
  const spreadsheet = {
    getSheetByName: (n) => sheets.get(n) || null,
    getSheets: () => [...sheets.values()],
    insertSheet: (n) => {
      if ([...sheets.keys()].some((k) => k.toLowerCase() === n.toLowerCase())) throw new Error(`tab ${n} exists`);
      const s = new FakeSheet(n, sheets); sheets.set(n, s); return s;
    },
  };
  const context = vm.createContext({
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: {
      MimeType: { JSON: "application/json" },
      createTextOutput: (content) => ({ content, setMimeType() { return this; } }),
    },
    JSON, Date, Number, String, Array, Object, isFinite, Error,
  });
  vm.runInContext(readFileSync(CODE, "utf8"), context, { filename: "Code.gs" });
  return {
    sheets,
    spreadsheet,
    get(params = {}) { return JSON.parse(context.doGet({ parameter: params }).content); },
    post(body) { return JSON.parse(context.doPost({ postData: { contents: body } }).content); },
  };
}

// A fetch() that talks to the fake script, for passing to Log in tests.
export function fakeFetch(script, { fail = () => false } = {}) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    calls.push({ url, ...opts });
    if (fail(calls.length)) throw new TypeError("Load failed");
    const method = opts.method || "GET";
    const out = method === "POST" ? script.post(opts.body)
      : script.get(Object.fromEntries(new URL(url, "http://x").searchParams));
    return { ok: true, status: 200, json: async () => out };
  };
  fn.calls = calls;
  return fn;
}
