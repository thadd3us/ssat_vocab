# Word Bank — SSAT vocab practice

Open `web/index.html` in a browser. That's it: no install, no server, no build. The same `web/` folder
also works on any static host. The study log goes to a Google Sheet through a small Apps Script web app,
so nobody using it needs a Google account.

Everything is plain `<script>` tags (no ES modules) because browsers won't run modules, or `fetch()`
files, from a page opened from disk. So the two data files are also wrapped as `.js`:

- **Word list:** edit `web/ssat_vocab_410.jsonl`, then run `scripts/embed_assets.sh` to regenerate `web/words.js`
  (the same JSONL text inside a JS string).
- **Ka-ching:** `web/sounds/kaching.wav` becomes the data: URL in `web/sounds/kaching.js`, by the same script.

`tests/assets.test.js` fails if either generated file is out of date. Only developers need Node:

```bash
node --test tests/                               # tests (Node 22+, no npm install)
node scripts/dev_server.mjs --fake-sheet         # serve web/ with apps_script/Code.gs running in memory
node scripts/dev_server.mjs --host 0.0.0.0       # serve web/ to other devices on your network
./scripts/vendor.sh                              # only to change library versions (web/vendor/ is committed)
```

## The Google Sheet

1. Make a Google Sheet. **Extensions → Apps Script**, replace `Code.gs` with
   [`apps_script/Code.gs`](apps_script/Code.gs), save.
2. **Deploy → New deployment → Web app**. Execute as: **Me**. Who has access: **Anyone**. Authorize it.
   The consent screen should ask only to "view and manage spreadsheets that this application has been
   installed in" (the `@OnlyCurrentDoc` line at the top of `Code.gs`), not all your spreadsheets.
3. Put the `/exec` URL in [`web/config.js`](web/config.js).

The script appends rows to a `log` tab (it creates the tab), one row per event: `session_start`,
`answer`, `session_end`, with the user's name in a column. It never edits or deletes rows. Scores are
worked out from the rows. If you change `Code.gs`, use **Deploy → Manage deployments → Edit → New
version** to keep the same URL.

Anyone who has the `/exec` URL can add rows and read the scores. The page holds the URL, so treat it
like a shared password for the Sheet. The Sheet itself stays private.

Each row goes into a local outbox (localStorage) first and leaves it only when the Sheet confirms
it. Every row has an id, and the script skips ids it already has, so resending after a dropped
connection never counts an answer twice. The badge at the top shows **Saved**, **Saving…**, or
**N unsaved** (tap it to retry). With `SHEET_URL` empty, the app keeps everything on that one device.

## On the iPad

Safari on the iPad won't run a web page from the Files app, so host `web/` somewhere (any static
host, no build step), open it in Safari, and use **Share → Add to Home Screen**. Safari can delete a website's storage after 7 days without a visit,
but not storage for apps on the Home Screen, so the outbox and saved scores are safe there.

## How a session works

The 410 words are split into groups of 20 in rank order (group 21 has 10). A session drills one group.

| Answer | Word moves to | Stage |
|---|---|---|
| Miss, or "I don't know" (any time) | slot 3: one other question, then this one again | missed |
| Right, after a miss | slot 5 | recovering |
| Right, while recovering | back of the words still being learned (at least slot 8) | almost |
| Right otherwise | out of the rotation | **learned** (mastered) |

Mastered words aren't asked again while other words in the group are still being learned. They only
fill in as spacers when a word needs a gap (say slot 5) and fewer words than that are left to learn.
"All mastered" (each word answered right cold at least once) triggers confetti; the kid can keep going,
which cycles through the mastered words as review, or end the session any time. A session in progress
survives a page reload. Spaced-repetition rules live
in `web/engine.js`, with tests in `tests/engine.test.js`.

"I don't know" (the button, or `?`) shows the answer with no buzzer and is logged as `unknown`, not
as a miss; on the Scores page it has its own column and counts against accuracy.

Word→Meaning questions have 5 options; Meaning→Word has 16, in a 4×4 grid. Keys: letters A–P, or 1–9.
About half the wrong options come from the word's curated `distractors`, the rest are random words from the
same group. Word→Meaning mode can only use distractors that are themselves in the list (we need
their definitions). Options that would also be correct (same definition, listed synonyms, or the
`NEAR_SYNONYMS` in `web/vocab.js`) are never offered together.

## Layout

- `web/` — the app: Vue 3 (global build, templates compiled in the browser), GSAP animations, Tone.js sounds,
  canvas-confetti, all in `web/vendor/`. Scripts share one global, `WB`, and load in the order `index.html` lists
  - `engine.js` spaced repetition, `vocab.js` questions, `session.js` one session, `log.js` the log and Sheet sync
  - `coins.js` + `coins/` — each right answer banks a random old coin (Athens to the Morgan dollar);
    public-domain/CC0 photos, credits in [`web/coins/README.md`](web/coins/README.md)
- `apps_script/Code.gs` — the Google Sheet side
- `scripts/vendor.sh` — re-fetches `web/vendor/` from pinned npm tarballs, sha256-checked; no npm needed
- `scripts/embed_assets.sh` — regenerates `web/words.js` and `web/sounds/kaching.js`
- `scripts/fake_apps_script.mjs` — runs `Code.gs` in Node against an in-memory sheet (tests, `--fake-sheet`)
