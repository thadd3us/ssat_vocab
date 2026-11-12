// Spaced-repetition queue for one study session.
//
// Words still being learned wait in an ordered "active" list; the front one is
// asked. Slots count the word just asked as slot 1, so "slot 3" means "one other
// question, then this word again".
//
//   * Miss or "I don't know"      -> slot 3            stage = MISSED
//   * Right while MISSED          -> slot 4            stage = RECOVERING
//   * Right while RECOVERING      -> slot 5            stage = REVIEW ("almost")
//   * Right while NEW/REVIEW/...  -> mastered pile     stage = LEARNED
//
// So a missed word has to be answered right three times running, each a little
// further out (one, two, then three other questions in between), before it leaves;
// a miss anywhere along the way starts it over at slot 3. A word answered right on
// first sight is LEARNED straight away. Learned words leave the rotation, so nobody
// re-answers words they already know while others are still being learned. They
// come back in two ways:
//
//   * As spacers. When a word needs to wait (say slot 5) but fewer than that many
//     words are still being learned, the gap is filled with mastered words, oldest
//     first. Near the end of a group that's the only reason a mastered word shows up.
//   * As review. Once every word is mastered the session is complete; if the
//     learner keeps going, mastered words cycle oldest first. A miss then drops
//     the word back into drilling, without un-mastering it.
//
// Known quirk: if the learner keeps missing two words back to back, those two
// ping-pong at the front (A, B, A, B, ...) until one is answered right. That is
// deliberate drilling, but it does hold up the rest of the list.
(() => {
"use strict";
const WB = (globalThis.WB ||= {});

const MISS_SLOT = 3;
const RECOVER_SLOT = 4;
const REVIEW_SLOT = 5;
const SPACER = null; // a placeholder in `active`: ask a mastered word here

const Stage = Object.freeze({
  NEW: "new",
  MISSED: "missed",
  RECOVERING: "recovering",
  REVIEW: "review",
  LEARNED: "learned",
});

class StudyQueue {
  constructor(words) {
    if (!words.length) throw new Error("need at least one word");
    if (new Set(words).size !== words.length) throw new Error("duplicate words");
    this.active = [...words]; // words still being learned, and SPACERs
    this.done = [];           // mastered words, least recently asked first
    this.stages = Object.fromEntries(words.map((w) => [w, Stage.NEW]));
    this.mastered = new Set();
    this.asked = 0;
    this.last = null;         // the word asked most recently
  }

  get total() { return this.done.length + this.active.filter((w) => w !== SPACER).length; }
  get masteredCount() { return this.mastered.size; }
  get complete() { return this.mastered.size === this.total; }

  // Upcoming words still being learned, in order, then the mastered pile.
  get order() { return [...this.active.filter((w) => w !== SPACER), ...this.done]; }

  // Drop spacers that can't (or shouldn't) be filled: nothing is mastered yet, or
  // the only mastered word was just asked.
  _settle() {
    while (this.active[0] === SPACER &&
           (!this.done.length || (this.done.length === 1 && this.done[0] === this.last))) {
      this.active.shift();
    }
  }

  get current() {
    this._settle();
    const front = this.active.length ? this.active[0] : SPACER;
    return front === SPACER ? this.done[0] : front;
  }

  // Put `word` at `slot`, padding with spacers if fewer words are waiting.
  _place(word, slot) {
    const index = slot - 2;
    while (this.active.length < index) this.active.push(SPACER);
    this.active.splice(index, 0, word);
  }

  // Returns {word, correct, stageBefore, stageAfter, slot}; slot is 1-indexed,
  // counting the just-asked word as slot 1 (for a mastered word: its place in `order`, plus 1).
  answer(correct) {
    this._settle();
    const word = this.current;
    if (this.active.length) this.active.shift(); // the word itself, or the spacer it filled
    if (this.done[0] === word) this.done.shift();
    const before = this.stages[word];
    let after, slot;
    if (!correct) [after, slot] = [Stage.MISSED, MISS_SLOT];
    else if (before === Stage.MISSED) [after, slot] = [Stage.RECOVERING, RECOVER_SLOT];
    else if (before === Stage.RECOVERING) [after, slot] = [Stage.REVIEW, REVIEW_SLOT];
    else after = Stage.LEARNED;
    if (after === Stage.LEARNED) {
      this.done.push(word);
      this.mastered.add(word);
      slot = this.order.length + 1;
    } else {
      this._place(word, slot);
    }
    this.stages[word] = after;
    this.last = word;
    this.asked++;
    return { word, correct, stageBefore: before, stageAfter: after, slot };
  }

  // "I don't know": not scored as a miss (that's the log's business), but the
  // word is re-drilled exactly as if it were missed.
  dontKnow() { return this.answer(false); }

  toJSON() {
    return { active: this.active, done: this.done, stages: this.stages, mastered: [...this.mastered],
             asked: this.asked, last: this.last };
  }

  static fromJSON(d) {
    const words = Object.keys(d.stages);
    const q = new StudyQueue(words);
    Object.assign(q.stages, d.stages);
    q.mastered = new Set(d.mastered);
    q.asked = d.asked;
    q.last = d.last ?? null;
    if (d.active) {
      q.active = d.active.map((w) => w ?? SPACER);
      q.done = d.done;
    } else { // saved by the older engine, which kept one list of every word
      q.active = d.queue.filter((w) => q.stages[w] !== Stage.LEARNED);
      q.done = d.queue.filter((w) => q.stages[w] === Stage.LEARNED);
    }
    return q;
  }
}

Object.assign(WB, { MISS_SLOT, RECOVER_SLOT, REVIEW_SLOT, Stage, StudyQueue });
})();
