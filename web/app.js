(() => {
"use strict";
const WB = (globalThis.WB ||= {});

const { createApp, ref, computed, onMounted, onUnmounted, nextTick, watch, markRaw } = Vue;
const { fx, Vocab, Log, checkSheetUrl, browserStorage: store, Session, scoreRows,
        COINS, COIN_BY_ID, COIN_SETS, COIN_SET_BY_ID, DEFAULT_COIN_SET, preloadCoins } = WB;

// The Sheet's web app URL isn't in the code. It's pasted in once (SetupScreen) and kept
// in localStorage: null = never asked, "" = this device only. A link ending in
// #sheet=<url> fills it in too, then the URL is dropped from the address bar.
const SHEET_KEY = "sheet_url";
const fromLink = new URLSearchParams(location.hash.slice(1)).get("sheet");
if (fromLink !== null) {
  store.set(SHEET_KEY, fromLink.trim());
  history.replaceState(null, "", location.pathname + location.search);
}

// Everything runs in the page; the log syncs to a Google Sheet (see log.js).
// `version` ticks whenever the log changes, so computed scores and the sync badge update.
const version = ref(0);
const log = new Log({ url: store.get(SHEET_KEY, null) || "", onChange: () => version.value++ });
let vocab = null;
window.addEventListener("online", () => log.flush());
document.addEventListener("visibilitychange", () => { if (!document.hidden) log.flush(); });

function groupList() {
  return vocab.groups.map((g, i) => ({ group: i + 1, first: g[0].word, last: g.at(-1).word,
                                       words: g.map((e) => e.word) }));
}

function saveSession(s) {
  try { sessionStorage.setItem("session", JSON.stringify(s)); } catch {}
}

const MODE_LABELS = {
  word_to_def: "Word → Meaning",
  def_to_word: "Meaning → Word",
  sentence: "Fill the blank",
  mixed: "Mix it up",
};
const LETTERS = "ABCDEFGHIJKLMNOP";
const KIND = {
  word_to_def: "What does this word mean?",
  def_to_word: "Which word means…",
  sentence: "Which word belongs in the blank?",
};

// ---------------------------------------------------------------- Setup
const SetupScreen = {
  props: ["firstTime"],
  emits: ["done"],
  setup(props, { emit }) {
    const url = ref(log.url);
    const busy = ref(false);
    const error = ref("");

    async function connect() {
      error.value = "";
      if (!url.value.trim()) { error.value = "Paste the link first."; return; }
      busy.value = true;
      try {
        await checkSheetUrl(url.value);
        save(url.value.trim());
      } catch (e) {
        error.value = e.message;
      } finally {
        busy.value = false;
      }
    }

    function save(u) {
      store.set(SHEET_KEY, u);
      log.setUrl(u);
      emit("done");
    }

    return { url, busy, error, connect, save };
  },
  template: `
  <section class="card setup">
    <h2>Connect to the Google Sheet</h2>
    <p>Scores are kept in a Google Sheet, with a tab for each student. Paste the Sheet's web app link
       (from Apps Script: <b>Deploy → Manage deployments</b>, the URL ending in <code>/exec</code>).</p>
    <p class="muted">It's saved on this device only. Anyone with the link can add to the Sheet and see scores, so treat it like a password.</p>
    <div class="row">
      <input v-model="url" type="url" placeholder="https://script.google.com/macros/s/…/exec" autocomplete="off"
             autocapitalize="off" spellcheck="false" @keydown.enter="connect" aria-label="Sheet link">
    </div>
    <p v-if="error" class="error">{{ error }}</p>
    <div class="row">
      <button class="primary" @click="connect" :disabled="busy">{{ busy ? 'Checking…' : 'Connect' }}</button>
      <button class="ghost" @click="save('')">Keep scores on this device only</button>
      <button v-if="!firstTime" class="ghost" @click="$emit('done')">Cancel</button>
    </div>
  </section>`,
};

// ---------------------------------------------------------------- Start
const StartScreen = {
  props: ["groups", "users", "user"],
  emits: ["start", "update:user"],
  setup(props, { emit }) {
    const newName = ref("");
    const addingNew = ref(props.users.length === 0);
    const group = ref(store.get("group", 1));
    const mode = ref(store.get("mode", "mixed"));
    const coinSet = ref(COIN_SET_BY_ID[store.get("coinSet")] ? store.get("coinSet") : DEFAULT_COIN_SET);
    const error = ref("");
    watch(coinSet, (id) => { store.set("coinSet", id); preloadCoins(id); });

    const effectiveUser = computed(() => (addingNew.value ? newName.value.trim() : props.user));

    const groupStats = computed(() => {
      version.value; // recompute when the log changes
      const u = effectiveUser.value;
      if (!u || addingNew.value) return {};
      const stats = {};
      for (const r of scoreRows(vocab, log.tallies(u))) {
        const g = (stats[r.group] ||= { seen: 0, right: 0, wrong: 0, n: 0 });
        g.n++; g.right += r.right; g.wrong += r.wrong;
        if (r.right + r.wrong + r.unknown) g.seen++;
      }
      return stats;
    });
    // Names can arrive from the Sheet after this screen is up.
    watch(() => props.users.length, (n, old) => { if (n && !old && !newName.value.trim()) addingNew.value = false; });

    function onPick(e) {
      if (e.target.value === "__new__") { addingNew.value = true; return; }
      addingNew.value = false;
      emit("update:user", e.target.value);
    }

    function start() {
      error.value = "";
      const u = effectiveUser.value;
      if (!u) { error.value = "Pick your name first!"; return; }
      store.set("group", group.value);
      store.set("mode", mode.value);
      emit("start", { user: u, group: group.value, mode: mode.value, coinSet: coinSet.value,
                      onError: (m) => (error.value = m) });
    }

    return { newName, addingNew, group, mode, coinSet, groupStats, error, onPick, start, MODE_LABELS, COIN_SETS };
  },
  template: `
  <section class="start card">
    <h2>Who's studying?</h2>
    <div class="row">
      <select v-if="users.length" :value="addingNew ? '__new__' : user" @change="onPick" aria-label="Your name">
        <option v-for="u in users" :key="u" :value="u">{{ u }}</option>
        <option value="__new__">+ New name…</option>
      </select>
      <input v-if="addingNew" v-model="newName" placeholder="Type your name" maxlength="24"
             @keydown.enter="start" autofocus aria-label="New name">
    </div>

    <h2>Pick a group</h2>
    <div class="groups">
      <button v-for="g in groups" :key="g.group" class="group" :class="{ selected: g.group === group }"
              @click="group = g.group" :title="g.words.join(', ')">
        <b>Group {{ g.group }}</b>
        <small>{{ g.first }} … {{ g.last }}</small>
        <span v-if="groupStats[g.group]" class="meter" :title="groupStats[g.group].seen + ' of ' + groupStats[g.group].n + ' words practiced'">
          <span :style="{ width: (100 * groupStats[g.group].seen / groupStats[g.group].n) + '%' }"></span>
        </span>
      </button>
    </div>

    <h2>How?</h2>
    <div class="modes">
      <label v-for="(label, key) in MODE_LABELS" :key="key" class="mode" :class="{ selected: mode === key }">
        <input type="radio" :value="key" v-model="mode"> {{ label }}
      </label>
    </div>

    <h2>Which coins?</h2>
    <div class="coin-sets">
      <label v-for="cs in COIN_SETS" :key="cs.id" class="coin-set" :class="{ selected: coinSet === cs.id }">
        <input type="radio" :value="cs.id" v-model="coinSet">
        <span class="fan"><img v-for="(c, i) in cs.coins.slice(0, 3)" :key="c.id" :src="c.src" alt="" :style="{ '--i': i }"></span>
        <b>{{ cs.name }}</b>
        <small>{{ cs.blurb }}</small>
      </label>
    </div>

    <p v-if="error" class="error">{{ error }}</p>
    <button class="primary big" @click="start">Start group {{ group }} →</button>
  </section>`,
};

// ---------------------------------------------------------------- Practice
const Practice = {
  props: ["session"],
  emits: ["end"],
  setup(props, { emit }) {
    const s = props.session;
    const question = ref(s.question);
    const progress = ref(s.progress());
    const result = ref(null);       // answer response while showing feedback
    const picked = ref(null);
    const busy = ref(false);
    const earned = ref([...s.earned]); // coin ids, in the order banked
    const shownAt = ref(performance.now());
    const optionEls = ref([]);
    const promptEl = ref(null);
    const bankEl = ref(null);
    const celebrated = ref(progress.value.complete);
    let advanceTimer = null;

    function choose(i) {
      if (busy.value || result.value) return;
      busy.value = true;
      picked.value = i;
      const ms = Math.round(performance.now() - shownAt.value);
      try {
        const r = s.answer(i, ms);
        saveSession(s);
        result.value = r;
        progress.value = r.progress;
        // Only now, after they've read it and answered, do they hear the word said.
        if (r.correct) {
          fx.kaching(r.word);
          const coin = r.coin; // the session banked it, so a reload mid-flight keeps it
          fx.flyCoin(coin, r.word, optionEls.value[i], bankEl.value, () => {
            earned.value = [...s.earned];
          });
          // With an explanation to read, wait for Next; otherwise move on by itself.
          if (!r.explanation) advanceTimer = setTimeout(next, 1700);
        } else if (!r.unknown) { // "I don't know" gets no buzzer: it's not a miss
          fx.buzzer(r.word);
          fx.redX(optionEls.value[i]);
        } else {
          fx.sayWord(r.word);
        }
        if (r.just_completed && !celebrated.value) {
          celebrated.value = true;
          setTimeout(fx.celebrate, 600);
        }
      } catch (e) {
        alert(e.message);
      } finally {
        busy.value = false;
      }
    }

    function next() {
      clearTimeout(advanceTimer);
      if (!result.value) return;
      question.value = result.value.next;
      result.value = null;
      picked.value = null;
      nextTick(() => {
        shownAt.value = performance.now();
        window.gsap?.from(promptEl.value, { y: 12, opacity: 0, duration: 0.25 });
      });
    }

    function sayWord() {
      if (!result.value) return;
      clearTimeout(advanceTimer); // they want to listen, so don't move on under them
      fx.sayWord(result.value.word, { force: true });
    }

    // Change question type mid-session. While feedback is showing, the question already
    // queued up behind it is the one that changes; otherwise the one on screen does.
    const mode = ref(s.mode);
    function switchMode(m) {
      if (m === s.mode || busy.value) return;
      const q = s.setMode(m);
      mode.value = m;
      store.set("mode", m); // the Start screen remembers it too
      saveSession(s);
      if (result.value) { result.value = { ...result.value, next: q }; return; }
      question.value = q;
      picked.value = null;
      nextTick(() => { shownAt.value = performance.now(); });
    }

    function end() {
      clearTimeout(advanceTimer);
      emit("end", { ...s.end(), coins: [...s.earned] });
    }

    function onKey(e) {
      if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
      // Leave Cmd-C, Ctrl-A, etc. alone; and don't let a held key answer twice.
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      if (!promptEl.value?.offsetParent) return; // Practice is hidden (Scores tab)
      if (result.value && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); next(); return; }
      const k = e.key.toUpperCase();
      if (k.length !== 1) return; // "".indexOf would match option A
      if (k === "?" || k === "/") { e.preventDefault(); choose(null); return; }
      let i = "123456789".indexOf(k);
      if (i < 0) i = LETTERS.indexOf(k);
      if (i >= 0 && i < question.value.options.length) choose(i);
    }
    onMounted(() => window.addEventListener("keydown", onKey));
    onUnmounted(() => { window.removeEventListener("keydown", onKey); clearTimeout(advanceTimer); });

    function optionClass(i) {
      if (!result.value) return {};
      return {
        right: i === result.value.answer_index,
        wrong: i === picked.value && !result.value.correct,
        dim: i !== result.value.answer_index && i !== picked.value,
      };
    }

    const stageCounts = computed(() => {
      const c = { new: 0, missed: 0, recovering: 0, review: 0, learned: 0 };
      for (const st of Object.values(progress.value.stages)) c[st]++;
      return c;
    });

    const pile = computed(() => earned.value.slice(-12).map((id) => COIN_BY_ID[id]).filter(Boolean));
    const blankParts = computed(() => {
      const [before, ...after] = question.value.prompt.split("___");
      return [before, after.join("___")];
    });

    return { s, question, progress, result, picked, earned, pile, optionEls, promptEl, bankEl, mode,
             choose, next, end, sayWord, switchMode, optionClass, stageCounts, blankParts, LETTERS, KIND, MODE_LABELS };
  },
  template: `
  <section class="practice">
    <div class="topbar">
      <div class="progress" :title="progress.mastered + ' of ' + progress.total + ' words mastered'">
        <div class="bar"><span :style="{ width: (100 * progress.mastered / progress.total) + '%' }"></span></div>
        <small>{{ progress.mastered }} / {{ progress.total }} mastered · {{ progress.right }} right · {{ progress.wrong }} missed<template v-if="progress.unknown"> · {{ progress.unknown }} didn't know</template></small>
      </div>
      <div class="bank" ref="bankEl" title="Your word bank">
        <div class="vault">🏦</div>
        <div class="amount">{{ earned.length }} <small>{{ earned.length === 1 ? 'coin' : 'coins' }}</small></div>
        <div class="pile"><img v-for="(c, i) in pile" :key="i" class="mini-coin" :src="c.src" alt="" :style="{ '--i': i }"></div>
      </div>
    </div>

    <div class="mode-switch" role="radiogroup" aria-label="Question type">
      <button v-for="(label, key) in MODE_LABELS" :key="key" role="radio" :aria-checked="mode === key"
              :class="{ selected: mode === key }" @click="switchMode(key)">{{ label }}</button>
    </div>

    <div v-if="progress.complete && !result" class="banner">
      🎉 All {{ progress.total }} words mastered! Keep going for review, or end the session.
    </div>

    <div class="card question" ref="promptEl">
      <div class="kind">{{ KIND[question.mode] }}</div>
      <div v-if="question.mode === 'sentence'" class="prompt sentence">
        {{ blankParts[0] }}<span class="blank" :class="{ filled: result }">{{ result ? result.word : '' }}</span>{{ blankParts[1] }}
      </div>
      <div v-else class="prompt" :class="question.mode">
        {{ question.prompt }}
      </div>
    </div>

    <ol class="options" :class="question.mode">
      <li v-for="(opt, i) in question.options" :key="question.seq + ':' + i">
        <button :ref="el => optionEls[i] = el" :class="optionClass(i)" @click="choose(i)" :disabled="!!result">
          <span class="letter">{{ LETTERS[i] }}</span><span class="text">{{ opt }}</span>
        </button>
      </li>
    </ol>
    <button class="idk" @click="choose(null)" :disabled="!!result" title="Shortcut: ?">🤷 I don't know</button>

    <div v-if="result" class="feedback" :class="result.correct ? 'good' : result.unknown ? 'idk' : 'bad'" @click="next">
      <div>
        <b>{{ result.word }}</b><button class="say" @click.stop="sayWord" title="Say it again" aria-label="Say it again">🔊</button>
        <i>{{ result.pos }}</i> — {{ result.definition }}
        <span v-if="result.synonyms.length" class="syn">(like {{ result.synonyms.join(', ') }})</span>
      </div>
      <div v-if="result.explanation" class="explain">💡 {{ result.explanation }}</div>
      <div v-if="result.unknown" class="chosen">That's OK. You'll see <b>{{ result.word }}</b> again in a moment.</div>
      <div v-if="!result.correct && !result.unknown && result.chosen_word !== result.word" class="chosen">
        You picked
        <template v-if="question.mode !== 'word_to_def'"><b>{{ result.chosen_word }}</b><span v-if="result.chosen_definition">, which means “{{ result.chosen_definition }}”</span>.</template>
        <template v-else>the meaning of <b>{{ result.chosen_word }}</b>.</template>
        You'll see <b>{{ result.word }}</b> again in a moment.
      </div>
      <button class="primary" @click.stop="next">{{ result.correct ? 'Next' : 'Got it' }} ⏎</button>
    </div>

    <div class="footer">
      <span class="stages" title="Where each word is in the spaced-repetition cycle">
        <span class="chip new">{{ stageCounts.new }} new</span>
        <span class="chip missed">{{ stageCounts.missed + stageCounts.recovering }} fixing</span>
        <span class="chip review">{{ stageCounts.review }} almost</span>
        <span class="chip learned">{{ stageCounts.learned }} solid</span>
      </span>
      <button class="ghost" @click="end">End session</button>
    </div>
  </section>`,
};

// ---------------------------------------------------------------- Summary
const Summary = {
  props: ["summary"],
  emits: ["again", "scores"],
  setup(props) {
    // One of each coin earned, oldest era first, with a count.
    const collection = computed(() => COINS
      .map((c) => ({ ...c, n: props.summary.coins.filter((id) => id === c.id).length }))
      .filter((c) => c.n));
    return { collection };
  },
  template: `
  <section class="card summary">
    <h2>Session over!</h2>
    <p class="big-num">{{ summary.coins.length }} {{ summary.coins.length === 1 ? 'coin' : 'coins' }} banked</p>
    <div v-if="collection.length" class="collection">
      <figure v-for="c in collection" :key="c.id" :title="c.name + ' · ' + c.where + ', ' + c.when">
        <img :src="c.src" :alt="c.name"><figcaption>{{ c.where }}<br><small>{{ c.when }}</small><b v-if="c.n > 1">×{{ c.n }}</b></figcaption>
      </figure>
    </div>
    <p>{{ summary.right }} right, {{ summary.wrong }} missed,<template v-if="summary.unknown"> {{ summary.unknown }} didn't know,</template> {{ summary.mastered }} of {{ summary.total }} words mastered.</p>
    <div class="row">
      <button class="primary" @click="$emit('again')">Study again</button>
      <button class="ghost" @click="$emit('scores')">See scores</button>
    </div>
  </section>`,
};

// ---------------------------------------------------------------- Scores
const Scores = {
  props: ["users", "user", "groups"],
  setup(props) {
    const who = ref(props.user || props.users[0] || "");
    const group = ref(store.get("group", 0));
    const coinTab = ref(COIN_SET_BY_ID[store.get("coinSet")] ? store.get("coinSet") : DEFAULT_COIN_SET);
    const sortKey = ref("wrong");
    const onlySeen = ref(false);
    // Load the student's tab whenever the table switches to them.
    watch(who, (u) => log.refresh(u), { immediate: true });
    watch(() => props.users, (us) => { if (!us.includes(who.value)) who.value = us[0] || ""; });

    const rows = computed(() => {
      version.value; // recompute when the log changes
      return who.value ? scoreRows(vocab, log.tallies(who.value), group.value) : [];
    });

    // "I don't know" isn't a miss, but it isn't right either, so it counts against accuracy.
    const tries = (r) => r.right + r.wrong + r.unknown;
    const acc = (r) => (tries(r) ? r.right / tries(r) : null);
    const sorted = computed(() => {
      const list = rows.value.filter((r) => !onlySeen.value || tries(r) > 0);
      const k = sortKey.value;
      const by = {
        rank: (a, b) => a.rank - b.rank,
        word: (a, b) => a.word.localeCompare(b.word),
        right: (a, b) => b.right - a.right || a.rank - b.rank,
        wrong: (a, b) => b.wrong - a.wrong || (acc(a) ?? 2) - (acc(b) ?? 2) || a.rank - b.rank,
        unknown: (a, b) => b.unknown - a.unknown || (acc(a) ?? 2) - (acc(b) ?? 2) || a.rank - b.rank,
        acc: (a, b) => (acc(a) ?? 2) - (acc(b) ?? 2) || b.wrong - a.wrong,
        time: (a, b) => (b.avg_ms ?? -1) - (a.avg_ms ?? -1),
      }[k];
      return [...list].sort(by);
    });
    const totals = computed(() => rows.value.reduce(
      (t, r) => ({ right: t.right + r.right, wrong: t.wrong + r.wrong, unknown: t.unknown + r.unknown,
                   seen: t.seen + (tries(r) > 0) }),
      { right: 0, wrong: 0, unknown: 0, seen: 0 }));

    // The student's coins: how many of each, by set. Counts come from the log (Sheet + unsent rows).
    const coinCounts = computed(() => { version.value; return who.value ? log.coins(who.value) : {}; });
    const coinTotal = computed(() => Object.values(coinCounts.value).reduce((a, b) => a + b, 0));
    const coinSets = computed(() => COIN_SETS.map((cs) => {
      const coins = cs.coins.map((c) => ({ ...c, n: coinCounts.value[c.id] || 0 }));
      return { ...cs, coins, found: coins.filter((c) => c.n).length,
               total: coins.reduce((a, c) => a + c.n, 0) };
    }));
    const shownSet = computed(() => coinSets.value.find((cs) => cs.id === coinTab.value) || coinSets.value[0]);

    return { who, group, sorted, sortKey, onlySeen, totals, acc, tries,
             coinTotal, coinSets, shownSet, coinTab };
  },
  template: `
  <section class="card scores">
    <div class="row filters">
      <select v-model="who" aria-label="Student">
        <option v-for="u in users" :key="u" :value="u">{{ u }}</option>
      </select>
      <select v-model.number="group" aria-label="Group">
        <option :value="0">All groups</option>
        <option v-for="g in groups" :key="g.group" :value="g.group">Group {{ g.group }}</option>
      </select>
      <label><input type="checkbox" v-model="onlySeen"> Only practiced</label>
    </div>
    <p v-if="!users.length">No one has studied yet.</p>
    <div v-else class="coin-book">
      <h3>🏦 {{ who }}'s coins: {{ coinTotal }}</h3>
      <div class="coin-tabs" role="tablist">
        <button v-for="cs in coinSets" :key="cs.id" role="tab" :aria-selected="coinTab === cs.id"
                :class="{ active: coinTab === cs.id }" @click="coinTab = cs.id">
          {{ cs.name }} <small>{{ cs.found }}/{{ cs.coins.length }} found · {{ cs.total }} banked</small>
        </button>
      </div>
      <p v-if="shownSet.id === 'fantasy'" class="muted made-up">These coins are made up, and so are their stories.</p>
      <ul class="coin-cards">
        <li v-for="c in shownSet.coins" :key="c.id" :class="{ missing: !c.n }">
          <img :src="c.src" :alt="c.name">
          <div class="coin-info">
            <b>{{ c.name }}</b> <span class="count" v-if="c.n">×{{ c.n }}</span>
            <small>{{ c.where }} · {{ c.when }}</small>
            <p class="fact">{{ c.fact }}</p>
            <small v-if="!c.n" class="muted">Not found yet</small>
          </div>
        </li>
      </ul>
    </div>
    <p v-if="users.length" class="muted">{{ totals.seen }} words practiced · {{ totals.right }} right · {{ totals.wrong }} missed · {{ totals.unknown }} didn't know</p>
    <table v-if="sorted.length">
      <thead><tr>
        <th @click="sortKey='rank'" class="num">#</th>
        <th @click="sortKey='word'">Word</th>
        <th @click="sortKey='right'" class="num">Right</th>
        <th @click="sortKey='wrong'" class="num">Missed</th>
        <th @click="sortKey='unknown'" class="num">Didn't know</th>
        <th @click="sortKey='acc'">Accuracy</th>
        <th @click="sortKey='time'" class="num">Avg time</th>
      </tr></thead>
      <tbody>
        <tr v-for="r in sorted" :key="r.word" :class="{ unseen: !tries(r) }">
          <td class="num muted">{{ r.rank }}</td>
          <td><b>{{ r.word }}</b><div class="def">{{ r.definition }}</div></td>
          <td class="num good">{{ r.right || '' }}</td>
          <td class="num bad">{{ r.wrong || '' }}</td>
          <td class="num muted">{{ r.unknown || '' }}</td>
          <td><span v-if="acc(r) !== null" class="acc"><span :style="{ width: 100 * acc(r) + '%' }"></span></span></td>
          <td class="num muted">{{ r.avg_ms ? (r.avg_ms / 1000).toFixed(1) + 's' : '' }}</td>
        </tr>
      </tbody>
    </table>
  </section>`,
};

// ---------------------------------------------------------------- Root
createApp({
  components: { SetupScreen, StartScreen, Practice, Summary, Scores },
  setup() {
    const tab = ref("practice");
    const groups = ref([]);
    const user = ref(store.get("user", ""));
    const session = ref(null);
    const summary = ref(null);
    const muted = ref(fx.isMuted());
    const loaded = ref(false);
    const loadError = ref("");
    const setup = ref(store.get(SHEET_KEY, null) === null ? "first" : ""); // "first" | "change" | ""

    const users = computed(() => { version.value; return log.users(); });
    watch(users, (us) => { if (us.length && !us.includes(user.value)) user.value = us[0]; });

    const sync = computed(() => {
      version.value;
      if (!log.syncEnabled) return { cls: "local", text: "This device only", title: "No Google Sheet connected (⚙︎ to connect one)" };
      if (log.error) return { cls: "err", text: `${log.pending} unsaved`, title: log.error };
      if (log.loading) return { cls: "busy", text: "Loading…", title: "Reading scores from the Sheet" };
      if (log.syncing || log.pending) return { cls: "busy", text: "Saving…", title: `${log.pending} rows on their way to the Sheet` };
      return { cls: "ok", text: "Saved", title: "Everything is in the Google Sheet" };
    });

    onMounted(async () => {
      preloadCoins(session.value?.coinSet || store.get("coinSet", DEFAULT_COIN_SET));
      if (!WB.WORDS_JSONL) { loadError.value = "Couldn't load the word list (words.js)."; return; }
      vocab = Vocab.parse(WB.WORDS_JSONL);
      groups.value = groupList();
      try {
        const saved = JSON.parse(sessionStorage.getItem("session") || "null");
        if (saved) session.value = markRaw(Session.fromJSON(saved, { vocab, log }));
      } catch { sessionStorage.removeItem("session"); }
      loaded.value = true;
      log.refresh(user.value);
    });

    function start({ user: u, group, mode, coinSet, onError }) {
      try {
        const s = Session.start({ vocab, log, user: u, group, mode, coinSet });
        preloadCoins(coinSet);
        user.value = s.user;
        store.set("user", s.user);
        saveSession(s);
        summary.value = null;
        session.value = markRaw(s);
      } catch (e) { onError(e.message); }
    }

    function ended(p) {
      sessionStorage.removeItem("session");
      session.value = null;
      summary.value = p;
    }

    function toggleMute() { muted.value = !muted.value; fx.setMuted(muted.value); }
    // Picking a name loads that student's tab from the Sheet.
    watch(user, (u) => { store.set("user", u); log.refresh(u); });

    function syncNow() { log.error ? log.flush() : log.refresh(user.value); }
    function setupDone() { setup.value = ""; log.refresh(user.value); }

    return { tab, groups, users, user, session, summary, muted, loaded, loadError, sync, setup,
             start, ended, toggleMute, syncNow, setupDone, logo: COIN_BY_ID.byzantine.src };
  },
  template: `
  <header>
    <h1><img class="logo" :src="logo" alt=""> Word Bank</h1>
    <nav>
      <button :class="{ active: tab === 'practice' }" @click="tab = 'practice'">Practice</button>
      <button :class="{ active: tab === 'scores' }" @click="tab = 'scores'">Scores</button>
    </nav>
    <span class="who" v-if="session">{{ session.user }} · Group {{ session.group }}</span>
    <button class="sync" :class="sync.cls" :title="sync.title" @click="syncNow">{{ sync.text }}</button>
    <button class="icon" @click="toggleMute" :title="muted ? 'Sound off' : 'Sound on'">{{ muted ? '🔇' : '🔊' }}</button>
    <button class="icon" @click="setup = setup ? '' : 'change'" title="Google Sheet link">⚙︎</button>
  </header>
  <p v-if="loadError" class="card error">{{ loadError }}</p>
  <main v-if="loaded && setup">
    <SetupScreen :first-time="setup === 'first'" @done="setupDone" />
  </main>
  <main v-else-if="loaded">
    <div v-show="tab === 'practice'">
      <Practice v-if="session" :key="session.id" :session="session" @end="ended" />
      <Summary v-else-if="summary" :summary="summary" @again="summary = null" @scores="tab = 'scores'" />
      <StartScreen v-else :groups="groups" :users="users" v-model:user="user" @start="start" />
    </div>
    <Scores v-if="tab === 'scores'" :users="users" :user="session ? session.user : user" :groups="groups" />
  </main>`,
}).mount("#app");

})();
