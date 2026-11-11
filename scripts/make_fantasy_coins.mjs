// Draws the fantasy coins (web/coins/fantasy-*.svg). Original art: no images, symbols
// or lettering copied from any book or film. The "lettering" round the edge is made-up
// rune-ish marks from a seeded RNG, so re-running gives the same files.
//   node scripts/make_fantasy_coins.mjs
import { writeFileSync } from "node:fs";

const METALS = {
  silver:  { hi: "#f6f8fa", mid: "#c5cbd3", lo: "#7f8893", edge: "#59616b" },
  mithril: { hi: "#f3fbff", mid: "#bcd9ea", lo: "#6e95ae", edge: "#486a80" },
  gold:    { hi: "#fff4b8", mid: "#e6b844", lo: "#a8741a", edge: "#77520f" },
  red:     { hi: "#ffe1a6", mid: "#e09a3a", lo: "#9b5418", edge: "#6b3510" }, // red gold
  copper:  { hi: "#f9c9a6", mid: "#c9784c", lo: "#8a4427", edge: "#5e2c18" },
  iron:    { hi: "#c9cfdb", mid: "#7a8396", lo: "#414858", edge: "#262a33" },
};

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

// A ring of made-up glyphs, each drawn upright in a 6×10 box and turned to face outward.
function legend(seed, style, color, r = 73, count = 22) {
  const rand = rng(seed);
  const out = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * 360;
    if (i % 11 === 0) { // a dot divider top and bottom
      out.push(`<circle cx="0" cy="${-r}" r="1.8" transform="rotate(${a} 100 100) translate(100 100)" />`);
      continue;
    }
    const d = [];
    if (style === "angular") {
      d.push("M0 -5 V5"); // stem
      const n = 1 + Math.floor(rand() * 2);
      for (let k = 0; k < n; k++) {
        const y = -5 + Math.floor(rand() * 3) * 3;
        const dir = rand() < 0.5 ? -1 : 1;
        d.push(rand() < 0.5 ? `M0 ${y} L${dir * 3.5} ${y + 3}` : `M0 ${y + 3} L${dir * 3.5} ${y}`);
      }
    } else { // curly
      const dir = rand() < 0.5 ? -1 : 1;
      d.push(`M0 5 V-2`);
      d.push(`M0 -2 q${dir * 4} -5 ${dir * 4} 1 q0 3 ${-dir * 2} 3`);
      if (rand() < 0.6) d.push(`M${-dir * 1} -5 q${-dir * 3} -1 ${-dir * 3} 2`);
    }
    out.push(`<path d="${d.join(" ")}" transform="rotate(${a} 100 100) translate(100 ${100 - r})" />`);
  }
  return `<g fill="${color}" stroke="${color}" stroke-width="1.5" stroke-linecap="round" fill-opacity="0">
    ${out.join("\n    ").replaceAll("<circle", `<circle fill-opacity="1"`)}</g>`;
}

function star(cx, cy, rOut, rIn, points = 5, rot = -90) {
  const pts = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? rIn : rOut;
    const a = ((rot + (i * 180) / points) * Math.PI) / 180;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
  }
  return `<polygon points="${pts.join(" ")}" />`;
}

const octagon = (r) => {
  const pts = [];
  for (let i = 0; i < 8; i++) {
    const a = ((22.5 + i * 45) * Math.PI) / 180;
    pts.push(`${(100 + r * Math.cos(a)).toFixed(1)},${(100 + r * Math.sin(a)).toFixed(1)}`);
  }
  return `<polygon points="${pts.join(" ")}" />`;
};

