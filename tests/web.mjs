// Loads the page's plain scripts into Node, in index.html's order, and hands back
// the WB namespace they fill in. (fx.js and app.js need a real page, so they're skipped.)
import { readFileSync } from "node:fs";
import "../web/words.js";
import "../web/sounds/kaching.js";
import "../web/engine.js";
import "../web/vocab.js";
import "../web/log.js";
import "../web/session.js";
import "../web/coins.js";

export const WB = globalThis.WB;
// The tests read the .jsonl itself; tests/assets.test.js checks words.js carries the same text.
export const vocab = WB.Vocab.parse(
  readFileSync(new URL("../web/ssat_vocab_410.jsonl", import.meta.url), "utf8"));
