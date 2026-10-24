// A lead II rhythm strip, drawn on a canvas for the bedside monitor.
//
// Nothing here is recorded from a patient: every rhythm is a small formula, tuned to look like
// the textbook picture a new nurse is meant to learn. A strip sweeps left to right like a real
// monitor (the new trace erases a short gap ahead of itself) and runs in real time, so it keeps
// moving while the player thinks. A state in public-cases.js picks the rhythm with `ecg`, and the
// rate with `hr`.
//
// Amplitude is in "R-wave heights": a normal R wave is 1, an S wave -0.2, and the canvas shows
// about +-1.2 around the middle.

const TAU = Math.PI * 2;
const gauss = (x, mu, sd, amp) => amp * Math.exp(-0.5 * ((x - mu) / sd) ** 2);
const sig = x => 1 / (1 + Math.exp(-x));
// cheap deterministic noise in -1..1, so a strip does not need its own random state
const hash = x => { const s = Math.sin(x * 127.1 + 311.7) * 43758.5453; return (s - Math.floor(s)) * 2 - 1; };

// One heartbeat, `tau` seconds from its R peak, `rr` seconds long. P comes before the R peak,
// so a beat is drawn from about 0.3 s before it to 0.7 s after.
const morph = {
  // normal: P wave, small Q, tall narrow R, small S, T wave that shifts later when the rate is slow
  sinus: (tau, rr) => {
    const qt = Math.min(0.26, Math.max(0.17, 0.2 * Math.sqrt(rr)));
    return gauss(tau, -0.17, 0.022, 0.13) + gauss(tau, -0.03, 0.009, -0.1) + gauss(tau, 0, 0.011, 1)
      + gauss(tau, 0.027, 0.01, -0.22) + gauss(tau, qt, 0.045, 0.3);
  },
  // atrial fibrillation: the QRS is still narrow, but no P wave comes before it
  noP: (tau, rr) => {
    const qt = Math.min(0.24, Math.max(0.14, 0.18 * Math.sqrt(rr)));
    return gauss(tau, -0.03, 0.009, -0.1) + gauss(tau, 0, 0.011, 1) + gauss(tau, 0.027, 0.01, -0.22) + gauss(tau, qt, 0.04, 0.22);
  },
  // first-degree AV block: every P is followed by a QRS, but the PR interval is long (about 0.30 s)
  avb1: (tau, rr) => {
    const qt = Math.min(0.26, Math.max(0.17, 0.2 * Math.sqrt(rr)));
    return gauss(tau, -0.31, 0.024, 0.15) + gauss(tau, -0.03, 0.009, -0.1) + gauss(tau, 0, 0.011, 1)
      + gauss(tau, 0.027, 0.01, -0.22) + gauss(tau, qt, 0.045, 0.3);
  },
  // ventricular escape beat in complete heart block: wide, with a broad, flipped T
  escape: tau => gauss(tau, 0, 0.026, 0.9) + gauss(tau, 0.05, 0.022, -0.3) + gauss(tau, 0.3, 0.08, -0.28),
  // ST elevation: the segment after the QRS rides up instead of returning to the baseline, and
  // runs into a tall T wave (the "tombstone")
  stemi: (tau, rr) => {
    const e = sig((tau - 0.04) / 0.012) - sig((tau - 0.34) / 0.045);
    return gauss(tau, -0.17, 0.022, 0.12) + gauss(tau, 0, 0.011, 0.95) + gauss(tau, 0.2, 0.07, 0.2) + 0.4 * e;
  },
};

