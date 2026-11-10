import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { WB } from "./web.mjs";

const { COINS, pickCoin, seededRandom } = WB;

test("every coin has an image and a credit", () => {
  const credits = readFileSync(new URL("../web/coins/README.md", import.meta.url), "utf8");
  for (const c of COINS) {
    assert.ok(existsSync(new URL(`../web/${c.src}`, import.meta.url)), c.src);
    assert.ok(credits.includes(`\`${c.id}.webp\``), `${c.id} missing from coins/README.md`);
  }
});

test("never the same coin twice in a row, and every coin turns up", () => {
  const rng = seededRandom(3);
  let prev = null;
  const seen = new Set();
  for (let i = 0; i < 500; i++) {
    const c = pickCoin(prev, rng);
    assert.notEqual(c.id, prev);
    seen.add(c.id);
    prev = c.id;
  }
  assert.equal(seen.size, COINS.length);
});
