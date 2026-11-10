"""End-to-end API tests, including the append-only log."""

import sqlite3
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from ssat_vocab.server import create_app
from ssat_vocab.store import Store


@pytest.fixture
def data_dir(tmp_path):
    return tmp_path / "data"


@pytest.fixture
def client(data_dir):
    return TestClient(create_app(data_dir, seed=123))


def start(client, user="Ada", group=1, mode="mixed"):
    r = client.post("/api/sessions", json={"user": user, "group": group, "mode": mode})
    assert r.status_code == 200, r.text
    return r.json()


def test_index_and_vendor_files_are_served(client):
    assert "Word Bank" in client.get("/").text
    files = ["app.js", "fx.js", "style.css", "sounds/kaching.wav"]
    # Vendored libraries are fetched by Bazel; under plain `uv run pytest` they aren't there.
    if (Path(__file__).parent.parent / "web" / "vendor").exists():
        files += ["vendor/vue.esm-browser.prod.js", "vendor/gsap.min.js", "vendor/Tone.js",
                  "vendor/confetti.module.js"]
    elif "TEST_SRCDIR" in __import__("os").environ:
        pytest.fail("vendor files missing under Bazel")
    for f in files:
        r = client.get(f"/{f}")
        assert r.status_code == 200, f
        expected = {".js": "javascript", ".css": "text/css", ".wav": "audio/"}[Path(f).suffix]
        assert expected in r.headers["content-type"], (f, r.headers["content-type"])


def test_groups(client):
    groups = client.get("/api/groups").json()
    assert len(groups) == 26
    assert groups[0]["first"] == "salacious"


def test_users_created_on_first_session(client):
    assert client.get("/api/users").json() == []
    start(client, "Ada")
    start(client, "ada")  # same person, different case
    start(client, "Grace Hopper")
    assert client.get("/api/users").json() == ["Ada", "Grace Hopper"]


@pytest.mark.parametrize("name", ["", "../etc/passwd", "a/b", "x" * 40, "1abc", "bob.sqlite"])
def test_bad_names_rejected(client, data_dir, name):
    r = client.post("/api/sessions", json={"user": name, "group": 1})
    assert r.status_code == 400
    assert not list(data_dir.glob("*.sqlite"))


def test_question_does_not_leak_answer(client):
    s = start(client, mode="def_to_word")
    q = s["question"]
    assert "answer_index" not in q and "option_words" not in q
    assert "word" not in q and "pos" not in q


def test_word_to_def_question_hides_part_of_speech(client):
    q = start(client, mode="word_to_def")["question"]
    assert q["prompt"] == "salacious" and "pos" not in q


def play(client, s, n, right_pattern):
    """Answer n questions; right_pattern(i) says whether to answer correctly."""
    sid = s["session_id"]
    q = s["question"]
    results = []
    for i in range(n):
        want_right = right_pattern(i)
        idx = client.app.state.peek(sid)
        choice = idx if want_right else (idx + 1) % len(q["options"])
        r = client.post(f"/api/sessions/{sid}/answer",
                        json={"seq": q["seq"], "choice": choice, "response_ms": 1000 + i})
        assert r.status_code == 200, r.text
        r = r.json()
        assert r["correct"] == want_right
        results.append(r)
        q = r["next"]
    return results


def test_full_session_logs_everything(client, data_dir):
    s = start(client, "Ada", group=2, mode="word_to_def")
    results = play(client, s, 25, lambda i: i % 4 != 0)
    assert sum(r["correct"] for r in results) == 18
    end = client.post(f"/api/sessions/{s['session_id']}/end").json()
    assert end["right"] == 18 and end["wrong"] == 7

    rows = Store(data_dir).rows("Ada")
    assert [r["event"] for r in rows] == ["session_start"] + ["answer"] * 25 + ["session_end"]
    a = rows[1]
    assert a["grp"] == 2 and a["mode"] == "word_to_def"
    assert a["outcome"] == "wrong" and a["response_ms"] == 1000
    assert a["ts"].endswith("+00:00")
    assert a["word"] == client.get("/api/groups").json()[1]["first"]
    assert a["stage_before"] == "new" and a["stage_after"] == "missed"
    # The missed word comes back after exactly one other word.
    assert rows[3]["word"] == a["word"]

    scores = {r["word"]: r for r in client.get("/api/scores", params={"user": "Ada", "group": 2}).json()}
    assert sum(r["right"] for r in scores.values()) == 18
    assert sum(r["wrong"] for r in scores.values()) == 7
    assert scores[a["word"]]["wrong"] >= 1


def test_log_is_append_only(client, data_dir):
    start(client, "Ada")
    db = data_dir / "Ada.sqlite"
    with sqlite3.connect(db) as conn:
        with pytest.raises(sqlite3.DatabaseError, match="append-only"):
            conn.execute("UPDATE log SET event = 'x'")
        with pytest.raises(sqlite3.DatabaseError, match="append-only"):
            conn.execute("DELETE FROM log")


def test_double_submit_rejected(client):
    s = start(client)
    q = s["question"]
    url = f"/api/sessions/{s['session_id']}/answer"
    assert client.post(url, json={"seq": q["seq"], "choice": 0, "response_ms": 5}).status_code == 200
    assert client.post(url, json={"seq": q["seq"], "choice": 0, "response_ms": 5}).status_code == 409


def test_unknown_session(client):
    assert client.post("/api/sessions/nope/answer", json={"seq": 1, "choice": 0, "response_ms": 1}).status_code == 404


def test_scores_for_unknown_user_does_not_create_db(client, data_dir):
    rows = client.get("/api/scores", params={"user": "Nobody"}).json()
    assert len(rows) == 505 and all(r["right"] == r["wrong"] == 0 for r in rows)
    assert not (data_dir / "Nobody.sqlite").exists()


def test_separate_db_per_user(client, data_dir):
    start(client, "Ada")
    start(client, "Bo")
    assert sorted(p.name for p in data_dir.glob("*.sqlite")) == ["Ada.sqlite", "Bo.sqlite"]


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-q"]))
