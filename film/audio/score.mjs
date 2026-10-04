// FALL IN — original score and sound design, synthesised offline.
// Key: D minor, resolving to D major. Structure: intro (0–13) → build (13–76) →
// peak (76–98, through one second of silence at the closest point) → resolve (98–108).
// Hit points come from film/src/timeline.js so picture and sound share one clock.
import {
  SR, Stereo, sec, mtof, note, rng, automation, asr, saw, sine, noise, pink, brown,
  filt, svf, softClip, convolveStereo, makeIR,
} from './dsp.mjs';
import { DURATION, HITS, heartbeatTimes, smootherstep } from '../src/timeline.js';
import { geometry, RAY_DRAW, PHOTON_MAIN, PLUNGE } from '../src/overlay.js';

const N = Math.round(DURATION * SR);
const PANEL_T0 = { rays: 15.4, photon: 33.0, isco: 49.2 };

// ---------------------------------------------------------------- instruments
// Detuned saw ensemble note (pad / strings): returns stereo buffer of length n
function ensembleNote(midi, dur, { voices = 6, detune = 11, attack = 1.4, release = 2.2, vib = 0, vibRate = 5, seed = 1, spread = 0.85, bright = 1 } = {}) {
  const n = sec(dur + release);
  const out = new Stereo(n);
  const r = rng(seed * 7919 + midi * 31);
  const f0 = mtof(midi);
  for (let v = 0; v < voices; v++) {
    const cents = ((v / (voices - 1)) * 2 - 1) * detune + (r() - 0.5) * 3;
    const drift = 0.0012 * (r() - 0.5);
    const lfoPh = r() * Math.PI * 2, lfoRate = 0.08 + r() * 0.2;
    const freq = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const vibr = vib > 0 ? vib * Math.sin(2 * Math.PI * vibRate * t + lfoPh) * smootherstep(0.3, 1.5, t) : 0;
      freq[i] = f0 * Math.pow(2, (cents + vibr + 4 * Math.sin(2 * Math.PI * lfoRate * t + lfoPh)) / 1200) * (1 + drift);
    }
    const osc = saw(n, freq, r());
    const pan = ((v / (voices - 1)) * 2 - 1) * spread;
    out.addMono(osc, 0, 1 / voices, pan);
  }
  const env = asr(n, attack, release);
  for (let i = 0; i < n; i++) { out.L[i] *= env[i]; out.R[i] *= env[i]; }
  // per-note gentle low-pass so high notes don't get harsh
  const fc = Math.min(9000, f0 * 6 * bright + 400);
  out.L = filt(out.L, 'lp', fc, 0.5); out.R = filt(out.R, 'lp', fc, 0.5);
  return out;
}

// FM "glass" bell for the motif
function glass(midi, dur = 4.0, { index = 2.0, ratio = 3.5, decay = 2.4, seed = 3 } = {}) {
  const n = sec(dur);
  const out = new Stereo(n);
  const f = mtof(midi);
  const r = rng(seed + midi);
  for (const [detune, pan] of [[-0.0012, -0.35], [0.0012, 0.35]]) {
    const buf = new Float32Array(n);
    let pc = r(), pm = r(), p2 = r();
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const I = index * Math.exp(-t / 0.5) + 0.15;
      const amp = (1 - Math.exp(-t / 0.006)) * Math.exp(-t / decay);
      const m = Math.sin(2 * Math.PI * pm) * I;
      buf[i] = amp * (Math.sin(2 * Math.PI * pc + m) + 0.25 * Math.exp(-t / 0.4) * Math.sin(2 * Math.PI * p2));
      pc += (f * (1 + detune)) / SR; pm += (f * ratio) / SR; p2 += (f * 4.01) / SR;
      pc -= Math.floor(pc); pm -= Math.floor(pm); p2 -= Math.floor(p2);
    }
    out.addMono(buf, 0, 0.5, pan);
  }
  return out;
}

