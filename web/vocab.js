// Word list loading, grouping, and multiple-choice question building.
(() => {
"use strict";
const WB = (globalThis.WB ||= {});

const GROUP_SIZE = 20;

// Question modes.
const WORD_TO_DEF = "word_to_def"; // show the word, pick its definition
const DEF_TO_WORD = "def_to_word"; // show the definition, pick the word
const SENTENCE = "sentence";       // show the fill-in-the-blank sentence, pick the word
const SYNONYM = "synonym";         // show the word, pick one of its listed synonyms
const ANTONYM = "antonym";         // show the word, pick one of its listed antonyms
const ANALOGY = "analogy";         // "A : B :: C : ?", one of the word's analogies; pick D
const MIXED = "mixed";
const MODES = [WORD_TO_DEF, DEF_TO_WORD, SENTENCE, SYNONYM, ANTONYM, ANALOGY, MIXED];
// Modes whose options are plain words, not necessarily in the word list.
const WORD_ANSWER_MODES = [SYNONYM, ANTONYM, ANALOGY];

// Options per question: SSAT-style A-E for definitions; picking the word from a
// definition gets a single list of 6. Sentences take 8 words, in two columns,
// mostly the target's curated look-alikes.
const N_OPTIONS = { [WORD_TO_DEF]: 5, [DEF_TO_WORD]: 6, [SENTENCE]: 8, [SYNONYM]: 5, [ANTONYM]: 5, [ANALOGY]: 5 };

// An analogy's `rule` is a sentence with {A} and {B} in it that both pairs plug into
// ("{A} is the opposite of {B}."). Fills it in, fixing "a"/"an" and the first letter.
const A_EXCEPTIONS = /^(eu|uni|unan|use|usu|one|once)/i;   // vowel letter, consonant sound: "a euphemism"
const AN_EXCEPTIONS = /^(heir|hour|honest|honor)/i;       // silent h: "an heir"
function fillRule(rule, a, b) {
  let s = rule.replace("{A}", a).replace("{B}", b);
  s = s.replace(/\b([Aa])n? (?=([\w'-]+))/g, (m, art, next) => {
    const an = AN_EXCEPTIONS.test(next) || (/^[aeiou]/i.test(next) && !A_EXCEPTIONS.test(next));
    return `${art}${an ? "n" : ""} `;
  });
  return s[0].toUpperCase() + s.slice(1);
}

// Small seedable PRNG (mulberry32) so tests are repeatable. Returns floats in [0, 1).
function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rng = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const lower = (s) => s.toLowerCase();

// Parts of speech like "v./n." count as either.
const posParts = (pos) => pos.split("/").map((p) => p.trim()).filter(Boolean);

class Vocab {
  // entries: [{rank, word, pos, definition, synonyms, antonyms, distractors, sentence, explanation, nearSynonyms}]
  constructor(entries) {
    this.entries = [...entries].sort((a, b) => a.rank - b.rank);
    this.byWord = new Map(this.entries.map((e) => [lower(e.word), e]));
    this.groups = [];
    for (let i = 0; i < this.entries.length; i += GROUP_SIZE) {
      this.groups.push(this.entries.slice(i, i + GROUP_SIZE));
    }
  }

  // From the JSONL word list (ssat_vocab.jsonl, which words.js carries as text).
  static parse(jsonl) {
    const entries = jsonl.split("\n").filter((l) => l.trim()).map((l) => {
      const d = JSON.parse(l);
      return {
        rank: d.rank,
        word: d.word.trim(),
        pos: d.pos || "",
        definition: d.definition.trim(),
        synonyms: d.synonyms || [],
        antonyms: d.antonyms || [],
        distractors: d.distractors || [],
        sentence: d.sentence || "", // fill-in-the-blank; "___" marks the word
        explanation: d.explanation || "", // where the word comes from, and a way to remember it
        // Words close enough in meaning that either could fairly be called right, so they're
        // never offered together. Listed on both words. (Words sharing a listed synonym, or a
        // definition, are kept apart automatically.)
        nearSynonyms: d.near_synonyms || [],
        // [{terms: [A, B, C, D], pos (of D), relation, rule, distractors, difficulty 1-5}]:
        // "A is to B as C is to D". The quiz shows A, B, C and asks for D.
        analogies: d.analogies || [],
      };
    });
    return new Vocab(entries);
  }

  get(word) { return this.byWord.get(lower(word)); }

  // 1-indexed group.
  group(n) {
    if (!(n >= 1 && n <= this.groups.length)) throw new RangeError(`no group ${n}`);
    return this.groups[n - 1];
  }

  groupOf(entry) { return Math.floor((entry.rank - 1) / GROUP_SIZE) + 1; }

  // Would `otherWord` also be a correct answer for `target`?
  tooClose(target, otherWord) {
    const w = lower(otherWord);
    const t = lower(target.word);
    if (w === t) return true;
    const targetSyns = new Set(target.synonyms.map(lower));
    if (targetSyns.has(w)) return true;
    if (target.nearSynonyms?.some((n) => lower(n) === w)) return true;
    const other = this.get(w);
    if (!other) return false;
    if (other.nearSynonyms?.some((n) => lower(n) === t)) return true;
    if (lower(other.definition) === lower(target.definition)) return true;
    const otherSyns = other.synonyms.map(lower);
    return otherSyns.includes(t) || otherSyns.some((s) => targetSyns.has(s));
  }

  // Could `word` grammatically fill the blank meant for `target`? Words not in
  // the list (some distractors) have no known part of speech, so they pass.
  samePos(target, word) {
    const other = this.get(word);
    if (!other || !target.pos || !other.pos) return true;
    const want = posParts(target.pos);
    return posParts(other.pos).some((p) => want.includes(p));
  }

  // Could `word` (a part of speech) fill a slot that wants `pos`? Unknown words pass.
  fitsPos(pos, word) {
    const other = this.get(word);
    if (!other || !pos || !other.pos) return true;
    const want = posParts(pos);
    return posParts(other.pos).some((p) => want.includes(p));
  }

  // Would `w` also be a right answer when `answer` (a synonym, antonym, or analogy's last
  // word, maybe not in the list) is? Same word, listed synonyms either way, near-synonyms.
  sameAsWord(answer, w) {
    const a = lower(answer), x = lower(w);
    if (a === x) return true;
    const ae = this.get(a), xe = this.get(x);
    if (ae && this.tooClose(ae, x)) return true;
    if (xe && (xe.synonyms.map(lower).includes(a) || this.tooClose(xe, a))) return true;
    return false;
  }

  // Is `w` an opposite of `target`? (Listed either way, or through each other's synonyms.)
  isAntonym(target, w) {
    const x = lower(w), t = lower(target.word);
    const ants = target.antonyms.map(lower), syns = target.synonyms.map(lower);
    if (ants.includes(x)) return true;
    const xe = this.get(x);
    if (!xe) return false;
    const xAnts = xe.antonyms.map(lower), xSyns = xe.synonyms.map(lower);
    return xAnts.includes(t) || xAnts.some((a) => syns.includes(a)) || xSyns.some((s) => ants.includes(s)) ||
           ants.some((a) => this.sameAsWord(a, x));
  }

  // Synonym, antonym, and analogy questions: the answer is a word picked from the target's
  // own data, and the wrong words are curated (`curated`: [[words, how many], ...]), then
  // random words from `pool`, none of which could also be right (`bad`).
  buildWordQuestion(target, mode, answer, curated, bad, pos, rng, pool, extra) {
    const nWrong = N_OPTIONS[mode] - 1;
    const wrong = [];
    const seen = new Set([lower(answer)]);
    const take = (words, limit = nWrong) => {
      let added = 0;
      for (const w of words) {
        if (wrong.length >= nWrong || added >= limit) return;
        if (seen.has(lower(w)) || bad(w)) continue;
        seen.add(lower(w));
        wrong.push(w);
        added++;
      }
    };
    const words = (entries) => shuffle(entries.map((e) => e.word), rng);
    const fits = (w) => this.fitsPos(pos, w);
    for (const [list, n] of curated) take(shuffle([...list], rng), n);
    take(words(pool || this.entries).filter(fits));
    if (wrong.length < nWrong) {
      take(shuffle(curated.flatMap(([list]) => list), rng));
      take(words(this.entries).filter(fits));
      take(words(this.entries));
    }
    const optionWords = shuffle([answer, ...wrong], rng);
    return { mode, word: target.word, pos: target.pos, options: optionWords, optionWords,
             answerIndex: optionWords.indexOf(answer), answerWord: answer, ...extra };
  }

  // Build a multiple-choice question.
  //
  // About half the wrong answers come from the target's curated distractors and
  // the rest are random words from `pool` (the study group, falling back to the
  // whole list). In WORD_TO_DEF mode only distractors that are themselves in the
  // word list can be used, since we need their definitions. In SENTENCE mode a
  // wrong word must be the same part of speech when we know it, so grammar
  // alone doesn't give the answer away.
  //
  // MIXED picks any type the word has: Word→Meaning, Meaning→Word, Synonyms, Antonyms
  // (if it has antonyms), and, except on a word's first try (`firstTry`), Fill the blank
  // and Analogies: those are harder, context-only clues, so they're saved for words already seen.
  //
  // SYNONYM and ANTONYM ask for one of the target's listed synonyms (or antonyms). Of the
  // four wrong answers, one is an antonym (or a synonym: the classic trap), one a look-alike
  // from its distractors, and two are random words.
  // A word with no antonyms gets a synonym question instead. ANALOGY shows one of the word's
  // analogies with its last word missing; its curated distractors are related words that
  // don't fit the relationship (or fit it backwards), and one more option is a random word.
  buildQuestion(target, mode, rng = Math.random, pool = null, { firstTry = false } = {}) {
    if (mode === MIXED) {
      const modes = [WORD_TO_DEF, DEF_TO_WORD];
      if (target.synonyms.length) modes.push(SYNONYM);
      if (target.antonyms.length) modes.push(ANTONYM);
      if (!firstTry && target.sentence) modes.push(SENTENCE);
      if (!firstTry && target.analogies.length) modes.push(ANALOGY);
      mode = modes[Math.floor(rng() * modes.length)];
    }
    if (mode === ANTONYM && !target.antonyms.length) mode = SYNONYM;
    if (mode === ANALOGY && !target.analogies.length) mode = WORD_TO_DEF;
    const pick = (arr) => arr[Math.floor(rng() * arr.length)];
    if (mode === SYNONYM) {
      const answer = pick(target.synonyms);
      const bad = (w) => this.tooClose(target, w) || this.sameAsWord(answer, w);
      return { ...this.buildWordQuestion(target, mode, answer, [[target.antonyms, 1], [target.distractors, 1]], bad,
                                         target.pos, rng, pool), prompt: target.word };
    }
    if (mode === ANTONYM) {
      const answer = pick(target.antonyms);
      const bad = (w) => lower(w) === lower(target.word) || this.isAntonym(target, w) || this.sameAsWord(answer, w);
      return { ...this.buildWordQuestion(target, mode, answer, [[target.synonyms, 1], [target.distractors, 1]], bad,
                                         target.pos, rng, pool), prompt: target.word };
    }
    if (mode === ANALOGY) {
      const an = pick(target.analogies);
      const [a, b, c, d] = an.terms;
      const terms = new Set(an.terms.map(lower));
      const bad = (w) => terms.has(lower(w)) || this.sameAsWord(d, w);
      const q = this.buildWordQuestion(target, mode, d, [[an.distractors, N_OPTIONS[ANALOGY] - 2]], bad, an.pos, rng, pool,
                                       { analogy: { terms: [a, b, c, d], relation: an.relation, rule: an.rule,
                                                    difficulty: an.difficulty } });
      return { ...q, prompt: `${a} : ${b} :: ${c} : ?` };
    }
    const nWrong = N_OPTIONS[mode] - 1;
    const nFromDistractors = mode === SENTENCE ? Math.ceil(nWrong / 2) : Math.floor(nWrong / 2);
    const text = (w) => (mode === WORD_TO_DEF ? this.get(w).definition : w);
    const fits = mode === SENTENCE ? (w) => this.samePos(target, w) : () => true;

    let candidates = target.distractors.filter((d) => !this.tooClose(target, d) && fits(d));
    if (mode === WORD_TO_DEF) candidates = candidates.filter((d) => this.get(d));
    shuffle(candidates, rng);

    const wrong = [];
    const seenTexts = new Set([lower(text(target.word))]);
    const take = (words, limit = nWrong) => {
      let added = 0;
      for (const w of words) {
        if (wrong.length >= nWrong || added >= limit) return;
        const t = lower(text(w));
        if (seenTexts.has(t) || this.tooClose(target, w)) continue;
        seenTexts.add(t);
        wrong.push(w);
        added++;
      }
    };
    const words = (entries) => shuffle(entries.map((e) => e.word), rng);

    take(candidates, nFromDistractors);
    take(words(pool || this.entries).filter(fits));
    if (wrong.length < nWrong) { // tiny pool: top up from distractors, then everything
      take(candidates);
      take(words(this.entries).filter(fits));
      take(words(this.entries));
    }

    const optionWords = shuffle([target.word, ...wrong], rng);
    return {
      mode,
      word: target.word,
      pos: target.pos,
      prompt: { [WORD_TO_DEF]: target.word, [DEF_TO_WORD]: target.definition, [SENTENCE]: target.sentence }[mode],
      options: optionWords.map(text),
      optionWords,
      answerIndex: optionWords.indexOf(target.word),
    };
  }
}

Object.assign(WB, { GROUP_SIZE, WORD_TO_DEF, DEF_TO_WORD, SENTENCE, SYNONYM, ANTONYM, ANALOGY, MIXED, MODES,
                   WORD_ANSWER_MODES, N_OPTIONS, seededRandom, shuffle, fillRule, Vocab });
})();
