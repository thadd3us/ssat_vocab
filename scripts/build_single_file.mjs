// Builds the whole app into one HTML file: every script, the stylesheet, and the
// coin images (as data: URLs) inlined. No Sheet URL inside; the app asks for it.
//
//   node scripts/build_single_file.mjs                 # -> dist/word-bank.html
//   node scripts/build_single_file.mjs --out FILE
//
// The file works opened from disk on a computer, or put on any static host (a
// Safari on iPad only runs pages it loads over http/https; see README.md).

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { parseArgs } from "node:util";

const WEB = new URL("../web/", import.meta.url).pathname;
const { values: args } = parseArgs({
  options: { out: { type: "string", default: new URL("../dist/word-bank.html", import.meta.url).pathname } },
});
const MIME = { ".webp": "image/webp", ".png": "image/png", ".svg": "image/svg+xml" };

const read = (p, enc) => readFileSync(join(WEB, p), enc);
const dataUrl = (p) => `data:${MIME[extname(p)]};base64,${read(p).toString("base64")}`;

// Text that would end or confuse an inline <script> or <style> element.
function inlineable(text, path, tag) {
  if (/<!--/.test(text)) throw new Error(`${path} contains "<!--", which can't be inlined safely`);
  return text.replace(new RegExp(`</(${tag})`, "gi"), "<\\/$1");
}

// Every image the page or scripts refer to by path under coins/.
const html = read("index.html", "utf8");
const scripts = [...html.matchAll(/<script src="([^"]+)"[^>]*><\/script>/g)].map((m) => m[1]);
const assetPaths = new Set();
for (const text of [html, ...scripts.map((s) => read(s, "utf8"))]) {
  for (const m of text.matchAll(/coins\/[a-z0-9-]+\.webp/g)) assetPaths.add(m[0]);
}
for (const id of read("coins.js", "utf8").matchAll(/\bid: "([a-z0-9-]+)"/g)) assetPaths.add(`coins/${id[1]}.webp`);
const assets = Object.fromEntries([...assetPaths].sort().map((p) => [p, dataUrl(p)]));

let out = html
  .replace(/<link rel="stylesheet" href="([^"]+)">/g, (_, p) => `<style>\n${inlineable(read(p, "utf8"), p, "style")}</style>`)
  .replace(/(<link rel="[^"]*icon" href=")([^"]+)(">)/g, (_, a, p, b) => a + assets[p] + b)
  .replace(/( *)<script src="([^"]+)"( defer)?><\/script>/g, (_, indent, p, defer) => {
    const js = inlineable(read(p, "utf8"), p, "script");
    // An inline script can't be deferred; app.js goes at the end of <body> instead (below).
    return defer ? "" : `${indent}<script>/* ${p} */\n${js}\n</script>`;
  })
  .replace("<!-- Plain scripts, no modules, so this page works opened straight from disk. Order matters. -->",
           `<!-- Built by scripts/build_single_file.mjs from web/. Edit those files, not this one. -->\n` +
           `  <script>(globalThis.WB ||= {}).ASSETS = ${JSON.stringify(assets)};</script>`);
const deferred = scripts.filter((p) => new RegExp(`src="${p}" defer`).test(html));
out = out.replace("</body>", deferred.map((p) =>
  `<script>/* ${p} */\n${inlineable(read(p, "utf8"), p, "script")}\n</script>\n`).join("") + "</body>");

const leftovers = [...out.matchAll(/\s(?:src|href)="(?!data:)([^"]+)"/g)].map((m) => m[1]);
if (leftovers.length) throw new Error(`still refers to other files: ${leftovers.join(", ")}`);

mkdirSync(dirname(args.out), { recursive: true });
writeFileSync(args.out, out);
console.log(`${args.out} (${(out.length / 1e6).toFixed(2)} MB)`);