// heartbeat "lub-dub"
function heartbeat(gain = 1) {
  const n = sec(0.9);
  const buf = new Float32Array(n);
  const thump = (start, g, f1) => {
    let p = 0;
    for (let i = 0; i < n - start; i++) {
      const t = i / SR;
      const f = f1 + 70 * Math.exp(-t / 0.025);
      const a = (1 - Math.exp(-t / 0.004)) * Math.exp(-t / 0.11) * g;
      buf[start + i] += Math.sin(2 * Math.PI * p) * a;
      p += f / SR;
    }
  };
  thump(0, 1.0, 46);
  thump(sec(0.27), 0.62, 52);
  // a soft knock an octave up so the pulse reads on small speakers
  for (const [st, g] of [[0, 0.35], [sec(0.27), 0.22]]) {
    for (let i = 0; i < sec(0.12) && st + i < n; i++) { const t = i / SR; buf[st + i] += g * Math.sin(2 * Math.PI * 98 * t) * Math.exp(-t / 0.035) * (1 - Math.exp(-t / 0.002)); }
  }
  const click = filt(noise(n, 99), 'lp', 900, 0.7);
  for (let i = 0; i < sec(0.02); i++) buf[i] += click[i] * 0.08 * Math.exp(-i / sec(0.004));
  const out = filt(buf, 'lp', 420, 0.7);
  softClip(out, 1.6);
  for (let i = 0; i < n; i++) out[i] *= gain;
  return out;
}

// deep cinematic boom: falling sub + noise body
function boom(gain = 1, { f0 = 58, f1 = 27, len = 4.5, seed = 5 } = {}) {
  const n = sec(len);
  const buf = new Float32Array(n);
  let p = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = f1 + (f0 - f1) * Math.exp(-t / 0.35);
    buf[i] = Math.sin(2 * Math.PI * p) * (1 - Math.exp(-t / 0.005)) * Math.exp(-t / 1.4);
    p += f / SR;
  }
  const body = filt(filt(noise(n, seed), 'lp', 220, 0.7), 'lp', 220, 0.7);
  for (let i = 0; i < n; i++) buf[i] += body[i] * 1.6 * Math.exp(-i / sec(0.35));
  softClip(buf, 1.6);
  for (let i = 0; i < n; i++) buf[i] *= gain;
  return buf;
}

// filtered-noise rise or pass (band centre and pan automated)
function whoosh(len, fFrom, fTo, { q = 1.2, shape = 'rise', seed = 11 } = {}) {
  const n = sec(len);
  const src = pink(n, seed);
  const fc = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = i / n; fc[i] = fFrom * Math.pow(fTo / fFrom, shape === 'pass' ? smootherstep(0, 1, x) : x * x); }
  const y = svf(src, fc, q / 3, 'bp');
  for (let i = 0; i < n; i++) {
    const x = i / n;
    const env = shape === 'rise' ? Math.pow(x, 2.2) : Math.sin(Math.PI * x) ** 2;
    y[i] *= env * 2.5;
  }
  return y;
}

function tick(gain = 1) {
  const n = sec(0.25);
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    b[i] = gain * (Math.sin(2 * Math.PI * 2350 * t) * Math.exp(-t / 0.018) + 0.4 * Math.sin(2 * Math.PI * 4710 * t) * Math.exp(-t / 0.008));
  }
  return b;
}

