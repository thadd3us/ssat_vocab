// words.js and sounds/kaching.js are generated (scripts/embed_assets.sh); make sure they're current.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WB } from "./web.mjs";

const read = (p, enc) => readFileSync(new URL(`../web/${p}`, import.meta.url), enc);
const RERUN = "out of date: run scripts/embed_assets.sh";

test("words.js carries ssat_vocab.jsonl verbatim", () => {
  assert.equal(WB.WORDS_JSONL.trim(), read("ssat_vocab.jsonl", "utf8").trim(), RERUN);
});

test("sounds/kaching.js carries kaching.wav", () => {
  assert.equal(WB.KACHING_URL, `data:audio/wav;base64,${read("sounds/kaching.wav").toString("base64")}`, RERUN);
});

test("the single-file build inlines everything and carries no Sheet URL", () => {
  const out = join(mkdtempSync(join(tmpdir(), "wb-")), "word-bank.html");
  execFileSync(process.execPath, [new URL("../scripts/build_single_file.mjs", import.meta.url).pathname, "--out", out]);
  const html = readFileSync(out, "utf8");
  assert.doesNotMatch(html, /script\.google\.com\/macros\/s\/AKfy/);
  assert.match(html, /"coins\/greek\.webp":"data:image\/webp;base64,/);
  assert.doesNotMatch(html, /<script src=|<link rel="stylesheet"/);
});
