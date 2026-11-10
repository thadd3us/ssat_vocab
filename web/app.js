import { createApp, ref, reactive, computed, onMounted, onUnmounted, nextTick, watch } from "./vendor/vue.esm-browser.prod.js";
import * as fx from "./fx.js";

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.detail || res.statusText), { status: res.status });
  return data;
}

const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

const MODE_LABELS = {
  word_to_def: "Word → Meaning",
  def_to_word: "Meaning → Word",
  mixed: "Mix it up",
};
const LETTERS = "ABCDE";

// ---------------------------------------------------------------- Start
const StartScreen = {
  props: ["groups", "users", "user"],
  emits: ["start", "update:user"],
  setup(props, { emit }) {
    const newName = ref("");
    const addingNew = ref(props.users.length === 0);
    const group = ref(store.get("group", 1));
    const mode = ref(store.get("mode", "mixed"));
    const groupStats = ref({});
    const error = ref("");

    const effectiveUser = computed(() => (addingNew.value ? newName.value.trim() : props.user));

    async function loadStats() {
      groupStats.value = {};
      const u = effectiveUser.value;
      if (!u || addingNew.value) return;
      const rows = await api(`/api/scores?user=${encodeURIComponent(u)}`).catch(() => []);
      const stats = {};
      for (const r of rows) {
        const g = (stats[r.group] ||= { seen: 0, right: 0, wrong: 0, n: 0 });
        g.n++; g.right += r.right; g.wrong += r.wrong;
        if (r.right + r.wrong) g.seen++;
      }
      groupStats.value = stats;
    }
    watch(() => props.user, loadStats, { immediate: true });

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
      emit("start", { user: u, group: group.value, mode: mode.value, onError: (m) => (error.value = m) });
    }

    return { newName, addingNew, group, mode, groupStats, error, onPick, start, MODE_LABELS };
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
    const progress = ref(s.progress);
    const result = ref(null);       // answer response while showing feedback
    const picked = ref(null);
    const busy = ref(false);
    const bank = ref(0);
    const bankBills = ref([]);      // last few words banked, for the pile
    const shownAt = ref(performance.now());
    const optionEls = ref([]);
    const promptEl = ref(null);
    const bankEl = ref(null);
    const celebrated = ref(s.progress.complete);
    let advanceTimer = null;

    async function choose(i) {
      if (busy.value || result.value) return;
      busy.value = true;
      picked.value = i;
      const ms = Math.round(performance.now() - shownAt.value);
      try {
        const r = await api(`/api/sessions/${s.session_id}/answer`, {
          method: "POST",
          body: { seq: question.value.seq, choice: i, response_ms: ms },
        });
        result.value = r;
        progress.value = r.progress;
        if (r.correct) {
          fx.kaching();
          fx.flyBill(r.word, optionEls.value[i], bankEl.value, () => {
            bank.value++;
            bankBills.value = [...bankBills.value.slice(-11), r.word];
          });
          advanceTimer = setTimeout(next, 1700);
        } else {
          fx.buzzer();
          fx.redX(optionEls.value[i]);
        }
        if (r.just_completed && !celebrated.value) {
          celebrated.value = true;
          setTimeout(fx.celebrate, 600);
        }
      } catch (e) {
        if (e.status === 404) emit("end", null);
        else alert(e.message);
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

    async function end() {
      clearTimeout(advanceTimer);
      const p = await api(`/api/sessions/${s.session_id}/end`, { method: "POST" }).catch(() => progress.value);
      emit("end", { ...p, bank: bank.value });
    }

    function onKey(e) {
      if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
      // Leave Cmd-C, Ctrl-A, etc. alone; and don't let a held key answer twice.
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      if (!promptEl.value?.offsetParent) return; // Practice is hidden (Scores tab)
      if (result.value && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); next(); return; }
      const k = e.key.toUpperCase();
      let i = "12345".indexOf(k);
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

    return { s, question, progress, result, picked, bank, bankBills, optionEls, promptEl, bankEl,
             choose, next, end, optionClass, stageCounts, LETTERS, MODE_LABELS };
  },
  template: `
  <section class="practice">
    <div class="topbar">
      <div class="progress" :title="progress.mastered + ' of ' + progress.total + ' words mastered'">
        <div class="bar"><span :style="{ width: (100 * progress.mastered / progress.total) + '%' }"></span></div>
        <small>{{ progress.mastered }} / {{ progress.total }} mastered · {{ progress.right }} right · {{ progress.wrong }} missed</small>
      </div>
      <div class="bank" ref="bankEl" title="Your word bank">
        <div class="vault">🏦</div>
        <div class="amount">\${{ bank }}</div>
        <div class="pile"><span v-for="(w, i) in bankBills" :key="i" class="mini-bill" :style="{ '--i': i }"></span></div>
      </div>
    </div>

    <div v-if="progress.complete && !result" class="banner">
      🎉 All {{ progress.total }} words mastered! Keep going for review, or end the session.
    </div>

    <div class="card question" ref="promptEl">
      <div class="kind">{{ question.mode === 'word_to_def' ? 'What does this word mean?' : 'Which word means…' }}</div>
      <div class="prompt" :class="question.mode">
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

    <div v-if="result" class="feedback" :class="result.correct ? 'good' : 'bad'" @click="next">
      <div>
        <b>{{ result.word }}</b> <i>{{ result.pos }}</i> — {{ result.definition }}
        <span v-if="result.synonyms.length" class="syn">(like {{ result.synonyms.join(', ') }})</span>
      </div>
      <div v-if="!result.correct && result.chosen_word !== result.word" class="chosen">
        You picked
        <template v-if="question.mode === 'def_to_word'"><b>{{ result.chosen_word }}</b><span v-if="result.chosen_definition">, which means “{{ result.chosen_definition }}”</span>.</template>
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
  template: `
  <section class="card summary">
    <h2>Session over!</h2>
    <p class="big-num">\${{ summary.bank }} banked</p>
    <p>{{ summary.right }} right, {{ summary.wrong }} missed, {{ summary.mastered }} of {{ summary.total }} words mastered.</p>
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
    const rows = ref([]);
    const sortKey = ref("wrong");
    const onlySeen = ref(false);

    async function load() {
      if (!who.value) { rows.value = []; return; }
      const q = group.value ? `&group=${group.value}` : "";
      rows.value = await api(`/api/scores?user=${encodeURIComponent(who.value)}${q}`);
    }
    watch([who, group], load, { immediate: true });

    const acc = (r) => (r.right + r.wrong ? r.right / (r.right + r.wrong) : null);
    const sorted = computed(() => {
      const list = rows.value.filter((r) => !onlySeen.value || r.right + r.wrong > 0);
      const k = sortKey.value;
      const by = {
        rank: (a, b) => a.rank - b.rank,
        word: (a, b) => a.word.localeCompare(b.word),
        right: (a, b) => b.right - a.right || a.rank - b.rank,
        wrong: (a, b) => b.wrong - a.wrong || (acc(a) ?? 2) - (acc(b) ?? 2) || a.rank - b.rank,
        acc: (a, b) => (acc(a) ?? 2) - (acc(b) ?? 2) || b.wrong - a.wrong,
        time: (a, b) => (b.avg_ms ?? -1) - (a.avg_ms ?? -1),
      }[k];
      return [...list].sort(by);
    });
    const totals = computed(() => rows.value.reduce(
      (t, r) => ({ right: t.right + r.right, wrong: t.wrong + r.wrong, seen: t.seen + (r.right + r.wrong > 0) }),
      { right: 0, wrong: 0, seen: 0 }));

    return { who, group, sorted, sortKey, onlySeen, totals, acc };
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
    <p v-else class="muted">{{ totals.seen }} words practiced · {{ totals.right }} right · {{ totals.wrong }} missed</p>
    <table v-if="sorted.length">
      <thead><tr>
        <th @click="sortKey='rank'" class="num">#</th>
        <th @click="sortKey='word'">Word</th>
        <th @click="sortKey='right'" class="num">Right</th>
        <th @click="sortKey='wrong'" class="num">Missed</th>
        <th @click="sortKey='acc'">Accuracy</th>
        <th @click="sortKey='time'" class="num">Avg time</th>
      </tr></thead>
      <tbody>
        <tr v-for="r in sorted" :key="r.word" :class="{ unseen: !(r.right + r.wrong) }">
          <td class="num muted">{{ r.rank }}</td>
          <td><b>{{ r.word }}</b><div class="def">{{ r.definition }}</div></td>
          <td class="num good">{{ r.right || '' }}</td>
          <td class="num bad">{{ r.wrong || '' }}</td>
          <td><span v-if="acc(r) !== null" class="acc"><span :style="{ width: 100 * acc(r) + '%' }"></span></span></td>
          <td class="num muted">{{ r.avg_ms ? (r.avg_ms / 1000).toFixed(1) + 's' : '' }}</td>
        </tr>
      </tbody>
    </table>
  </section>`,
};

// ---------------------------------------------------------------- Root
createApp({
  components: { StartScreen, Practice, Summary, Scores },
  setup() {
    const tab = ref("practice");
    const groups = ref([]);
    const users = ref([]);
    const user = ref(store.get("user", ""));
    const session = ref(null);
    const summary = ref(null);
    const muted = ref(fx.isMuted());
    const loaded = ref(false);

    async function refreshUsers() {
      users.value = await api("/api/users");
      if (!users.value.includes(user.value)) user.value = users.value[0] || "";
    }

    onMounted(async () => {
      [groups.value] = await Promise.all([api("/api/groups"), refreshUsers()]);
      const sid = sessionStorage.getItem("session");
      if (sid) session.value = await api(`/api/sessions/${sid}`).catch(() => null);
      loaded.value = true;
    });

    async function start({ user: u, group, mode, onError }) {
      try {
        const s = await api("/api/sessions", { method: "POST", body: { user: u, group, mode } });
        user.value = s.user;
        store.set("user", s.user);
        sessionStorage.setItem("session", s.session_id);
        await refreshUsers();
        summary.value = null;
        session.value = s;
      } catch (e) { onError(e.message); }
    }

    function ended(p) {
      sessionStorage.removeItem("session");
      session.value = null;
      summary.value = p;
    }

    function toggleMute() { muted.value = !muted.value; fx.setMuted(muted.value); }
    watch(user, (u) => store.set("user", u));

    return { tab, groups, users, user, session, summary, muted, loaded, start, ended, toggleMute };
  },
  template: `
  <header>
    <h1>💵 Word Bank</h1>
    <nav>
      <button :class="{ active: tab === 'practice' }" @click="tab = 'practice'">Practice</button>
      <button :class="{ active: tab === 'scores' }" @click="tab = 'scores'">Scores</button>
    </nav>
    <span class="who" v-if="session">{{ session.user }} · Group {{ session.group }}</span>
    <button class="icon" @click="toggleMute" :title="muted ? 'Sound off' : 'Sound on'">{{ muted ? '🔇' : '🔊' }}</button>
  </header>
  <main v-if="loaded">
    <div v-show="tab === 'practice'">
      <Practice v-if="session" :key="session.session_id" :session="session" @end="ended" />
      <Summary v-else-if="summary" :summary="summary" @again="summary = null" @scores="tab = 'scores'" />
      <StartScreen v-else :groups="groups" :users="users" v-model:user="user" @start="start" />
    </div>
    <Scores v-if="tab === 'scores'" :users="users" :user="session ? session.user : user" :groups="groups" />
  </main>`,
}).mount("#app");
