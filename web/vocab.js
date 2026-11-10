// Word list loading, grouping, and multiple-choice question building.
(() => {
"use strict";
const WB = (globalThis.WB ||= {});

const GROUP_SIZE = 20;

// Question modes.
const WORD_TO_DEF = "word_to_def"; // show the word, pick its definition
const DEF_TO_WORD = "def_to_word"; // show the definition, pick the word
const MIXED = "mixed";
const MODES = [WORD_TO_DEF, DEF_TO_WORD, MIXED];

// Options per question: SSAT-style A-E for definitions; words are short, so
// picking the word from a definition gets a 4x4 grid.
const N_OPTIONS = { [WORD_TO_DEF]: 5, [DEF_TO_WORD]: 16 };

// Near-synonyms the word list doesn't cross-reference. Never offered together,
// since either could fairly be called right. (Found by reviewing the list;
// pairs sharing a listed synonym are caught automatically.)
const NEAR_SYNONYMS = [
  ["impetuous", "rash"],
  ["coerce", "compel"],
  ["potent", "robust"],
  ["zealous", "avid"],
  ["scorn", "spurn", "rebuff"],
  ["steadfast", "staunch"],
  ["servile", "submissive", "obsequious", "sycophant"],
  ["demean", "disparage"],
  ["wary", "prudent", "circumspect"],
  ["desolate", "forlorn"],
  ["paltry", "petty"],
  ["eradicate", "obliterate"],
  ["loquacious", "garrulous"],
  ["lugubrious", "melancholy", "morose", "somber"],
  ["appease", "placate", "mollify", "pacify", "quell"],
  ["quandary", "predicament", "imbroglio", "conundrum"],
  ["conundrum", "enigma"],
  ["paucity", "dearth", "meager"],
  ["plethora", "myriad", "copious", "abundant"],
  ["candor", "candid", "veracity"],
  ["veracity", "fidelity"],
  ["fervor", "fervent", "zeal", "zealous"],
  ["propensity", "penchant"],
  ["hubris", "haughty"],
  ["benign", "innocuous", "benevolent"],
  ["brazen", "blatant", "audacious", "impudent", "insolent"],
  ["cursory", "superficial"],
  ["esoteric", "obscure"],
  ["flippant", "facetious", "frivolous"],
  ["frivolous", "trivial", "petty"],
  ["impeccable", "pristine"],
  ["ingenious", "innovative", "shrewd", "astute"],
  ["ingenuous", "naive", "gullible", "credulous"],
  ["insipid", "banal", "trite", "prosaic", "mundane"],
  ["laconic", "terse", "taciturn", "curt"],
  ["petulant", "sullen", "morose", "querulous"],
  ["poignant", "pathos", "melancholy"],
  ["precocious", "prodigy"],
  ["sanguine", "buoyant"],
  ["tenuous", "feeble"],
  ["abate", "wane", "diminish", "dwindle", "recede"],
  ["ameliorate", "alleviate", "mitigate", "rectify"],
  ["vacillate", "fluctuate", "ambivalent"],
  ["nostalgia", "yearn"],
  ["arbitrary", "haphazard", "capricious"],
  ["acquiesce", "comply", "concede"],
  ["alacrity", "zeal", "avid"],
  ["assiduous", "diligent", "conscientious"],
  ["austere", "stern", "frugal"],
  ["bombastic", "verbose"],
  ["castigate", "berate", "rebuke", "censure", "reprimand"],
  ["chicanery", "swindle"],
  ["clandestine", "covert", "surreptitious", "furtive", "stealthy"],
  ["cogent", "coherent", "lucid"],
  ["deleterious", "detrimental", "adverse", "pernicious", "noxious"],
  ["didactic", "pedantic"],
  ["diffident", "withdrawn", "reticent"],
  ["ebullient", "exuberant", "buoyant"],
  ["egregious", "flagrant", "blatant"],
  ["equivocal", "ambiguous"],
  ["exonerate", "vindicate"],
  ["inexorable", "inevitable", "implacable"],
  ["irascible", "irate"],
  ["mendacious", "devious", "perfidious"],
  ["nefarious", "malevolent"],
  ["parsimonious", "frugal", "thrifty"],
  ["pugnacious", "belligerent", "truculent"],
  ["recalcitrant", "obstinate", "defiant", "truculent"],
  ["erudite", "sage", "pedantic"],
  ["plethora", "superfluous"],
  ["ebullient", "zealous", "zeal"],
  ["assiduous", "tenacious"],
  ["oblivious", "complacent"],
  ["abate", "mitigate", "alleviate"],
  ["irascible", "petulant", "sullen", "morose"],
].map((g) => new Set(g));

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

class Vocab {
  // entries: [{rank, word, pos, definition, synonyms, antonyms, distractors}]
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
    if (NEAR_SYNONYMS.some((g) => g.has(t) && g.has(w))) return true;
    const other = this.get(w);
    if (!other) return false;
    if (lower(other.definition) === lower(target.definition)) return true;
    const otherSyns = other.synonyms.map(lower);
    return otherSyns.includes(t) || otherSyns.some((s) => targetSyns.has(s));
  }

  // Build a multiple-choice question.
  //
  // Half the wrong answers come from the target's curated distractors and half
  // are random words from `pool` (the study group, falling back to the whole
  // list). In WORD_TO_DEF mode only distractors that are themselves in the word
  // list can be used, since we need their definitions.
  buildQuestion(target, mode, rng = Math.random, pool = null) {
    if (mode === MIXED) mode = rng() < 0.5 ? WORD_TO_DEF : DEF_TO_WORD;
    const nWrong = N_OPTIONS[mode] - 1;
    const nFromDistractors = Math.floor(nWrong / 2);
    const text = (w) => (mode === WORD_TO_DEF ? this.get(w).definition : w);

    let candidates = target.distractors.filter((d) => !this.tooClose(target, d));
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

    take(candidates, nFromDistractors);
    take(shuffle((pool || this.entries).map((e) => e.word), rng));
    if (wrong.length < nWrong) { // tiny pool: top up from distractors, then everything
      take(candidates);
      take(shuffle(this.entries.map((e) => e.word), rng));
    }

    const optionWords = shuffle([target.word, ...wrong], rng);
    return {
      mode,
      word: target.word,
      pos: target.pos,
      prompt: mode === WORD_TO_DEF ? target.word : target.definition,
      options: optionWords.map(text),
      optionWords,
      answerIndex: optionWords.indexOf(target.word),
    };
  }
}

Object.assign(WB, { GROUP_SIZE, WORD_TO_DEF, DEF_TO_WORD, MIXED, MODES, N_OPTIONS, NEAR_SYNONYMS, seededRandom, shuffle, Vocab });
})();
