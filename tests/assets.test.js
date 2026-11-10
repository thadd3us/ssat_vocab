// words.js and sounds/kaching.js are generated (scripts/embed_assets.sh); make sure they're current.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { WB } from "./web.mjs";

const read = (p, enc) => readFileSync(new URL(`../web/${p}`, import.meta.url), enc);
const RERUN = "out of date: run scripts/embed_assets.sh";

test("words.js carries ssat_vocab_410.jsonl verbatim", () => {
  assert.equal(WB.WORDS_JSONL.trim(), read("ssat_vocab_410.jsonl", "utf8").trim(), RERUN);
});

test("sounds/kaching.js carries kaching.wav", () => {
  assert.equal(WB.KACHING_URL, `data:audio/wav;base64,${read("sounds/kaching.wav").toString("base64")}`, RERUN);
});
