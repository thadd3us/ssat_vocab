**▶ Use it: https://thadd3us.github.io/ssat_vocab/**

# Word Bank — SSAT vocab practice

Open `web/index.html` in a browser. That's it: no install, no server, no build. The same `web/` folder
also works on any static host, and `bazel build //:word_bank_html` packs it all into one HTML file
(`bazel-bin/word-bank.html`). The study log goes to a Google Sheet through a small Apps Script web app, so
nobody using it needs a Google account. The Sheet's link isn't in the repo: the app asks for it.

Everything is plain `<script>` tags (no ES modules) because browsers won't run modules, or `fetch()`
files, from a page opened from disk. So the data files are also wrapped as `.js`:

- **Word list:** edit `web/ssat_vocab.jsonl`, then run `scripts/embed_assets.sh` to regenerate `web/words.js`
  (the same JSONL text inside a JS string).
- **Ka-ching:** `web/sounds/kaching.wav` becomes the data: URL in `web/sounds/kaching.js`, by the same script.
- **Pronunciations:** each word's recording is `web/sounds/words/<word>.mp3`; the same script wraps them
  all into `web/sounds/pronunciations.js`. After editing the word list, run `node scripts/make_pronunciations.mjs`
  (needs ffmpeg): it records only the words that have no MP3 yet, deletes MP3s of words that are gone, and
  re-runs `embed_assets.sh`. By default it uses Google Translate's voice (the unofficial endpoint behind
  Translate's speaker button: no key, but it could change or rate-limit); `--engine say` uses the Mac's
  built-in voices offline, and `--engine google` (Cloud Text-to-Speech, `GOOGLE_TTS_API_KEY`) or
  `--engine openai` (`OPENAI_API_KEY`) use those APIs. `--redo word1,word2` re-records a few words (say,
  one that sounds wrong), `--redo all` all of them.

`tests/assets.test.js` fails if a generated file is out of date. Only developers need Bazel (or Node):

```bash
bazel build //:word_bank_html                    # everything in one file: bazel-bin/word-bank.html
bazel test //...                                 # tests, with Bazel's own pinned Node (MODULE.bazel)
node --test "tests/*.test.js"                    # the same tests with your Node (22+, no npm install)
node scripts/dev_server.mjs --fake-sheet         # serve web/ with apps_script/Code.gs running in memory
node scripts/build_single_file.mjs               # the single file without Bazel: dist/word-bank.html
node scripts/dev_server.mjs --host 0.0.0.0       # serve web/ to other devices on your network
./scripts/vendor.sh                              # only to change library versions (web/vendor/ is committed)
```

## The Google Sheet

1. Make a Google Sheet. **Extensions → Apps Script**, replace `Code.gs` with
   [`apps_script/Code.gs`](apps_script/Code.gs), save.
2. **Deploy → New deployment → Web app**. Execute as: **Me**. Who has access: **Anyone**. Authorize it.
   The consent screen should ask only to "view and manage spreadsheets that this application has been
   installed in" (the `@OnlyCurrentDoc` line at the top of `Code.gs`), not all your spreadsheets.
3. Open the app and paste the `/exec` URL when it asks. It checks the link, then keeps it in that
   browser's localStorage. **⚙︎** in the header changes it, or switches to "this device only".
   A link ending in `#sheet=<the /exec URL>` fills it in too (handy to text to an iPad); the app then
   drops it from the address bar. Short links (tinyurl, bit.ly) don't work as the Sheet link: their
   redirect doesn't allow other pages to read it, so the browser blocks every call. A short link *to the
   app* works, though: point it at `https://thadd3us.github.io/ssat_vocab/#sheet=<the /exec URL>` and
   opening it sets everything up in one step.

Each student gets a tab named after them (the script makes it on their first answer), one row per
event: `session_start`, `answer`, `session_end`. It never edits or deletes rows. When the app starts it
lists the student tabs, and loads the tab of whoever is picked (again whenever someone else is picked,
here or on the Scores page); scores are worked out from those rows. Tabs you add yourself are ignored.
A Sheet from before tabs-per-student has one `log` tab: the first call splits it into student tabs and
renames it `log (split into tabs)`. If you change `Code.gs`, use **Deploy → Manage deployments → Edit →
New version** to keep the same URL.

Anyone who has the `/exec` URL can add rows and read the scores, so treat it like a shared password for
the Sheet. The Sheet itself stays private. It isn't in the repo, so the page and the single-file build
are safe to host publicly.

Each row goes into a local outbox (localStorage) first and leaves it only when the Sheet confirms
it. Every row has an id, and the script skips ids it already has, so resending after a dropped
connection never counts an answer twice. The badge at the top shows **Saved**, **Saving…**, or
**N unsaved** (tap it to retry). With no Sheet connected, the app keeps everything on that one device;
connecting one later sends those rows to it.

## On the iPad

It is just a web page, but Safari on iPad only runs pages it loads over http(s): opening an `.html`
from the Files app shows a preview with JavaScript off. So the file has to live on a web server, but
any static host will do, and with the single file there's just one thing to upload:

1. Publish a GitHub release (below); the app is then at https://thadd3us.github.io/ssat_vocab/.
   Or `bazel build //:word_bank_html` and put `bazel-bin/word-bank.html` anywhere that serves files over
   https (Netlify Drop, Cloudflare Pages, S3…), or host the `web/` folder as is; same app.
