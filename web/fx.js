// Sound and visual effects. Tone.js and GSAP are loaded as globals in index.html.
import confetti from "./vendor/confetti.module.js";

const Tone = window.Tone;
const gsap = window.gsap;

let muted = false;
try { muted = localStorage.getItem("muted") === "1"; } catch {}

export function isMuted() { return muted; }
export function setMuted(m) {
  muted = m;
  try { localStorage.setItem("muted", m ? "1" : "0"); } catch {}
}

// The ka-ching is a real antique register (CC0, see sounds/README.md), decoded
// up front so the first correct answer already has it. If it fails to load,
// we fall back to the synthesized register below.
const kachingBuffer = Tone ? new Tone.ToneAudioBuffer("sounds/kaching.wav") : null;

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
  synths = { out, register, buzzA, buzzB };
  return synths;
}

async function ready() {
  if (muted || !Tone) return null;
  await Tone.start();
  return getSynths();
}

export async function kaching() {
  const s = await ready();
  if (!s) return;
  const t = Tone.now() + 0.01;
  if (kachingBuffer?.loaded) {
    // A fresh player each time, so quick answers can overlap instead of cutting off.
    const p = new Tone.Player(kachingBuffer).connect(s.out);
    p.onstop = () => p.dispose();
    p.start(t);
  } else {
    s.register(t);
  }
}

export async function buzzer() {
  const s = await ready();
  if (!s) return;
  const t = Tone.now() + 0.01;
  s.buzzA.triggerAttackRelease(110, 0.55, t);
  s.buzzB.triggerAttackRelease(116.5, 0.55, t);
}

// Fly a dollar bill with the word from `fromEl` into `toEl`.
export function flyBill(word, fromEl, toEl, onLanded) {
  if (!gsap || !fromEl || !toEl) { onLanded?.(); return; }
  const bill = document.createElement("div");
  bill.className = "bill flying";
  bill.innerHTML = `<span class="corner tl">1</span><span class="corner br">1</span>
    <span class="seal">$</span><span class="bill-word"></span>`;
  bill.querySelector(".bill-word").textContent = word;
  document.body.appendChild(bill);

  const a = fromEl.getBoundingClientRect();
  const b = toEl.getBoundingClientRect();
  const w = bill.offsetWidth, h = bill.offsetHeight;
  const x0 = a.left + a.width / 2 - w / 2, y0 = a.top + a.height / 2 - h / 2;
  const x1 = b.left + b.width / 2 - w / 2, y1 = b.top + b.height / 2 - h / 2;

  gsap.timeline({
    onComplete() {
      bill.remove();
      gsap.fromTo(toEl, { scale: 1.12 }, { scale: 1, duration: 0.45, ease: "elastic.out(1, 0.4)" });
      onLanded?.();
    },
  })
    .set(bill, { x: x0, y: y0, scale: 0.2, rotation: -25, opacity: 0 })
    .to(bill, { scale: 1.15, rotation: 4, opacity: 1, duration: 0.35, ease: "back.out(2)" })
    .to(bill, { scale: 1, rotation: 0, duration: 0.15 })
    .to(bill, {
      x: x1, y: y1, scale: 0.25, rotation: 540, opacity: 0.85,
      duration: 0.7, ease: "power2.in",
    }, "+=0.25");
}

// Pop a big red X over `el` and shake it.
export function redX(el) {
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

export function celebrate() {
  const end = Date.now() + 1200;
  (function frame() {
    confetti({ particleCount: 6, angle: 60, spread: 60, origin: { x: 0 }, colors: ["#2e7d32", "#c9a227", "#ffffff"] });
    confetti({ particleCount: 6, angle: 120, spread: 60, origin: { x: 1 }, colors: ["#2e7d32", "#c9a227", "#ffffff"] });
    if (Date.now() < end) requestAnimationFrame(frame);
  })();
}
