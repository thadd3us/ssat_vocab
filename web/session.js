// One study session: a StudyQueue over a word group, the current question, and
// the log rows it writes. (This is what the Python server used to do.)
(() => {
"use strict";
const WB = (globalThis.WB ||= {});

const { StudyQueue, Stage, MODES, WORD_TO_DEF, ANALOGY, fillRule, newId } = WB;

// group REVIEW: no fixed group; the session drills an explicit word list (see reviewWords).
const REVIEW = 0;
const REVIEW_SIZE = 20;

class Session {
  constructor({ vocab, log, user, group, mode, rng = Math.random, queue = null, id = newId(), words = null,
                seq = 0, tally = { right: 0, wrong: 0, unknown: 0 }, earned = [], coinSet = null }) {
    if (!MODES.includes(mode)) throw new Error(`mode must be one of ${MODES.join(", ")}`);
    this.vocab = vocab;
    this.log = log;
    this.user = user;
    this.group = group;
    this.mode = mode;
    this.rng = rng;
    this.words = group === REVIEW ? [...words] : vocab.group(group).map((e) => e.word);
    // Wrong answers are drawn from these words first: the group, or the review list (hard words
    // make good decoys for each other).
    this.pool = this.words.map((w) => vocab.get(w));
    this.queue = queue || new StudyQueue(this.words);
    this.id = id;
    this.seq = seq;
    this.tally = { unknown: 0, ...tally };
    this.earned = earned; // coin ids banked this session, in order
    this.coinSet = coinSet || WB.DEFAULT_COIN_SET; // which coins a right answer can bank (coins.js)
    this.q = null; // full current question, including the answer
  }

  // group REVIEW picks the user's most-missed words from their whole history.
  static start({ vocab, log, user, group, mode, rng, coinSet }) {
    user = log.canonicalName(user);
    let words = null;
    if (group === REVIEW) {
      words = reviewWords(vocab, log.tallies(user)).map((r) => r.word);
      if (!words.length) throw new Error("Nothing to review yet: miss a few words first!");
    }
    const s = new Session({ vocab, log, user, group, mode, rng, coinSet, words });
    log.append({ user, session_id: s.id, event: "session_start", grp: group, mode,
                 detail: { words: s.words, coin_set: s.coinSet, ...(group === REVIEW ? { review: true } : {}) } });
    s.nextQuestion();
    return s;
  }

  progress() {
    const q = this.queue;
    return {
      asked: q.asked, mastered: q.masteredCount, total: q.total, complete: q.complete,
      right: this.tally.right, wrong: this.tally.wrong, unknown: this.tally.unknown,
      stages: { ...q.stages },
    };
  }

  nextQuestion() {
    this.seq++;
    const word = this.queue.current;
    this.q = this.vocab.buildQuestion(this.vocab.get(word), this.mode, this.rng, this.pool,
                                      { firstTry: this.queue.stages[word] === Stage.NEW });
    return this.question;
  }

  // Switch question type mid-session. The unanswered question is rebuilt for the same
  // word in the new mode (the queue doesn't move), and later questions use it too.
  setMode(mode) {
    if (!MODES.includes(mode)) throw new Error(`mode must be one of ${MODES.join(", ")}`);
    if (mode === this.mode) return this.question;
    this.mode = mode;
    return this.nextQuestion();
  }

  // What the page shows: no answer, no part of speech (a hint), and the target
  // word only when it's the prompt (word_to_def). An analogy shows its first three words.
  get question() {
    const { mode, prompt, options, word, analogy } = this.q;
    return { seq: this.seq, mode, prompt, options, ...(mode === WORD_TO_DEF ? { word } : {}),
             ...(mode === ANALOGY ? { analogy: { terms: analogy.terms.slice(0, 3) } } : {}) };
  }

  // choice: index into the options, or null for "I don't know".
  answer(choice, responseMs) {
    const q = this.q;
    if (!q) throw new Error("no question to answer");
    const unknown = choice === null;
    if (!unknown && !(choice >= 0 && choice < q.options.length)) throw new Error("bad choice");
    const correct = choice === q.answerIndex;
    const outcome = unknown ? "unknown" : correct ? "correct" : "wrong";
    const wasComplete = this.queue.complete;
    const t = unknown ? this.queue.dontKnow() : this.queue.answer(correct);
    this.tally[{ correct: "right", wrong: "wrong", unknown: "unknown" }[outcome]]++;
    const chosenWord = unknown ? null : q.optionWords[choice];
    // A right answer banks a coin; it rides along in the log row so the Scores page can count them.
    // (Math.random, not this.rng, so seeded question order doesn't depend on the coin set.)
    const coin = correct && WB.pickCoin ? WB.pickCoin(this.earned.at(-1), this.coinSet) : null;
    if (coin) this.earned.push(coin.id);
    this.log.append({
      user: this.user, session_id: this.id, event: "answer", grp: this.group, mode: q.mode,
      word: q.word, outcome, response_ms: responseMs,
      chosen: unknown ? null : q.options[choice], prompt: q.prompt, options: q.options,
      stage_before: t.stageBefore, stage_after: t.stageAfter,
      detail: { chosen_word: chosenWord, slot: t.slot, seq: this.seq, session_mode: this.mode,
                ...(q.answerWord ? { answer_word: q.answerWord } : {}),
                ...(q.analogy ? { analogy: q.analogy.terms, relation: q.analogy.relation } : {}),
                ...(coin ? { coin: coin.id } : {}) },
    });
    const entry = this.vocab.get(q.word);
    const chosen = chosenWord && this.vocab.get(chosenWord);
    this.q = null;
    const an = q.analogy;
    return {
      correct,
      unknown,
      coin,
      mode: q.mode,
      prompt: q.prompt,
      answer_index: q.answerIndex,
      answer_text: q.options[q.answerIndex],
      // The relationship, written as its rule filled in for each pair.
      analogy: an ? { terms: [...an.terms], relation: an.relation,
                      rule: [fillRule(an.rule, an.terms[0], an.terms[1]), fillRule(an.rule, an.terms[2], an.terms[3])] }
                  : null,
      word: entry.word,
      pos: entry.pos,
      definition: entry.definition,
      synonyms: [...entry.synonyms],
      explanation: entry.explanation,
      chosen_word: chosenWord,
      chosen_definition: correct || !chosen ? null : chosen.definition,
      stage_after: t.stageAfter,
      just_completed: this.queue.complete && !wasComplete,
      progress: this.progress(),
      next: this.nextQuestion(),
    };
  }

  end() {
    this.log.append({ user: this.user, session_id: this.id, event: "session_end", grp: this.group,
                      mode: this.mode, detail: { asked: this.queue.asked,
                                                 mastered: this.queue.masteredCount, ...this.tally } });
    return this.progress();
  }

  // For surviving a page reload mid-session (kept in sessionStorage).
  toJSON() {
    return { user: this.user, group: this.group, words: this.words, mode: this.mode, id: this.id, seq: this.seq,
             tally: this.tally, earned: this.earned, coinSet: this.coinSet, queue: this.queue.toJSON(), q: this.q };
  }

  static fromJSON(d, { vocab, log, rng }) {
    const s = new Session({ vocab, log, rng, user: d.user, group: d.group, words: d.words, mode: d.mode, id: d.id,
                            seq: d.seq, tally: d.tally, earned: d.earned || [], coinSet: d.coinSet,
                            queue: StudyQueue.fromJSON(d.queue) });
    s.q = d.q;
    if (!s.q || s.q.word !== s.queue.current) s.nextQuestion();
    return s;
  }
}

// "I don't know" isn't a miss, but it isn't right either; both count against a word here.
const missRate = (r) => {
  const tries = r.right + r.wrong + r.unknown;
  return tries ? (r.wrong + r.unknown) / tries : null;
};

// The words most worth reviewing, worst first: every word ever missed (or not known), by the
// fraction of tries that went wrong, then by how many times. Answering one right lowers its
// rate, so words drop off the list as they're learned.
function reviewWords(vocab, tallies, n = REVIEW_SIZE) {
  return scoreRows(vocab, tallies)
    .map((r) => ({ ...r, miss_rate: missRate(r) }))
    .filter((r) => r.wrong + r.unknown > 0)
    .sort((a, b) => b.miss_rate - a.miss_rate || (b.wrong + b.unknown) - (a.wrong + a.unknown) || a.rank - b.rank)
    .slice(0, n);
}

// Rows for the Scores table.
function scoreRows(vocab, tallies, group = 0) {
  const entries = group ? vocab.group(group) : vocab.entries;
  return entries.map((e) => {
    const t = tallies[e.word] || {};
    return {
      rank: e.rank, group: vocab.groupOf(e), word: e.word, definition: e.definition,
      right: t.right || 0, wrong: t.wrong || 0, unknown: t.unknown || 0,
      avg_ms: t.n_ms ? Math.round(t.sum_ms / t.n_ms) : null, last_seen: t.last_seen || null,
    };
  });
}

Object.assign(WB, { Session, scoreRows, reviewWords, missRate, REVIEW, REVIEW_SIZE });
})();