// Emblems use currentColor so one drawing can be stamped three times for a struck look:
// a dark shadow, a light edge, and the raised face.
const EMBLEMS = {
  leaf: `
    <path d="M100 44 C130 70 134 120 100 156 C66 120 70 70 100 44 Z" />
    <g fill="none" stroke-linecap="round" class="recess">
      <path d="M100 54 V150" stroke-width="3" />
      <path d="M100 76 L84 66 M100 76 L116 66 M100 96 L80 84 M100 96 L120 84 M100 116 L82 104 M100 116 L118 104 M100 134 L88 126 M100 134 L112 126" stroke-width="2" />
    </g>
    <path d="M100 156 q-2 8 -8 12" fill="none" stroke-width="3" stroke-linecap="round" stroke="currentColor" />`,
  forge: `
    <path d="M44 112 Q60 110 64 106 H140 V118 Q126 120 122 128 V136 H132 V144 H76 V136 H86 V128 Q82 120 66 118 Q54 118 44 112 Z" />
    <g transform="rotate(-35 104 76)">
      <rect x="100" y="56" width="8" height="52" rx="2" />
      <rect x="84" y="44" width="40" height="18" rx="2" />
    </g>
    ${star(66, 62, 7, 3, 4, 0)}
    ${star(146, 86, 5, 2, 4, 0)}`,
  hill: `
    <path d="M40 140 Q100 58 160 140 Z" />
    <g class="recess">
      <circle cx="100" cy="122" r="19" />
      <circle cx="132" cy="114" r="6" />
    </g>
    <g fill="none" stroke-width="1.6" class="raised">
      <path d="M100 103 V141 M90 106 V139 M110 106 V139" />
      <path d="M126 114 H138 M132 108 V120" />
    </g>
    <circle cx="106" cy="124" r="2.4" class="raised-fill" />
    <rect x="40" y="139" width="120" height="5" rx="2" />
    <circle cx="100" cy="56" r="9" />
    <g stroke-width="2.4" stroke-linecap="round" fill="none" stroke="currentColor">
      <path d="M100 40 V35 M112 44 L116 40 M88 44 L84 40 M116 56 H121 M84 56 H79" />
    </g>`,
  tree: `
    <g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
      <path d="M100 146 V92" stroke-width="9" />
      <path d="M100 116 C88 108 76 104 66 92 M100 116 C112 108 124 104 134 92" stroke-width="5" />
      <path d="M100 98 C92 88 84 80 80 68 M100 98 C108 88 116 80 120 68 M100 96 V62" stroke-width="4.5" />
      <path d="M66 92 L56 86 M66 92 L64 80 M134 92 L144 86 M134 92 L136 80 M80 68 L72 62 M80 68 L84 58 M120 68 L128 62 M120 68 L116 58 M100 62 L94 54 M100 62 L106 54" stroke-width="3" />
      <path d="M100 146 C92 150 84 150 78 148 M100 146 C108 150 116 150 122 148" stroke-width="4" />
    </g>
    ${star(100, 40, 5, 2.2)} ${star(76, 46, 4.2, 1.8)} ${star(124, 46, 4.2, 1.8)}
    ${star(58, 60, 3.6, 1.5)} ${star(142, 60, 3.6, 1.5)}`,
  horse: `
    <g transform="translate(44 40) scale(1.06)">
      <path d="M64 8 L60 22 C46 26 32 40 20 58 C13 66 10 74 14 78 C18 83 26 83 31 78 C36 74 42 72 48 70 C52 76 56 90 58 100 L94 100 C90 70 86 44 74 20 L70 4 L66 15 Z" />
      <circle cx="45" cy="40" r="3.4" class="recess" />
      <g fill="none" stroke-width="2.2" stroke-linecap="round" class="recess">
        <path d="M74 24 C80 40 84 60 86 84 M68 30 C74 46 76 64 78 86" />
        <path d="M18 70 Q22 72 26 70" />
      </g>
    </g>
    <path d="M66 148 Q100 154 134 148" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" />`,
  wizard: `
    <path d="M70 150 L134 52" stroke="currentColor" stroke-width="6" stroke-linecap="round" fill="none" />
    <circle cx="136" cy="48" r="7" />
    ${star(96, 98, 34, 13, 8)}
    <circle cx="96" cy="98" r="9" class="recess" />
    <path d="M58 54 A16 16 0 1 0 76 76 A12 12 0 1 1 58 54 Z" />`,
  dragon: `
    <path d="M100 98 C86 70 72 58 50 54 C60 64 62 74 58 84 C68 80 76 84 80 92 C86 88 94 92 100 98 Z" />
    <path d="M104 98 C118 70 132 58 154 54 C144 64 142 74 146 84 C136 80 128 84 124 92 C118 88 110 92 104 98 Z" />
    <path d="M60 150 C40 132 58 110 84 114 C104 117 114 108 116 96 C118 84 112 76 122 68" fill="none" stroke="currentColor" stroke-width="10" stroke-linecap="round" />
    <path d="M114 74 L132 56 L136 70 L144 70 L128 82 Z" />
    <path d="M60 150 L46 154 L56 142 Z" />
    <g class="recess"><circle cx="130" cy="66" r="2.2" /></g>
    <g fill="none" stroke-width="1.6" class="recess">
      <path d="M66 140 l6 -6 M74 128 l7 -4 M88 116 l6 -2 M102 112 l5 -4 M112 100 l5 -4" />
    </g>`,
  ship: `
    <path d="M50 118 Q100 146 152 118 L144 110 Q100 128 58 112 Z" />
    <path d="M58 114 C44 102 40 82 52 72 C60 66 68 72 64 80 C62 84 56 84 56 80" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" />
    <path d="M52 72 L44 70 L50 76 Z" />
    <path d="M102 118 V48" stroke="currentColor" stroke-width="3.5" fill="none" />
    <path d="M78 56 Q102 50 126 56 Q122 80 124 104 Q102 98 80 104 Q84 80 78 56 Z" />
    <g class="recess">${star(102, 79, 8, 3.2, 4, 0)}</g>
    <path d="M102 48 L118 42 L102 38 Z" />
    <g fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round">
      <path d="M48 136 q10 -6 20 0 t20 0 t20 0 t20 0 t20 0" />
      <path d="M60 148 q10 -6 20 0 t20 0 t20 0 t20 0" />
    </g>`,
};

