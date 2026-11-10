"""Per-user, append-only SQLite log of what happened.

One file per user: <data_dir>/<name>.sqlite. One table, `log`, one row per
event. UPDATE and DELETE are blocked by triggers. Scores are derived from
the log by query; nothing else is stored.
"""

from __future__ import annotations

import json
import re
import sqlite3
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path

NAME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9 _-]{0,23}$")

SCHEMA = """
CREATE TABLE IF NOT EXISTS log (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    ts           TEXT    NOT NULL,  -- ISO-8601 UTC, ms precision
    session_id   TEXT    NOT NULL,
    event        TEXT    NOT NULL,  -- session_start | answer | session_end
    grp          INTEGER,           -- 1-indexed word group
    mode         TEXT,              -- word_to_def | def_to_word (mixed is resolved per question)
    word         TEXT,              -- target word
    outcome      TEXT,              -- correct | wrong
    response_ms  INTEGER,           -- time from question shown to click
    chosen       TEXT,              -- the option text that was clicked
    prompt       TEXT,              -- what was shown as the question
    options      TEXT,              -- JSON list of option texts, in display order
    stage_before TEXT,              -- spaced-repetition stage before/after answering
    stage_after  TEXT,
    detail       TEXT               -- JSON, anything else
);
CREATE INDEX IF NOT EXISTS log_word ON log(word);
CREATE TRIGGER IF NOT EXISTS log_no_update BEFORE UPDATE ON log
    BEGIN SELECT RAISE(ABORT, 'log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS log_no_delete BEFORE DELETE ON log
    BEGIN SELECT RAISE(ABORT, 'log is append-only'); END;
"""

COLUMNS = (
    "session_id", "event", "grp", "mode", "word", "outcome", "response_ms",
    "chosen", "prompt", "options", "stage_before", "stage_after", "detail",
)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


class Store:
    def __init__(self, data_dir: Path):
        self.data_dir = Path(data_dir)
        self.data_dir.mkdir(parents=True, exist_ok=True)

    def users(self) -> list[str]:
        return sorted((p.stem for p in self.data_dir.glob("*.sqlite")), key=str.lower)

    def canonical_name(self, name: str) -> str:
        """Validate a name; reuse an existing user's spelling if it matches case-insensitively."""
        name = " ".join(name.split())
        if not NAME_RE.match(name):
            raise ValueError("Names are 1-24 letters, digits, spaces, - or _, starting with a letter.")
        for existing in self.users():
            if existing.lower() == name.lower():
                return existing
        return name

    def _connect(self, user: str) -> sqlite3.Connection:
        conn = sqlite3.connect(self.data_dir / f"{self.canonical_name(user)}.sqlite")
        conn.row_factory = sqlite3.Row
        conn.executescript(SCHEMA)
        return conn

    def append(self, user: str, **fields) -> int:
        unknown = set(fields) - set(COLUMNS)
        if unknown:
            raise TypeError(f"unknown log fields: {unknown}")
        for key in ("options", "detail"):
            if key in fields and not isinstance(fields[key], str | None):
                fields[key] = json.dumps(fields[key])
        cols = ["ts", *fields]
        with closing(self._connect(user)) as conn, conn:
            cur = conn.execute(
                f"INSERT INTO log ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})",
                [now_iso(), *fields.values()],
            )
            return cur.lastrowid

    def rows(self, user: str) -> list[dict]:
        with closing(self._connect(user)) as conn:
            return [dict(r) for r in conn.execute("SELECT * FROM log ORDER BY id")]

    def scores(self, user: str) -> dict[str, dict]:
        """Per-word right/wrong tallies across all sessions."""
        sql = """
            SELECT word,
                   SUM(outcome = 'correct') AS right,
                   SUM(outcome = 'wrong')   AS wrong,
                   CAST(AVG(response_ms) AS INTEGER) AS avg_ms,
                   MAX(ts) AS last_seen
            FROM log WHERE event = 'answer' GROUP BY word
        """
        with closing(self._connect(user)) as conn:
            return {r["word"]: dict(r) for r in conn.execute(sql)}