// A rhythm is either made of beats (`morph`, and `rr` for the time to the next one) or is one
// continuous signal (`wave`). `base` is added under the beats.
const sinusRr = hr => (60 / hr) * (1 + (Math.random() - 0.5) * 0.03);
export const RHYTHMS = {
  sinus: { name: '竇性心律', morph: morph.sinus, rr: sinusRr },
  sinus_tach: { name: '竇性心搏過速', morph: morph.sinus, rr: sinusRr },
  brady: { name: '竇性心搏過緩', morph: morph.sinus, rr: sinusRr },
  // "irregularly irregular": every interval is different, and the baseline is a coarse, uneven
  // wobble (0.1 to 0.2 of an R wave), the size of each bump wandering, like the textbook strip
  af: {
    name: '心房顫動', morph: morph.noP, rr: hr => (60 / hr) * (0.5 + Math.random() * 0.95),
    base: t => {
      const env = 0.8 + 0.35 * Math.sin(TAU * 0.37 * t + 0.8);
      return env * (0.1 * Math.sin(TAU * 5.3 * t + 1.1) + 0.06 * Math.sin(TAU * 7.9 * t + 0.4 * Math.sin(t * 1.7)) + 0.045 * Math.sin(TAU * 11.3 * t))
        + 0.07 * Math.sin(TAU * 1.9 * t + 2) + 0.022 * hash(t * 55);
    },
  },
  // atrial flutter: a sawtooth baseline (about 300 a minute) with a QRS on every second or third wave.
  // Each tooth climbs sharply and falls in a long straight slope, about half an R wave tall, and
  // the baseline never goes flat between them.
  flutter: {
    name: '心房撲動', morph: morph.noP, snap: 0.2, rr: () => 0.2 * (Math.random() < 0.5 ? 2 : 3),
    base: t => { const ph = ((t / 0.2) % 1 + 1) % 1; return ph < 0.22 ? -0.2 + 0.44 * (ph / 0.22) : 0.24 - 0.44 * ((ph - 0.22) / 0.78); },
  },
  avb1: { name: '第一度房室傳導阻滯', morph: morph.avb1, rr: sinusRr },
  // complete heart block: P waves march on their own (75 a minute) and the slow QRS ignores them
  avb3: {
    name: '第三度房室傳導阻滯', morph: morph.escape, span: 6.4,
    rr: hr => (60 / hr) * (1 + (Math.random() - 0.5) * 0.02),
    base: t => { const u = ((t % 0.8) + 0.8) % 0.8; return gauss(u, 0.4, 0.024, 0.14); },
  },
  // paroxysmal supraventricular tachycardia: narrow, regular and fast, with no visible P wave
  psvt: {
    name: '陣發性上心室頻脈', rr: hr => 60 / hr,
    // very tall, narrow QRS; right after it the line drops below the baseline (ST depression), then
    // climbs back in a rounded hump before the next beat, like the textbook strip
    morph: tau => gauss(tau, -0.02, 0.008, -0.06) + gauss(tau, 0, 0.0095, 1.05) + gauss(tau, 0.02, 0.009, -0.12)
      - 0.17 * sig((tau - 0.026) / 0.007) + 0.17 * sig((tau - 0.11) / 0.022) + gauss(tau, 0.17, 0.034, 0.08),
  },
  // pulseless electrical activity: an organised strip on the monitor, and no pulse under the fingers
  pea: { name: '無脈搏電氣活動', morph: morph.sinus, rr: sinusRr },
  stemi: { name: '急性心肌梗塞（ST 段抬高）', morph: morph.stemi, rr: sinusRr },
  // ventricular tachycardia: wide, regular, fast; no separate P, QRS and T
  vt: { name: '心室頻脈', wave: (t, hr) => 0.88 * Math.tanh(1.9 * Math.sin(TAU * (hr / 60) * t)) + 0.1 * Math.sin(TAU * (hr / 30) * t + 0.5) },
  // ventricular fibrillation: chaotic, no rhythm at all, the height drifting up and down
  vf: {
    name: '心室顫動',
    wave: t => (0.34 + 0.12 * Math.sin(t * 0.9)) * Math.sin(TAU * 4.1 * t + 1.6 * Math.sin(t * 0.7))
      + 0.26 * Math.sin(TAU * 5.9 * t + 2 * Math.sin(t * 1.3)) + 0.2 * Math.sin(TAU * 2.7 * t + 3 * Math.sin(t * 0.5)) + 0.04 * hash(t * 60),
  },
  // movement, shivering, a loose electrode: a wandering baseline with high-frequency noise and
  // bursts of big, sharp swings, and no QRS you could count
  artifact: {
    name: '干擾（不是心律）',
    wave: t => {
      const burst = Math.max(0, Math.sin(TAU * t / 1.37 + 0.7)) ** 6 + 0.8 * Math.max(0, Math.sin(TAU * t / 0.83 + 2.1)) ** 8;
      return 0.38 * Math.sin(TAU * 0.45 * t) + 0.2 * hash(t * 70) + 0.16 * Math.sin(TAU * 23 * t) * (0.5 + burst)
        + burst * 0.9 * Math.sin(TAU * 7.5 * t + 1) + 0.12 * Math.sin(TAU * 41 * t + t);
    },
  },
  // a lead that has come off reads as a flat line with a little hum; the alarm calls it asystole
  leadoff: { name: '導線脫落', wave: t => 0.014 * Math.sin(TAU * 50 * t) + 0.01 * hash(t * 40) },
  asystole: { name: '心搏停止', wave: t => 0.04 * Math.sin(TAU * 0.4 * t) + 0.012 * hash(t * 25) },
};
export const RHYTHM_KEYS = Object.keys(RHYTHMS);

