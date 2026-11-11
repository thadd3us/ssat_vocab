// Speaks every word in web/ssat_vocab.jsonl into web/sounds/words/<word>.mp3, then runs
// scripts/embed_assets.sh to wrap them into web/sounds/pronunciations.js (a page opened
// from disk can't fetch the .mp3s). The app plays a word with the ka-ching or buzzer,
// after the kid answers.
//
// The MP3s are the cache: a word that already has one is skipped, so after adding words
// only the new ones get spoken. MP3s for words no longer in the list are deleted.
//
//   node scripts/make_pronunciations.mjs                          # Google Translate's voice
//   node scripts/make_pronunciations.mjs --engine say             # macOS `say` (offline)
//   GOOGLE_TTS_API_KEY=... node scripts/make_pronunciations.mjs --engine google
//   OPENAI_API_KEY=...     node scripts/make_pronunciations.mjs --engine openai
//   node scripts/make_pronunciations.mjs --redo lugubrious,salacious   # respeak just these
//   node scripts/make_pronunciations.mjs --redo all --engine say       # respeak everything
//
// Needs ffmpeg (trims silence, evens out loudness, encodes small mono MP3s).

import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync, readdirSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

const run = promisify(execFile);
const WEB = new URL("../web/", import.meta.url).pathname;
const DIR = join(WEB, "sounds/words");

const ENGINES = {
  // The voice behind the speaker button on translate.google.com. No key, but it's an
  // unofficial endpoint (the one the gTTS library uses), so go slowly: one word at a time.
  translate: {
    voice: "en-US",
    jobs: 1,
    async speak(word, voice, dir) {
      await new Promise((r) => setTimeout(r, 400));
      const q = new URLSearchParams({ ie: "UTF-8", client: "tw-ob", tl: voice, q: word });
      const res = await fetch(`https://translate.google.com/translate_tts?${q}`,
                              { headers: { "User-Agent": "Mozilla/5.0" } });
      if (!res.ok || !res.headers.get("content-type")?.startsWith("audio/")) {
        throw new Error(`Translate TTS ${res.status} ${res.headers.get("content-type")}`);
      }
      const f = join(dir, "translate.mp3");
      writeFileSync(f, Buffer.from(await res.arrayBuffer()));
      return f;
    },
  },
  // macOS's built-in voices. Premium/Enhanced ones (System Settings → Accessibility →
  // Spoken Content → Manage Voices) sound better, e.g. --voice "Zoe (Premium)".
  say: {
    voice: "Samantha",
    jobs: 8,
    async speak(word, voice, dir) {
      const f = join(dir, "say.aiff");
      await run("say", ["-v", voice, "-r", "150", "-o", f, word]);
      return f;
    },
  },
  // Google Cloud Text-to-Speech: make an API key restricted to that API
  // (console.cloud.google.com → APIs & Services). 508 words fit in the free tier.
  google: {
    voice: "en-US-Neural2-F",
    jobs: 4,
    async speak(word, voice, dir) {
      const key = need("GOOGLE_TTS_API_KEY");
      const res = await fetch("https://texttospeech.googleapis.com/v1/text:synthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key },
        body: JSON.stringify({
          input: { text: word },
          voice: { languageCode: voice.slice(0, 5), name: voice },
          audioConfig: { audioEncoding: "MP3", speakingRate: 0.9 },
        }),
      });
      if (!res.ok) throw new Error(`Google TTS ${res.status}: ${await res.text()}`);
      const f = join(dir, "google.mp3");
      writeFileSync(f, Buffer.from((await res.json()).audioContent, "base64"));
      return f;
    },
  },
  openai: {
    voice: "coral",
    jobs: 4,
    async speak(word, voice, dir) {
      const key = need("OPENAI_API_KEY");
      const res = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: "gpt-4o-mini-tts", voice, input: word, response_format: "mp3",
          instructions: "Say this one English vocabulary word, once, clearly and naturally, " +
                        "in standard American English, the way a teacher says it to a student.",
        }),
      });
      if (!res.ok) throw new Error(`OpenAI TTS ${res.status}: ${await res.text()}`);
      const f = join(dir, "openai.mp3");
      writeFileSync(f, Buffer.from(await res.arrayBuffer()));
      return f;
    },
  },
};

const { values: args } = parseArgs({
  options: {
    engine: { type: "string", default: "translate" },
    voice: { type: "string" },
    redo: { type: "string", default: "" },
  },
});
const engine = ENGINES[args.engine];
if (!engine) throw new Error(`--engine must be one of: ${Object.keys(ENGINES).join(", ")}`);
const voice = args.voice || engine.voice;
const redo = new Set(args.redo.split(",").map((w) => w.trim()).filter(Boolean));

function need(name) {
  if (!process.env[name]) throw new Error(`set ${name} to use --engine ${args.engine}`);
  return process.env[name];
}

// Trim the silence off both ends, bring the peak to -1 dBFS, and encode a small mono MP3.
async function toMp3(input, dir) {
  const trim = "silenceremove=start_periods=1:start_threshold=-50dB," +
               "areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse";
  const { stderr } = await run("ffmpeg", ["-hide_banner", "-i", input, "-af", `${trim},volumedetect`,
                                          "-f", "null", "-"]);
  const peak = Number(/max_volume: (-?[\d.]+) dB/.exec(stderr)?.[1] ?? 0);
  const out = join(dir, "out.mp3");
  await run("ffmpeg", ["-v", "error", "-y", "-i", input,
                       "-af", `${trim},volume=${(-1 - peak).toFixed(1)}dB`,
                       "-ac", "1", "-ar", "22050", "-c:a", "libmp3lame", "-b:a", "32k", out]);
  return readFileSync(out);
}

const words = readFileSync(join(WEB, "ssat_vocab.jsonl"), "utf8").split("\n").filter(Boolean)
  .map((l) => JSON.parse(l).word);
const mp3 = (w) => join(DIR, `${w}.mp3`);
for (const f of readdirSync(DIR)) {
  if (f.endsWith(".mp3") && !words.includes(f.slice(0, -4))) rmSync(join(DIR, f));
}
const todo = words.filter((w) => redo.has("all") || redo.has(w) || !existsSync(mp3(w)));
console.log(`${words.length} words, ${words.length - todo.length} recorded, speaking ${todo.length} ` +
            `with ${args.engine} ${voice}`);

let done = 0, failed = 0;
const queue = [...todo];
await Promise.all(Array.from({ length: engine.jobs }, async () => {
  for (let w; (w = queue.shift()); ) {
    const dir = mkdtempSync(join(tmpdir(), "pron-"));
    try {
      writeFileSync(mp3(w), await toMp3(await engine.speak(w, voice, dir), dir));
    } catch (e) {
      failed++;
      console.error(`\n${w}: ${e.message}`); // keeps its old recording, if any; the next run retries
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    process.stdout.write(`\r${++done}/${todo.length}`);
  }
}));
if (todo.length) process.stdout.write("\n");

await run(new URL("embed_assets.sh", import.meta.url).pathname).then(({ stdout }) => process.stdout.write(stdout));
const missing = words.filter((w) => !existsSync(mp3(w)));
if (failed || missing.length) {
  console.error(`${failed} failed; no recording yet: ${missing.join(", ") || "none"}`);
  process.exitCode = 1;
}
