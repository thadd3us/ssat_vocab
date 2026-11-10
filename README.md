# Word Bank — SSAT vocab practice

```bash
bazel run //:app                          # http://127.0.0.1:8000
bazel run //:app -- --host 0.0.0.0        # let the kids' tablets on your network connect
bazel test //...
```

Logs go to `data/<Name>.sqlite` (one file per kid, append-only; UPDATE/DELETE are blocked by triggers).
Peek at one with `sqlite3 data/Ada.sqlite 'select ts, word, outcome, response_ms from log'`.

## How a session works

The 505 words in `ssat_vocab.jsonl` are split into groups of 20 in file order (group 26 has 5). A session drills one group.

| Answer | Word moves to | Stage |
|---|---|---|
| Miss (any time) | slot 3: one other word, then this one again | missed |
| Right, after a miss | slot 5 | recovering |
| Right, while recovering | back of the list | almost |
| Right otherwise | back of the list | **learned** (mastered) |

"All mastered" (each word answered right cold at least once) triggers confetti; the kid can keep going
or end the session any time. Spaced-repetition rules live in `ssat_vocab/engine.py`, with tests in
`tests/engine_test.py`.

Each question has 5 options: half from the word's curated `distractors`, half random words from the
same group. Word→Meaning mode can only use distractors that are themselves in the list (we need
their definitions). Options that would also be correct (same definition, listed synonyms, or the
`NEAR_SYNONYMS` in `ssat_vocab/vocab.py`) are never offered together.

## Layout

- `ssat_vocab/` — FastAPI server (`server.py`), SR engine, question builder, SQLite log
- `web/` — Vue 3 (no build step), GSAP animations, Tone.js sounds, canvas-confetti
- Browser libraries come from pinned npm tarballs via `MODULE.bazel`; no Node needed
- Python deps: edit `pyproject.toml`, then
  `uv lock && uv export --all-groups --no-emit-project -o requirements_lock.txt`
