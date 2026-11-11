import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { WB } from "./web.mjs";

const { COINS, COIN_SETS, pickCoin, seededRandom } = WB;

test("every coin has an image, a fact, and (if real) a credit", () => {
  const credits = readFileSync(new URL("../web/coins/README.md", import.meta.url), "utf8");
  for (const c of COINS) {
    assert.ok(existsSync(new URL(`../web/${c.src}`, import.meta.url)), c.src);
    assert.ok(c.fact.length > 40, `${c.id} needs a fact`);
    const file = c.src.split("/").at(-1);
    if (!c.madeUp) assert.ok(credits.includes(`\`${file}\``), `${file} missing from coins/README.md`);
  }
});

test("every coin is in a set, and ids are unique", () => {
  assert.equal(new Set(COINS.map((c) => c.id)).size, COINS.length);
  const inSets = new Set(COIN_SETS.flatMap((s) => s.coins.map((c) => c?.id)));
  assert.ok(!inSets.has(undefined), "a set names a coin that doesn't exist");
  for (const c of COINS) assert.ok(inSets.has(c.id), `${c.id} isn't in any set`);
});

for (const set of COIN_SETS) {
  test(`${set.name}: never the same coin twice in a row, and every coin turns up`, () => {
    const rng = seededRandom(3);
    const ids = new Set(set.coins.map((c) => c.id));
    let prev = null;
    const seen = new Set();
    for (let i = 0; i < 500; i++) {
      const c = pickCoin(prev, set.id, rng);
      assert.notEqual(c.id, prev);
      assert.ok(ids.has(c.id));
      seen.add(c.id);
      prev = c.id;
    }
    assert.equal(seen.size, ids.size);
  });
}

test("an unknown set falls back to the default", () => {
  const ids = new Set(WB.COIN_SET_BY_ID[WB.DEFAULT_COIN_SET].coins.map((c) => c.id));
  assert.ok(ids.has(pickCoin(null, "nope").id));
});