// The strip on one canvas. `set(rhythm, hr)` may be called as often as you like; it only
// restarts the beats when something changed. `hold(true)` freezes the trace (a paused game).
export function createEcg(cv, { span = 4.2, color = '#5bff8f' } = {}) {
  const ctx = cv.getContext('2d');
  const STEP = 1 / 240;
  let rhythm = 'sinus', hr = 70, beats = [], lastBeat = 0, held = false, raf = 0, lastNow = 0;
  let tDraw = 0, x = 0, y = null;

  const spanNow = () => RHYTHMS[rhythm].span || span;
  function reseed() {
    beats = [];
    lastBeat = tDraw + 0.25 - 60 / Math.max(20, hr);
    const snap = RHYTHMS[rhythm].snap;
    if (snap) lastBeat = Math.round(lastBeat / snap) * snap;
  }
  function sample(t) {
    const r = RHYTHMS[rhythm];
    if (r.wave) return r.wave(t, hr);
    while (lastBeat < t + 0.6) { const rr = r.rr(hr); lastBeat += rr; beats.push({ t: lastBeat, rr }); }
    while (beats.length && t - beats[0].t > 1.2) beats.shift();
    let v = r.base ? r.base(t) : 0;
    for (let i = beats.length - 1; i >= 0; i--) {
      const tau = t - beats[i].t;
      if (tau < -0.35) continue;
      if (tau > 0.8) break;
      v += r.morph(tau, beats[i].rr);
    }
    return v;
  }
  function fit() {
    const d = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(cv.clientWidth * d)), h = Math.max(1, Math.round(cv.clientHeight * d));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; x = 0; y = null; }
  }
  function frame(now) {
    raf = requestAnimationFrame(frame);
    fit();
    const dt = Math.min(0.25, Math.max(0, (now - lastNow) / 1000)); lastNow = now;
    if (held || !cv.clientWidth) return;
    const W = cv.width, H = cv.height, mid = H * 0.56, amp = H * 0.34;
    ctx.strokeStyle = color; ctx.lineWidth = Math.max(1.6, H / 55); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.shadowColor = color; ctx.shadowBlur = H / 25;
    ctx.beginPath();
    let pen = y !== null;
    if (pen) ctx.moveTo(x, y);
    const end = tDraw + dt;
    while (tDraw < end) {
      tDraw += STEP;
      const px = (tDraw / spanNow() * W) % W, py = mid - Math.max(-1.6, Math.min(1.6, sample(tDraw))) * amp;
      if (px < x) pen = false;
      if (!pen) { ctx.moveTo(px, py); pen = true; } else ctx.lineTo(px, py);
      x = px; y = py;
    }
    ctx.stroke();
    // the gap that erases the old trace just ahead of the new one
    const gap = W * 0.04;
    ctx.clearRect(x + ctx.lineWidth, 0, gap, H);
    if (x + gap > W) ctx.clearRect(0, 0, x + gap - W, H);
  }
  return {
    set(name, rate) {
      if (!RHYTHMS[name]) name = 'sinus';
      const r = rate > 0 ? rate : hr;
      if (name === rhythm && r === hr) return;
      const changed = name !== rhythm;
      rhythm = name; hr = r;
      if (changed) { reseed(); ctx.clearRect(0, 0, cv.width, cv.height); x = 0; y = null; }
    },
    start() {
      cancelAnimationFrame(raf);
      ctx.clearRect(0, 0, cv.width, cv.height);
      x = 0; y = null; lastNow = performance.now(); reseed();
      raf = requestAnimationFrame(frame);
    },
    stop() { cancelAnimationFrame(raf); raf = 0; },
    hold(on) { held = on; lastNow = performance.now(); },
    // for tests: the signal at time t, from a fresh strip
    sample,
  };
}
