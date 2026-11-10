// Local static server for web/.
//
//   node scripts/dev_server.mjs                 # http://localhost:8000, uses web/config.js
//   node scripts/dev_server.mjs --fake-sheet    # also runs apps_script/Code.gs in memory at /fake-sheet
//   node scripts/dev_server.mjs --host 0.0.0.0  # let other devices on your network connect
//
// The real app needs no server: open web/index.html, or put web/ on any static host.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { parseArgs } from "node:util";
import { loadAppsScript } from "./fake_apps_script.mjs";

const { values: args } = parseArgs({
  options: {
    port: { type: "string", default: "8000" },
    host: { type: "string", default: "127.0.0.1" },
    "fake-sheet": { type: "boolean", default: false },
  },
});
const ROOT = new URL("../web/", import.meta.url).pathname;
const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".wav": "audio/wav", ".webp": "image/webp", ".json": "application/json",
  ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml",
};
const sheet = args["fake-sheet"] ? loadAppsScript() : null;

createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (sheet && url.pathname === "/fake-sheet") {
    let body = "";
    for await (const chunk of req) body += chunk;
    const out = req.method === "POST" ? sheet.post(body) : sheet.get(Object.fromEntries(url.searchParams));
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(out));
    return;
  }
  if (sheet && url.pathname === "/config.js") {
    res.writeHead(200, { "Content-Type": "text/javascript" }).end('(globalThis.WB ||= {}).SHEET_URL = "/fake-sheet";\n');
    return;
  }
  const path = normalize(join(ROOT, decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname)));
  if (!path.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  try {
    const data = await readFile(path);
    res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream", "Cache-Control": "no-cache" }).end(data);
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(Number(args.port), args.host, () => {
  console.log(`http://${args.host === "0.0.0.0" ? "localhost" : args.host}:${args.port}/${sheet ? "  (fake Sheet at /fake-sheet)" : ""}`);
});