// ---------------------------------------------------------------- score data
const CHORDS = [
  { t: 7.0, d: 6.4, n: ['D3', 'A3', 'E4', 'F4'], v: 0.75 },
  // gravity bends light
  { t: 13.0, d: 4.6, n: ['D2', 'A2', 'F3', 'C4', 'E4'] },
  { t: 17.0, d: 4.6, n: ['Bb1', 'F2', 'D3', 'A3', 'C4'] },
  { t: 21.0, d: 4.6, n: ['G1', 'D2', 'Bb2', 'F3', 'A3'] },
  { t: 25.0, d: 2.6, n: ['A1', 'E2', 'A2', 'D3', 'E3'] },
  { t: 27.0, d: 3.6, n: ['A1', 'E2', 'A2', 'C#3', 'E3'] },
  // photon sphere
  { t: 30.0, d: 4.6, n: ['F2', 'C3', 'D3', 'A3', 'E4'] },
  { t: 34.0, d: 4.6, n: ['Bb1', 'F2', 'C3', 'D3', 'F3'] },
  { t: 38.0, d: 4.6, n: ['A1', 'E2', 'F3', 'C4', 'E4'] },
  { t: 42.0, d: 2.6, n: ['G1', 'D2', 'Bb2', 'A3'] },
  { t: 44.0, d: 2.6, n: ['A1', 'E2', 'G2', 'D3'] },
  // innermost stable orbit: darker, lower
  { t: 46.0, d: 4.6, n: ['D1', 'D2', 'G2', 'Bb2', 'D3'] },
  { t: 50.0, d: 4.6, n: ['D1', 'D2', 'Eb3', 'G3', 'Bb3'] },
  { t: 54.0, d: 4.2, n: ['D1', 'D2', 'A2', 'D3', 'F3'] },
  { t: 57.8, d: 2.8, n: ['A1', 'E2', 'D3', 'E3'] },
  // doppler: F major colour
  { t: 60.0, d: 4.6, n: ['F1', 'C2', 'A2', 'C3', 'G3'] },
  { t: 64.0, d: 4.6, n: ['E1', 'C2', 'G2', 'E3', 'G3'] },
  { t: 68.0, d: 4.6, n: ['Bb1', 'F2', 'C3', 'D3', 'F3'] },
  { t: 72.0, d: 2.6, n: ['A1', 'F2', 'C3', 'A3'] },
  { t: 74.0, d: 2.6, n: ['A1', 'E2', 'C#3', 'A3'] },
  // the dive: tension
  { t: 76.0, d: 10.0, n: ['D1', 'D2', 'A2', 'Eb3'], attack: 3.0 },
  // swell after the silence
  { t: 87.0, d: 3.6, n: ['Bb1', 'F2', 'D3', 'A3', 'C4', 'F4'], attack: 0.7, v: 1.15 },
  { t: 90.0, d: 3.6, n: ['G1', 'D2', 'Bb2', 'F3', 'A3', 'D4'] },
  { t: 93.0, d: 2.6, n: ['A1', 'F2', 'C3', 'A3', 'C4'] },
  { t: 95.2, d: 3.2, n: ['Bb1', 'F2', 'A2', 'D3', 'F3'] },
  { t: 98.0, d: 2.4, n: ['A1', 'E2', 'A2', 'D3', 'E3'] },
  { t: 100.0, d: 2.4, n: ['A1', 'E2', 'C#3', 'E3', 'A3'] },
  { t: 102.0, d: 1.6, n: ['A1', 'E2', 'A2', 'D3'] },
  { t: 103.5, d: 1.6, n: ['A1', 'E2', 'C#3', 'G3'] },
  { t: 105.0, d: 3.0, n: ['D2', 'A2', 'F#3', 'E4', 'A4'], release: 2.5 },
];
// original motif: D–A–B♭–F–E (rising fifth, step, fall, step)
const MOTIF = ['D', 'A', 'Bb', 'F', 'E'];
const MOTIF_RHYTHM = [0, 2, 3, 4, 5];
const STRINGS = [
  { t: 76.0, d: 3.2, n: 'A4' }, { t: 79.0, d: 3.2, n: 'Bb4' }, { t: 82.0, d: 2.7, n: 'B4' }, { t: 84.5, d: 1.5, n: 'C5' },
  { t: 87.0, d: 3.2, n: 'F4' }, { t: 87.0, d: 3.2, n: 'D5' },
  { t: 90.0, d: 3.2, n: 'D4' }, { t: 90.0, d: 3.2, n: 'Bb4' },
  { t: 93.0, d: 2.4, n: 'C5' }, { t: 95.2, d: 2.9, n: 'D5' }, { t: 98.0, d: 2.2, n: 'E5' }, { t: 100.0, d: 3.6, n: 'C#5' },
  { t: 103.5, d: 1.6, n: 'G4' }, { t: 105.0, d: 2.6, n: 'F#4' },
];