2. On the iPad, open it in Safari, then **Share → Add to Home Screen**. It opens full screen like an app.
3. Open it from the Home Screen and paste the Sheet link (or open your `#sheet=` link). Home Screen
   apps keep their own storage, separate from Safari's, so do this step in the Home Screen app.

Safari can delete a website's storage after 7 days without a visit, but not storage for apps on the
Home Screen, so the outbox, the Sheet link and saved scores are safe there. The page still needs the
network to open (there's no offline cache); answers given while offline wait in the outbox.

### Releases

Publishing a GitHub release runs [`.github/workflows/release.yml`](.github/workflows/release.yml): it
runs the tests, builds the single file, attaches it to the release as `word-bank.html`, and deploys it to
GitHub Pages as `index.html`. **Run workflow** on the Actions tab redeploys Pages without a release.

```bash
gh release create v1.0 --generate-notes
```

One-time setup: **Settings → Pages → Source: GitHub Actions**. (Pages on a private repo needs a paid
GitHub plan; the site itself is public either way, which is fine since the Sheet link isn't in it.)

## How a session works

The 1036 words in `ssat_vocab.jsonl` are split into groups of 20 in file order (group 52 has 16). Groups 1–6 are the original list's first 120 words, kept as they were. From word 121 come all the words of Manhattan Review's [SSAT flashcards](https://www.manhattanreview.com/ssat-vocab-flashcards/) (Essential, then Intermediate, then Advanced, in their deck order; definitions mostly theirs), then the rest of our own list. Each word also has a fill-in-the-blank `sentence`, with `___` where the word goes. And an `explanation`: a sentence or two on where the word comes from (prefixes, roots, related words) and a way to remember it. Roots are given through modern Italian words where one fits (and German cousins where there's a good one), since that's what the students already know, with false friends like *egregio* called out, shown after every answer, right or wrong. Because there's something to read, a right answer waits for **Next** instead of moving on by itself. A session drills one group.

| Answer | Word moves to | Stage |
|---|---|---|
| Miss, or "I don't know" (any time) | slot 3: one other question, then this one again | missed |
| Right, after a miss | slot 4 | recovering |
| Right, while recovering | slot 5 | almost |
| Right otherwise | out of the rotation | **learned** (mastered) |

Mastered words aren't asked again while other words in the group are still being learned. They only
fill in as spacers when a word needs a gap (say slot 5) and fewer words than that are left to learn.
"All mastered" (each word answered right cold at least once) triggers confetti; the kid can keep going,
which cycles through the mastered words as review, or end the session any time. A session in progress
survives a page reload. Spaced-repetition rules live
in `web/engine.js`, with tests in `tests/engine.test.js`.

Each word is said out loud only once it's been answered, so the kid reads it first: over the ka-ching
when right, after the buzzer when wrong, on its own after "I don't know". 🔊 next to the word says it again.

"I don't know" (the button, or `?`) shows the answer with no buzzer and is logged as `unknown`, not
as a miss; on the Scores page it has its own column and counts against accuracy.

Word→Meaning questions have 5 options; Meaning→Word has 6, in a single list; Fill the blank shows the
word's `sentence` and 8 words to pick from. "Mix it up" picks one of the three for each question. The
buttons above the question switch type mid-session: the word on screen is re-asked the new way (or, if the
answer is showing, the next one is), and nothing else about the session changes. Keys:
letters A–H, or 1–8. About half the wrong options come from the word's curated `distractors` (4 of the 7
in Fill the blank), the rest are random words from the same group. In Fill the blank a wrong word is always
the same part of speech as the answer (when it's in the list, so we know), so grammar doesn't give it away. Word→Meaning mode can only use distractors that are themselves in the list (we need
their definitions). Options that would also be correct (same definition, listed synonyms, or each word's
`near_synonyms`, which list the words close enough in meaning that either could be called right) are never offered together.

## Layout

- `web/` — the app: Vue 3 (global build, templates compiled in the browser), GSAP animations, Tone.js sounds,
  canvas-confetti, all in `web/vendor/`. Scripts share one global, `WB`, and load in the order `index.html` lists
  - `engine.js` spaced repetition, `vocab.js` questions, `session.js` one session, `log.js` the log and Sheet sync
  - `coins.js` + `coins/` — each right answer banks a random coin from the set the student picks: through
    history (Athens to the Morgan dollar), ancient Greek, or fantasy realms. Real coins are public-domain/CC0
    photos, credits in [`web/coins/README.md`](web/coins/README.md); fantasy ones are drawn by
    `scripts/make_fantasy_coins.mjs`. Each answer row's `detail.coin` records the coin, and the Scores page
    shows each student's collection with a true fact about every real coin
- `apps_script/Code.gs` — the Google Sheet side
- `scripts/vendor.sh` — re-fetches `web/vendor/` from pinned npm tarballs, sha256-checked; no npm needed
- `scripts/embed_assets.sh` — regenerates `web/words.js`, `web/sounds/kaching.js`, `web/sounds/pronunciations.js`
- `scripts/make_pronunciations.mjs` — records each word into `web/sounds/words/<word>.mp3`
- `scripts/build_single_file.mjs` — inlines `web/` into one HTML file; `MODULE.bazel` + `BUILD.bazel` run it
  (`//:word_bank_html`) and the tests (`bazel test //...`) with a pinned Node, no npm packages
- `scripts/fake_apps_script.mjs` — runs `Code.gs` in Node against an in-memory sheet (tests, `--fake-sheet`)