export const FANTASY = [
  { id: "fantasy-elven", metal: "mithril", emblem: "leaf", glyphs: "curly", seed: 7 },
  { id: "fantasy-dwarven", metal: "gold", emblem: "forge", glyphs: "angular", seed: 3, shape: "octagon" },
  { id: "fantasy-hill", metal: "copper", emblem: "hill", glyphs: null, seed: 5 },
  { id: "fantasy-tree", metal: "silver", emblem: "tree", glyphs: "curly", seed: 11 },
  { id: "fantasy-horse", metal: "gold", emblem: "horse", glyphs: "angular", seed: 13 },
  { id: "fantasy-wizard", metal: "iron", emblem: "wizard", glyphs: "curly", seed: 17 },
  { id: "fantasy-dragon", metal: "red", emblem: "dragon", glyphs: "angular", seed: 19 },
  { id: "fantasy-ship", metal: "silver", emblem: "ship", glyphs: "curly", seed: 23 },
];

function svg({ metal, emblem, glyphs, seed, shape }) {
  const m = METALS[metal];
  const outer = shape === "octagon" ? octagon(97) : `<circle cx="100" cy="100" r="96" />`;
  const inner = shape === "octagon" ? octagon(87) : `<circle cx="100" cy="100" r="86" />`;
  const beads = [];
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * 2 * Math.PI;
    beads.push(`<circle cx="${(100 + 82 * Math.cos(a)).toFixed(1)}" cy="${(100 + 82 * Math.sin(a)).toFixed(1)}" r="1.5" />`);
  }
  const e = EMBLEMS[emblem];
  // "recess" bits are punched into the raised face; "raised" lines sit on a recess.
  const stamp = (color, dx, dy, opacity = 1) =>
    `<g transform="translate(${dx} ${dy})" color="${color}" fill="${color}" stroke="${color}" stroke-width="0" opacity="${opacity}">${e}</g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
  <defs>
    <radialGradient id="face" cx="0.36" cy="0.3" r="0.8">
      <stop offset="0" stop-color="${m.hi}" /><stop offset="0.55" stop-color="${m.mid}" /><stop offset="1" stop-color="${m.lo}" />
    </radialGradient>
    <linearGradient id="rim" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${m.hi}" /><stop offset="0.5" stop-color="${m.mid}" /><stop offset="1" stop-color="${m.edge}" />
    </linearGradient>
    <style>
      .recess, .recess * { fill: ${m.lo}; stroke: ${m.lo}; }
      .raised, .raised * { stroke: ${m.mid}; fill: none; }
      .raised-fill { fill: ${m.hi}; }
    </style>
  </defs>
  <g fill="url(#rim)">${outer}</g>
  <g fill="url(#face)" stroke="${m.edge}" stroke-width="1.5">${inner}</g>
  <g fill="${m.lo}" opacity="0.7">${beads.join("")}</g>
  ${glyphs ? legend(seed, glyphs, m.edge) : ""}
  ${stamp(m.edge, 1.8, 2, 0.75)}
  ${stamp(m.hi, -1.1, -1.1)}
  ${stamp(m.mid, 0, 0)}
</svg>
`;
}

for (const c of FANTASY) {
  writeFileSync(new URL(`../web/coins/${c.id}.svg`, import.meta.url), svg(c));
}
console.log(`wrote ${FANTASY.length} coins to web/coins/`);