// ---------------------------------------------------------------- render
export function renderScore({ log = console.log, buses = false } = {}) {
  const pads = new Stereo(N), glassBus = new Stereo(N), strings = new Stereo(N);
  const drone = new Stereo(N), pulse = new Stereo(N), sfx = new Stereo(N);
  const send = new Float32Array(N); // mono reverb send
  const addSend = (st, start, g) => {
    const s0 = Math.max(0, start), s1 = Math.min(N, start + st.n);
    for (let i = s0; i < s1; i++) send[i] += (st.L[i - start] + st.R[i - start]) * 0.5 * g;
  };
  const addSendMono = (buf, start, g) => {
    const s0 = Math.max(0, start), s1 = Math.min(N, start + buf.length);
    for (let i = s0; i < s1; i++) send[i] += buf[i - start] * g;
  };

  // --- drone: D1 sub + D2 with a slow breathing filter
  log('drone');
  {
    const f = mtof(note('D1'));
    const sub = sine(N, f);
    const oct = sine(N, 2 * f, 0.25);
    const grit = filt(filt(saw(N, 2 * f * 1.002), 'lp', 140, 0.7), 'lp', 140, 0.7);
    // upper harmonics so the drone is still felt on small speakers
    const body = filt(filt(saw(N, 4 * f * 0.999, 0.4), 'lp', 330, 0.6), 'hp', 90, 0.7);
    const g = automation([[0, 0], [4.5, 0.75], [13, 0.8], [46, 0.9], [60, 0.8], [76, 0.85], [85.9, 1.25], [86, 1.25], [87, 1.3], [90, 1.0], [104, 0.8], [108, 0]], N);
    for (let i = 0; i < N; i++) {
      const t = i / SR;
      const breathe = 1 + 0.12 * Math.sin(2 * Math.PI * 0.071 * t) + 0.06 * Math.sin(2 * Math.PI * 0.023 * t + 1);
      const v = (sub[i] * 0.9 + oct[i] * 0.22 + grit[i] * 0.35 + body[i] * 0.16) * g[i] * breathe * 0.15;
      drone.L[i] += v; drone.R[i] += v;
    }
    addSend(drone, 0, 0.04);
  }

  // --- pads
  log('pads');
  CHORDS.forEach((c, ci) => {
    const att = c.attack ?? 1.4, rel = c.release ?? 2.2;
    c.n.forEach((nm, k) => {
      const midi = note(nm);
      const lowN = midi < 40;
      const st = ensembleNote(midi, c.d, { voices: lowN ? 4 : 6, detune: lowN ? 5 : 11, attack: att, release: rel, seed: ci * 13 + k, spread: lowN ? 0.2 : 0.85 });
      pads.addStereo(st, sec(c.t), (c.v ?? 1) * (lowN ? 0.42 : 0.42));
    });
  });
  {
    const cutoff = automation([[0, 400], [7, 520], [13, 650], [25, 1150], [30, 900], [42, 1350], [46, 480], [58, 750], [60, 1050], [66, 1050], [68.2, 700], [71.4, 760], [73.8, 1500], [76, 650], [85.9, 2800], [87, 950], [88.6, 3200], [95, 2300], [100, 2600], [105, 1500], [108, 700]], N);
    pads.L = svf(pads.L, cutoff, 0.18, 'lp'); pads.R = svf(pads.R, cutoff, 0.18, 'lp');
    const g = automation([[0, 0.7], [13, 0.78], [30, 0.82], [46, 0.72], [60, 0.92], [76, 0.88], [85.9, 1.15], [87, 1.0], [89, 1.35], [98, 1.2], [105, 0.95], [108, 0.9]], N);
    for (let i = 0; i < N; i++) { pads.L[i] *= g[i]; pads.R[i] *= g[i]; }
    addSend(pads, 0, 0.32);
  }

  // --- strings (tension line on the dive, then the swell)
  log('strings');
  STRINGS.forEach((s, k) => {
    const st = ensembleNote(note(s.n), s.d, { voices: 5, detune: 7, attack: s.t >= 87 && s.t < 88 ? 0.8 : 1.2, release: 1.8, vib: 9, vibRate: 5.2, seed: 200 + k, spread: 0.7, bright: 0.8 });
    const dive = s.t < 86;
    strings.addStereo(st, sec(s.t), dive ? 0.16 + 0.05 * k : 0.2);
  });
  {
    const g = automation([[0, 1], [76, 0.4], [85.95, 1.3], [86, 1.3], [87, 1], [108, 1]], N);
    for (let i = 0; i < N; i++) { strings.L[i] *= g[i]; strings.R[i] *= g[i]; }
    strings.L = filt(strings.L, 'lp', 3800, 0.6); strings.R = filt(strings.R, 'lp', 3800, 0.6);
    addSend(strings, 0, 0.45);
  }

  // --- motif on glass: title, photon sphere (octave up, softer), payoff (octaves)
  log('motif');
  const motif = (t0, octave, gain, dub = false) => {
    MOTIF.forEach((pc, i) => {
      const t = t0 + MOTIF_RHYTHM[i];
      const last = i === MOTIF.length - 1;
      const g = glass(note(pc + octave), last ? 5.5 : 3.5, { decay: last ? 3.2 : 2.2 });
      glassBus.addStereo(g, sec(t), gain);
      addSend(g, sec(t), 0.65 * gain);
      if (dub) {
        const g2 = glass(note(pc + (octave + 1)), last ? 5.5 : 3.5, { decay: last ? 3.0 : 2.0, index: 1.4 });
        glassBus.addStereo(g2, sec(t), gain * 0.55);
        addSend(g2, sec(t), 0.6 * gain * 0.55);
      }
    });
  };
  motif(HITS.title, 4, 0.34);
  motif(HITS.photon, 5, 0.17);
  motif(HITS.payoff, 4, 0.36, true);
  { const g = glass(note('D5'), 6, { decay: 3.5 }); glassBus.addStereo(g, sec(HITS.end), 0.28); addSend(g, sec(HITS.end), 0.3); }

  // --- heartbeat: the film's clock
  log('heartbeat');
  const beats = heartbeatTimes();
  beats.forEach((t) => {
    let g = 0.85;
    if (t < 7) g = 0.55 + 0.04 * t;
    else if (t >= 60 && t < 76) g = 0.75;
    else if (t >= 76) g = 0.9 + 0.025 * (t - 76);
    const hb = heartbeat(g);
    pulse.addMono(hb, sec(t), 0.72, 0);
    addSendMono(hb, sec(t), 0.1);
  });

  // --- sound effects tied to picture
  log('sfx');
  // rising air into the title, then the boom
  { const w = whoosh(HITS.title - 3.6, 260, 3000, { shape: 'rise', seed: 21 }); sfx.addMono(w, sec(3.6), 0.11, 0); addSendMono(w, sec(3.6), 0.2); }
  { const b = boom(0.95); sfx.addMono(b, sec(HITS.title), 0.62, 0); addSendMono(b, sec(HITS.title), 0.35); }
  // section hits
  for (const [t, g, f0] of [[HITS.gravity, 0.32, 60], [HITS.photon, 0.28, 64], [HITS.isco, 0.42, 50], [HITS.doppler, 0.3, 62], [HITS.end, 0.34, 56]]) {
    const b = boom(g, { f0, f1: f0 * 0.5, len: 3.5, seed: Math.round(t) });
    sfx.addMono(b, sec(t), 0.62, 0); addSendMono(b, sec(t), 0.3);
  }
  const G = geometry();
  // gravity panel: a soft tick as each ray of light reaches the camera (panel is screen-right)
  G.RAYS_GEO.rays.forEach((ray, i) => {
    const t = PANEL_T0.rays + ray.st + RAY_DRAW;
    const tk = tick(ray.kind === 'near' ? 0.5 : 0.8);
    sfx.addMono(tk, sec(t), 0.09, 0.55); addSendMono(tk, sec(t), 0.05);
  });
  // photon panel: a glassy tone that follows the circling ray around the stereo field
  {
    const main = G.PHOTON_GEO.find((r) => r.main);
    const t0 = PANEL_T0.photon + PHOTON_MAIN.st, t1 = t0 + PHOTON_MAIN.dur;
    const s0 = sec(t0 - 0.5), s1 = sec(t1 + 1.5);
    const n = s1 - s0;
    const L = new Float32Array(n), R = new Float32Array(n);
    let p1 = 0, p2 = 0, pm = 0;
    let lastPan = 0;
    for (let i = 0; i < n; i++) {
      const t = (s0 + i) / SR;
      const prog = smootherstep(t0, t1, t);
      const idx = Math.min(main.pts.length - 1, Math.floor(prog * (main.pts.length - 1)));
      const [x, y] = main.pts[idx];
      const r = Math.hypot(x, y);
      const near = Math.exp(-Math.max(0, r - 3.2) / 2.5);
      const pan = Math.max(-1, Math.min(1, x / 4));
      lastPan += (pan - lastPan) * 0.002;
      const env = near * smootherstep(t0 - 0.5, t0 + 1.0, t) * (1 - smootherstep(t1 - 0.4, t1 + 1.4, t));
      const vib = 1 + 0.003 * Math.sin(2 * Math.PI * 4.5 * t);
      const m = Math.sin(2 * Math.PI * pm) * 0.6;
      const v = (Math.sin(2 * Math.PI * p1 + m) * 0.7 + Math.sin(2 * Math.PI * p2) * 0.3) * env;
      const a = (lastPan + 1) * Math.PI / 4;
      L[i] = v * Math.cos(a); R[i] = v * Math.sin(a);
      p1 += (mtof(note('A5')) * vib) / SR; p2 += (mtof(note('E6')) * vib) / SR; pm += (mtof(note('A5')) * 2.0) / SR;
      p1 -= Math.floor(p1); p2 -= Math.floor(p2); pm -= Math.floor(pm);
    }
    const st = new Stereo(n); st.L = L; st.R = R;
    sfx.addStereo(st, s0, 0.075); addSend(st, s0, 0.5 * 0.075);
  }
  // ISCO panel: the plunging particle's orbital frequency rises as it spirals in (a chirp),
  // panned with its position; a low thump as it crosses the horizon
  {
    const pts = G.ISCO_GEO.plunge;
    const t0 = PANEL_T0.isco + PLUNGE.st, t1 = t0 + PLUNGE.dur;
    const s0 = sec(t0), s1 = sec(t1);
    const n = s1 - s0;
    const L = new Float32Array(n), R = new Float32Array(n);
    let p = 0, pan = 0;
    for (let i = 0; i < n; i++) {
      const t = (s0 + i) / SR;
      const prog = smootherstep(t0, t1, t);
      const idx = Math.min(pts.length - 1, Math.floor(prog * (pts.length - 1)));
      const [x, y] = pts[idx];
      const r = Math.max(2, Math.hypot(x, y));
      const f = 150 * Math.pow(5.8 / r, 1.5);
      pan += (Math.max(-1, Math.min(1, x / 6)) - pan) * 0.003;
      const env = smootherstep(t0, t0 + 1.5, t) * (0.4 + 0.6 * prog) * (1 - smootherstep(t1 - 0.03, t1, t));
      const v = (Math.sin(2 * Math.PI * p) + 0.3 * Math.sin(4 * Math.PI * p)) * env;
      const a = (pan + 1) * Math.PI / 4;
      L[i] = v * Math.cos(a); R[i] = v * Math.sin(a);
      p += f / SR; p -= Math.floor(p);
    }
    const st = new Stereo(n); st.L = L; st.R = R;
    sfx.addStereo(st, s0, 0.06); addSend(st, s0, 0.03);
    const b = boom(0.5, { f0: 70, f1: 30, len: 2.5, seed: 77 });
    sfx.addMono(b, s1, 0.5, 0.3); addSendMono(b, s1, 0.3);
  }
  // Doppler wipe: a pass-by that follows the divider across the screen
  for (const [ta, tb, dir] of [[66.0, 68.2, 1], [71.4, 73.8, -1]]) {
    const len = tb - ta + 0.8;
    const w = whoosh(len, dir > 0 ? 2400 : 2200, dir > 0 ? 500 : 480, { shape: 'pass', q: 2.0, seed: Math.round(ta) });
    const n = w.length;
    const st = new Stereo(n);
    for (let i = 0; i < n; i++) {
      const x = i / n;
      const pan = dir * (2 * x - 1) * 0.9;
      const a = (pan + 1) * Math.PI / 4;
      st.L[i] = w[i] * Math.cos(a); st.R[i] = w[i] * Math.sin(a);
    }
    sfx.addStereo(st, sec(ta - 0.3), 0.12); addSend(st, sec(ta - 0.3), 0.05);
  }
  // the dive: rumble building to the closest point
  {
    const s0 = sec(HITS.dive), s1 = sec(HITS.silenceStart);
    const n = s1 - s0;
    const rum = filt(filt(brown(n, 61), 'lp', 140, 0.7), 'hp', 25, 0.7);
    const air = whoosh(n / SR, 200, 4200, { shape: 'rise', seed: 62 });
    for (let i = 0; i < n; i++) {
      const x = i / n;
      rum[i] = rum[i] * (0.15 + 0.85 * x * x) * 0.9 + air[i] * 0.07;
    }
    sfx.addMono(rum, s0, 0.6, 0); addSendMono(rum, s0, 0.1);
  }
  // after the silence: a big low hit under the swell
  { const b = boom(1.0, { f0: 52, f1: 26, len: 6, seed: 87 }); sfx.addMono(b, sec(HITS.silenceEnd), 0.7, 0); addSendMono(b, sec(HITS.silenceEnd), 0.4); }
  // telescope blur: a soft shimmer
  {
    for (const [nm, dt, pan] of [['A5', 0, -0.4], ['D6', 0.12, 0.4], ['E6', 0.24, 0]]) {
      const g = glass(note(nm), 4, { index: 0.8, decay: 2.5 });
      sfx.addStereo(g, sec(HITS.blur + dt), 0.06); addSend(g, sec(HITS.blur + dt), 0.08);
    }
  }

  // --- reverb
  log('reverb');
  const [irL, irR] = makeIR({ length: 5.5, rt60: 4.4, seed: 7 });
  const [wl, wr] = convolveStereo(send, irL, irR);

  // --- mix
  log('mix');
  const mix = new Stereo(N);
  const busGain = { drone: 1.0, pads: 1.0, strings: 0.9, glass: 1.0, pulse: 1.0, sfx: 1.0, wet: 0.55 };
  for (let i = 0; i < N; i++) {
    mix.L[i] = drone.L[i] * busGain.drone + pads.L[i] * busGain.pads + strings.L[i] * busGain.strings + glassBus.L[i] + pulse.L[i] + sfx.L[i] + wl[i] * busGain.wet;
    mix.R[i] = drone.R[i] * busGain.drone + pads.R[i] * busGain.pads + strings.R[i] * busGain.strings + glassBus.R[i] + pulse.R[i] + sfx.R[i] + wr[i] * busGain.wet;
  }
  // the film's dynamic arc: intro -> build -> peak -> resolve
  const arc = automation([[0, 0.6], [7, 0.85], [12, 0.75], [13, 0.62], [29.5, 0.7], [30, 0.7], [45.5, 0.78], [46, 0.6], [59.5, 0.68], [60, 0.78], [75.5, 0.84], [76, 0.72], [85.95, 1.18], [87, 1.25], [90, 1.2], [98, 1.05], [104.8, 0.9], [108, 0.85]], N);
  for (let i = 0; i < N; i++) { mix.L[i] *= arc[i]; mix.R[i] *= arc[i]; }
  const rms = (st, a = 0, b = DURATION) => { let s = 0; const s0 = sec(a), s1 = sec(b); for (let i = s0; i < s1; i++) s += st.L[i] ** 2 + st.R[i] ** 2; return 10 * Math.log10(s / (2 * (s1 - s0)) + 1e-20); };
  log(`bus RMS dB  drone ${rms(drone).toFixed(1)}  pads ${rms(pads).toFixed(1)}  strings ${rms(strings).toFixed(1)}  glass ${rms(glassBus).toFixed(1)}  pulse ${rms(pulse).toFixed(1)}  sfx ${rms(sfx).toFixed(1)}`);
  if (buses) return { mix, drone, pads, strings, glassBus, pulse, sfx, wet: { L: wl, R: wr } };
  return mix;
}
