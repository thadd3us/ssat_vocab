"""FastAPI app: serves the Vue front end and a small JSON API."""

from __future__ import annotations

import argparse
import os
import random
import threading
import uuid
from dataclasses import dataclass, field
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from ssat_vocab.engine import StudyQueue
from ssat_vocab.store import Store
from ssat_vocab.vocab import GROUP_SIZE, MODES, Vocab

# Not resolve()d: under `bazel run` this keeps us inside the runfiles tree.
ROOT = Path(__file__).parent.parent
DEFAULT_WORDS = ROOT / "ssat_vocab.jsonl"
DEFAULT_WEB = ROOT / "web"


@dataclass
class Session:
    id: str
    user: str
    group: int
    mode: str
    queue: StudyQueue
    rng: random.Random
    question: dict | None = None
    seq: int = 0
    tally: dict = field(default_factory=lambda: {"right": 0, "wrong": 0})


class StartRequest(BaseModel):
    user: str
    group: int
    mode: str = "mixed"


class AnswerRequest(BaseModel):
    seq: int
    choice: int
    response_ms: int = Field(ge=0)


def create_app(data_dir: Path, words_path: Path = DEFAULT_WORDS, web_dir: Path = DEFAULT_WEB,
               seed: int | None = None) -> FastAPI:
    vocab = Vocab.load(words_path)
    store = Store(data_dir)
    sessions: dict[str, Session] = {}
    lock = threading.Lock()
    app = FastAPI(title="SSAT Vocab")
    # For tests: the correct option index of a session's current question.
    app.state.peek = lambda sid: sessions[sid].question["answer_index"]

    def progress(s: Session) -> dict:
        q = s.queue
        return {
            "asked": q.asked,
            "mastered": q.mastered_count,
            "total": len(q.stages),
            "complete": q.complete,
            "right": s.tally["right"],
            "wrong": s.tally["wrong"],
            "stages": {w: st.value for w, st in q.stages.items()},
        }

    def next_question(s: Session) -> dict:
        s.seq += 1
        group = vocab.group(s.group)
        s.question = vocab.build_question(vocab.by_word[s.queue.current.lower()], s.mode, s.rng, pool=group)
        # No answer index, and no part of speech: it's a hint (and in def_to_word, so is the word).
        public = {k: v for k, v in s.question.items() if k not in ("answer_index", "option_words", "pos")}
        if public["mode"] == "def_to_word":
            public.pop("word")  # don't leak the answer
        return {"seq": s.seq, **public}

    def get_session(sid: str) -> Session:
        s = sessions.get(sid)
        if s is None:
            raise HTTPException(404, "Session not found (the server may have restarted).")
        return s

    @app.get("/api/users")
    def users():
        return store.users()

    @app.get("/api/groups")
    def groups():
        return [
            {"group": i + 1, "first": g[0].word, "last": g[-1].word, "words": [e.word for e in g]}
            for i, g in enumerate(vocab.groups)
        ]

    @app.post("/api/sessions")
    def start(req: StartRequest):
        try:
            user = store.canonical_name(req.user)
        except ValueError as e:
            raise HTTPException(400, str(e))
        if req.mode not in MODES:
            raise HTTPException(400, f"mode must be one of {MODES}")
        try:
            words = [e.word for e in vocab.group(req.group)]
        except KeyError:
            raise HTTPException(400, f"no group {req.group}")
        s = Session(id=uuid.uuid4().hex, user=user, group=req.group, mode=req.mode,
                    queue=StudyQueue(words), rng=random.Random(seed))
        with lock:
            sessions[s.id] = s
            store.append(user, session_id=s.id, event="session_start", grp=req.group,
                         mode=req.mode, detail={"words": words})
            return {"session_id": s.id, "user": user, "group": req.group, "mode": req.mode,
                    "question": next_question(s), "progress": progress(s)}

    @app.get("/api/sessions/{sid}")
    def current(sid: str):
        s = get_session(sid)
        with lock:
            return {"session_id": s.id, "user": s.user, "group": s.group, "mode": s.mode,
                    "question": next_question(s), "progress": progress(s)}

    @app.post("/api/sessions/{sid}/answer")
    def answer(sid: str, req: AnswerRequest):
        s = get_session(sid)
        with lock:
            if req.seq != s.seq or s.question is None:
                raise HTTPException(409, "Stale question (double click?)")
            q = s.question
            if not 0 <= req.choice < len(q["options"]):
                raise HTTPException(400, "bad choice")
            correct = req.choice == q["answer_index"]
            was_complete = s.queue.complete
            t = s.queue.answer(correct)
            s.tally["right" if correct else "wrong"] += 1
            store.append(
                s.user, session_id=s.id, event="answer", grp=s.group, mode=q["mode"],
                word=q["word"], outcome="correct" if correct else "wrong",
                response_ms=req.response_ms, chosen=q["options"][req.choice],
                prompt=q["prompt"], options=q["options"],
                stage_before=t.stage_before.value, stage_after=t.stage_after.value,
                detail={"chosen_word": q["option_words"][req.choice], "slot": t.slot,
                        "seq": s.seq, "session_mode": s.mode},
            )
            entry = vocab.by_word[q["word"].lower()]
            chosen = vocab.by_word.get(q["option_words"][req.choice].lower())
            s.question = None
            return {
                "correct": correct,
                "answer_index": q["answer_index"],
                "word": entry.word,
                "pos": entry.pos,
                "definition": entry.definition,
                "synonyms": list(entry.synonyms),
                "chosen_word": q["option_words"][req.choice],
                "chosen_definition": None if correct or chosen is None else chosen.definition,
                "stage_after": t.stage_after.value,
                "just_completed": s.queue.complete and not was_complete,
                "progress": progress(s),
                "next": next_question(s),
            }

    @app.post("/api/sessions/{sid}/end")
    def end(sid: str):
        s = get_session(sid)
        with lock:
            store.append(s.user, session_id=s.id, event="session_end", grp=s.group, mode=s.mode,
                         detail={"asked": s.queue.asked, "mastered": s.queue.mastered_count,
                                 **s.tally})
            sessions.pop(sid, None)
            return progress(s)

    @app.get("/api/scores")
    def scores(user: str, group: int | None = None):
        try:
            user = store.canonical_name(user)
        except ValueError as e:
            raise HTTPException(400, str(e))
        tallies = store.scores(user) if user in store.users() else {}
        entries = vocab.group(group) if group else vocab.entries
        rows = []
        for e in entries:
            t = tallies.get(e.word, {})
            right, wrong = t.get("right") or 0, t.get("wrong") or 0
            rows.append({
                "rank": e.rank, "group": (e.rank - 1) // GROUP_SIZE + 1, "word": e.word,
                "definition": e.definition, "right": right, "wrong": wrong,
                "avg_ms": t.get("avg_ms"), "last_seen": t.get("last_seen"),
            })
        return rows

    @app.get("/")
    def index():
        return FileResponse(web_dir / "index.html")

    # follow_symlink: under Bazel, runfiles are symlinks into the source tree.
    app.mount("/", StaticFiles(directory=web_dir, follow_symlink=True), name="web")
    return app


def main():
    ws = os.environ.get("BUILD_WORKSPACE_DIRECTORY")  # set by `bazel run`
    default_data = Path(ws) / "data" if ws else Path("data")
    p = argparse.ArgumentParser()
    p.add_argument("--host", default="127.0.0.1", help="use 0.0.0.0 to allow other devices on your network")
    p.add_argument("--port", type=int, default=8000)
    p.add_argument("--data-dir", type=Path, default=default_data)
    args = p.parse_args()

    import uvicorn

    print(f"Logs in {args.data_dir.resolve()}\nOpen http://{args.host}:{args.port}/")
    uvicorn.run(create_app(args.data_dir), host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
