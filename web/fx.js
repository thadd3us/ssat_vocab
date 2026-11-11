// Sound and visual effects. Tone.js and GSAP are loaded as globals in index.html.
(() => {
"use strict";
const WB = (globalThis.WB ||= {});

const confetti = globalThis.confetti;

const Tone = window.Tone;
const gsap = window.gsap;

let muted = false;
try { muted = localStorage.getItem("muted") === "1"; } catch {}

function isMuted() { return muted; }
function setMuted(m) {
  muted = m;
  try { localStorage.setItem("muted", m ? "1" : "0"); } catch {}
}

// The ka-ching is a real antique register (CC0, see sounds/README.md), decoded
// up front so the first correct answer already has it. It comes from a data: URL
// in sounds/kaching.js, since a page opened from disk can't fetch the .wav. If it
// fails to load, we fall back to the synthesized register below.
const kachingBuffer = Tone && WB.KACHING_URL ? new Tone.ToneAudioBuffer(WB.KACHING_URL) : null;

// Synthesized fallback: an old-fashioned cash register, in three mechanical layers:
//   "ka"    the key lever: a wooden knock plus two ratchet clicks
//   "ching" a struck bell, built from real bell partial ratios, with a pair of
//           slightly detuned fundamentals so it shimmers as it rings out
//   drawer  brown-noise roll of the cash drawer, a thunk, and a coin jingle
// Built against whatever Tone context is current, so it also works in Tone.Offline.
const BELL_HZ = 1250;
const BELL_PARTIALS = [ // [ratio, dB, decay seconds]
  [1, 0, 2.2], [1.004, -3, 2.2], [2.0, -9, 1.3], [2.76, -6, 1.0], [5.4, -15, 0.5], [8.93, -22, 0.3],
];

function buildRegister(dest) {
  const knock = new Tone.MembraneSynth({
    pitchDecay: 0.015, octaves: 3,
    envelope: { attack: 0.001, decay: 0.09, sustain: 0, release: 0.02 }, volume: -10,
  }).connect(dest);
  const clickFilter = new Tone.Filter({ frequency: 3200, type: "bandpass", Q: 2 }).connect(dest);
  const click = new Tone.NoiseSynth({
    noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.02, sustain: 0 }, volume: -6,
  }).connect(clickFilter);
  const bell = BELL_PARTIALS.map(([ratio, db, decay]) => [
    ratio,
    new Tone.Synth({
      oscillator: { type: "sine" },
      envelope: { attack: 0.001, decay, sustain: 0, release: decay },
      volume: db - 12,
    }).connect(dest),
  ]);
  const rollFilter = new Tone.Filter({ frequency: 700, type: "lowpass" }).connect(dest);
  const roll = new Tone.NoiseSynth({
    noise: { type: "brown" }, envelope: { attack: 0.06, decay: 0.22, sustain: 0 }, volume: -9,
  }).connect(rollFilter);
  const coins = new Tone.MetalSynth({
    envelope: { attack: 0.001, decay: 0.07, release: 0.04 },
    harmonicity: 5.1, modulationIndex: 20, resonance: 5200, octaves: 0.8, volume: -30,
  }).connect(dest);

  return (t) => {
    knock.triggerAttackRelease("A1", 0.05, t);
    click.triggerAttackRelease(0.02, t + 0.004);
    click.triggerAttackRelease(0.02, t + 0.045);
    const tb = t + 0.07;
    for (const [ratio, synth] of bell) synth.triggerAttackRelease(BELL_HZ * ratio, 0.01, tb);
    roll.triggerAttackRelease(0.25, t + 0.2);
    knock.triggerAttackRelease("E1", 0.05, t + 0.46);
    coins.triggerAttackRelease(900, 0.05, t + 0.48);
    coins.triggerAttackRelease(1150, 0.05, t + 0.55);
    coins.triggerAttackRelease(1000, 0.05, t + 0.63);
  };
}

let synths = null;
function getSynths() {
  if (synths) return synths;
  const out = new Tone.Volume(-4).toDestination();
  const register = buildRegister(out);
  // Buzzer: two detuned saws, slightly overdriven.
  const drive = new Tone.Distortion(0.35).connect(new Tone.Filter(1800, "lowpass").connect(out));
  const buzzA = new Tone.Synth({
    oscillator: { type: "sawtooth" },
    envelope: { attack: 0.01, decay: 0, sustain: 1, release: 0.06 },
    volume: -14,
  }).connect(drive);
  const buzzB = new Tone.Synth({
    oscillator: { type: "square" },
    envelope: { attack: 0.01, decay: 0, sustain: 1, release: 0.06 },
    volume: -18,
  }).connect(drive);
  const voice = new Tone.Volume(0).toDestination();
  synths = { out, voice, register, buzzA, buzzB };
  return synths;
}

async function ready(force = false) {
  if ((muted && !force) || !Tone) return null;
  await Tone.start();
  return getSynths();
}

// Each word's pronunciation is an MP3 data: URL in sounds/pronunciations.js (made by
// scripts/make_pronunciations.mjs), decoded the first time that word comes up.
const wordBuffers = new Map();
function wordBuffer(word) {
  const url = WB.PRONUNCIATIONS?.[word];
  if (!url || !Tone) return null;
  if (!wordBuffers.has(word)) {
    const loading = Tone.ToneAudioBuffer.fromUrl(url).catch(() => {
      wordBuffers.delete(word); // try again next time
      return null;
    });
    wordBuffers.set(word, loading);
  }
  return wordBuffers.get(word);
}

// Speak `word` `delay` seconds after `t` (or as soon as it's decoded, if that's later).
async function speakAt(s, word, t, delay) {
  const buf = await wordBuffer(word);
  if (!buf) return;
  const p = new Tone.Player(buf).connect(s.voice);
  p.onstop = () => p.dispose();
  p.start(Math.max(t + delay, Tone.now() + 0.01));
}

// Words are said only after an answer, so the kid has to read them first; the sound
// effect and the word overlap. `force` plays it even when muted (the 🔊 button).
async function sayWord(word, { force = false } = {}) {
  const s = await ready(force);
  if (s) await speakAt(s, word, Tone.now(), 0.01);
}

// The ka-ching's bell rings at about 0.4 s and its drawer slams at 1.2 s; the word comes in
// right after the bell, over a quieter drawer.
const KACHING_WORD_DELAY = 0.45;
const BUZZER_WORD_DELAY = 0.3;

async function kaching(word) {
  const s = await ready();
  if (!s) return;
  const t = Tone.now() + 0.01;
  const hasWord = word && WB.PRONUNCIATIONS?.[word];
  if (kachingBuffer?.loaded) {
    // A fresh player each time, so quick answers can overlap instead of cutting off.
    const p = new Tone.Player({ url: kachingBuffer, volume: hasWord ? -6 : 0 }).connect(s.out);
    p.onstop = () => p.dispose();
    p.start(t);
  } else {
    s.register(t);
  }
  if (hasWord) await speakAt(s, word, t, KACHING_WORD_DELAY);
}

async function buzzer(word) {
  const s = await ready();
  if (!s) return;
  const t = Tone.now() + 0.01;
  s.buzzA.triggerAttackRelease(110, 0.55, t);
  s.buzzB.triggerAttackRelease(116.5, 0.55, t);
  if (word) await speakAt(s, word, t, BUZZER_WORD_DELAY);
}

// Mint an old coin (see coins.js) with the word under it at `fromEl`, then fly it into `toEl`.
function flyCoin(coin, word, fromEl, toEl, onLanded) {
  if (!gsap || !fromEl || !toEl) { onLanded?.(); return; }
  const token = document.createElement("div");
  token.className = "coin-fly";
  token.innerHTML = `<img alt=""><span class="coin-word"></span><span class="coin-name"></span>`;
  token.querySelector("img").src = coin.src;
  token.querySelector(".coin-word").textContent = word;
  token.querySelector(".coin-name").textContent = `${coin.name} · ${coin.where}, ${coin.when}`;
  document.body.appendChild(token);

  const a = fromEl.getBoundingClientRect();
  const b = toEl.getBoundingClientRect();
  const w = token.offsetWidth, h = token.offsetHeight;
  const x0 = a.left + a.width / 2 - w / 2, y0 = a.top + a.height / 2 - h / 2;
  const x1 = b.left + b.width / 2 - w / 2, y1 = b.top + b.height / 2 - h / 2;

  gsap.timeline({
    onComplete() {
      token.remove();
      gsap.fromTo(toEl, { scale: 1.12 }, { scale: 1, duration: 0.45, ease: "elastic.out(1, 0.4)" });
      onLanded?.();
    },
  })
    .set(token, { x: x0, y: y0, scale: 0.2, opacity: 0 })
    // Flip in like a tossed coin, settle, then spin into the bank.
    .to(token, { scale: 1.15, opacity: 1, duration: 0.35, ease: "back.out(2)" })
    .fromTo(token.querySelector("img"), { rotationY: -540 }, { rotationY: 0, duration: 0.5, ease: "power2.out" }, "<")
    .to(token, { scale: 1, duration: 0.15 })
    .to(token.querySelectorAll(".coin-word, .coin-name"), { opacity: 0, duration: 0.15 }, "+=0.35")
    .to(token, {
      x: x1, y: y1, scale: 0.2, rotation: 360, opacity: 0.9,
      duration: 0.6, ease: "power2.in",
    }, "<");
}

// Pop a big red X over `el` and shake it.
function redX(el) {
  if (!gsap || !el) return;
  const x = document.createElement("div");
  x.className = "red-x";
  x.textContent = "✕";
  document.body.appendChild(x);
  const r = el.getBoundingClientRect();
  gsap.timeline({ onComplete: () => x.remove() })
    .set(x, { left: r.left + r.width / 2, top: r.top + r.height / 2, xPercent: -50, yPercent: -50 })
    .fromTo(x, { scale: 3, opacity: 0, rotation: -30 }, { scale: 1, opacity: 1, rotation: 0, duration: 0.25, ease: "back.out(3)" })
    .to(x, { opacity: 0, scale: 0.8, duration: 0.4 }, "+=0.7");
  gsap.fromTo(el, { x: -10 }, { x: 0, duration: 0.5, ease: "elastic.out(1.2, 0.25)" });
}

function celebrate() {
  const end = Date.now() + 1200;
  (function frame() {
    confetti({ particleCount: 6, angle: 60, spread: 60, origin: { x: 0 }, colors: ["#2e7d32", "#c9a227", "#ffffff"] });
    confetti({ particleCount: 6, angle: 120, spread: 60, origin: { x: 1 }, colors: ["#2e7d32", "#c9a227", "#ffffff"] });
    if (Date.now() < end) requestAnimationFrame(frame);
  })();
}

WB.fx = { isMuted, setMuted, kaching, buzzer, sayWord, flyCoin, redX, celebrate };
})();
