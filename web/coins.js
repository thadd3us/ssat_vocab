// Old coins for the word bank, oldest first. Images are public domain or CC0;
// sources and credits are in coins/README.md.
(() => {
"use strict";
const WB = (globalThis.WB ||= {});

// The single-file build (scripts/build_single_file.mjs) puts the images in WB.ASSETS as data: URLs.
const asset = (path) => WB.ASSETS?.[path] || path;

const COINS = [
  { id: "greek", name: "Owl tetradrachm", where: "Athens", when: "5th century BC" },
  { id: "roman", name: "Denarius of Augustus", where: "Rome", when: "about 19 BC" },
  { id: "byzantine", name: "Gold solidus of Justinian I", where: "Constantinople", when: "AD 527–565" },
  { id: "chinese", name: "Kaiyuan Tongbao cash", where: "Tang China", when: "AD 621 on" },
  { id: "spanish", name: "Piece of eight (8 reales)", where: "Potosí", when: "1651" },
  { id: "venetian", name: "Ducat of Ludovico Manin", where: "Venice", when: "1789–1797" },
  { id: "american-1794", name: "Flowing Hair dollar", where: "United States", when: "1794" },
  { id: "american-1889", name: "Morgan dollar", where: "United States", when: "1889" },
].map((c) => ({ ...c, src: asset(`coins/${c.id}.webp`) }));

const COIN_BY_ID = Object.fromEntries(COINS.map((c) => [c.id, c]));

// A random coin, never the same one twice in a row.
function pickCoin(previousId, rng = Math.random) {
  const choices = COINS.filter((c) => c.id !== previousId);
  return choices[Math.floor(rng() * choices.length)];
}

// Warm the cache so the first coin doesn't fly in blank.
function preloadCoins() {
  for (const c of COINS) new Image().src = c.src;
}

Object.assign(WB, { COINS, COIN_BY_ID, pickCoin, preloadCoins });
})();
