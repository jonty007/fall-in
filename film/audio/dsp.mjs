// Minimal offline DSP toolkit for the score. Everything is deterministic (seeded).
export const SR = 48000;

// ------------------------------------------------------------------ random
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------ buffers
export class Stereo {
  constructor(n) { this.n = n; this.L = new Float32Array(n); this.R = new Float32Array(n); }
  addMono(buf, start, gain = 1, pan = 0) {
    // equal-power pan, pan in [-1, 1]
    const a = (pan + 1) * Math.PI / 4;
    const gl = Math.cos(a) * gain, gr = Math.sin(a) * gain;
    const s0 = Math.max(0, start), s1 = Math.min(this.n, start + buf.length);
    for (let i = s0; i < s1; i++) { const v = buf[i - start]; this.L[i] += v * gl; this.R[i] += v * gr; }
  }
  addStereo(o, start = 0, gain = 1) {
    const s0 = Math.max(0, start), s1 = Math.min(this.n, start + o.n);
    for (let i = s0; i < s1; i++) { this.L[i] += o.L[i - start] * gain; this.R[i] += o.R[i - start] * gain; }
  }
  scale(g) { for (let i = 0; i < this.n; i++) { this.L[i] *= g; this.R[i] *= g; } }
}
export const sec = (t) => Math.round(t * SR);
export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const NOTE = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
export function note(name) {
  const m = name.match(/^([A-G](?:#|b)?)(-?\d)$/);
  return 12 * (Number(m[2]) + 1) + NOTE[m[1]];
}
export const dbToGain = (db) => Math.pow(10, db / 20);

// ------------------------------------------------------------------ envelopes
// piecewise-linear automation from [[t, v], ...] (seconds), sampled per sample
export function automation(points, n, start = 0) {
  const out = new Float32Array(n);
  let k = 0;
  for (let i = 0; i < n; i++) {
    const t = (start + i) / SR;
    while (k < points.length - 2 && t > points[k + 1][0]) k++;
    const [t0, v0] = points[k], [t1, v1] = points[Math.min(k + 1, points.length - 1)];
    out[i] = t <= t0 ? v0 : t >= t1 ? v1 : v0 + (v1 - v0) * ((t - t0) / (t1 - t0));
  }
  return out;
}
// smooth attack/sustain/release envelope with raised-cosine segments
export function asr(n, attack, release, curve = 1) {
  const out = new Float32Array(n);
  const a = Math.max(1, sec(attack)), r = Math.max(1, sec(release));
  for (let i = 0; i < n; i++) {
    let v = 1;
    if (i < a) v = 0.5 - 0.5 * Math.cos(Math.PI * i / a);
    if (i > n - r) v *= 0.5 - 0.5 * Math.cos(Math.PI * (n - i) / r);
    out[i] = curve === 1 ? v : Math.pow(v, curve);
  }
  return out;
}

// ------------------------------------------------------------------ oscillators
function polyblep(t, dt) {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}
// band-limited saw; freq can be a number or a Float32Array (per sample)
export function saw(n, freq, phase0 = 0) {
  const out = new Float32Array(n);
  let p = phase0;
  for (let i = 0; i < n; i++) {
    const f = typeof freq === 'number' ? freq : freq[i];
    const dt = f / SR;
    out[i] = 2 * p - 1 - polyblep(p, dt);
    p += dt; if (p >= 1) p -= 1;
  }
  return out;
}
export function sine(n, freq, phase0 = 0) {
  const out = new Float32Array(n);
  let p = phase0;
  for (let i = 0; i < n; i++) {
    const f = typeof freq === 'number' ? freq : freq[i];
    out[i] = Math.sin(2 * Math.PI * p);
    p += f / SR; if (p >= 1) p -= 1;
  }
  return out;
}
export function noise(n, seed) {
  const r = rng(seed);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = r() * 2 - 1;
  return out;
}
// pink noise (Paul Kellet's refined filter)
export function pink(n, seed) {
  const w = noise(n, seed);
  const out = new Float32Array(n);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < n; i++) {
    const x = w[i];
    b0 = 0.99886 * b0 + x * 0.0555179; b1 = 0.99332 * b1 + x * 0.0750759; b2 = 0.969 * b2 + x * 0.153852;
    b3 = 0.8665 * b3 + x * 0.3104856; b4 = 0.55 * b4 + x * 0.5329522; b5 = -0.7616 * b5 - x * 0.016898;
    out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + x * 0.5362) * 0.11;
    b6 = x * 0.115926;
  }
  return out;
}
export function brown(n, seed) {
  const w = noise(n, seed);
  const out = new Float32Array(n);
  let y = 0;
  for (let i = 0; i < n; i++) { y = (y + 0.02 * w[i]) / 1.02; out[i] = y * 3.5; }
  return out;
}

// ------------------------------------------------------------------ filters
// RBJ biquad (static)
export function biquadCoefs(type, f, q = 0.7071, gainDb = 0) {
  const w0 = 2 * Math.PI * Math.min(f, SR * 0.49) / SR;
  const cw = Math.cos(w0), sw = Math.sin(w0), alpha = sw / (2 * q), A = Math.pow(10, gainDb / 40);
  let b0, b1, b2, a0, a1, a2;
  switch (type) {
    case 'lp': b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break;
    case 'hp': b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break;
    case 'bp': b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break;
    case 'peak': b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A; break;
    case 'lowshelf': {
      const s = 2 * Math.sqrt(A) * alpha;
      b0 = A * ((A + 1) - (A - 1) * cw + s); b1 = 2 * A * ((A - 1) - (A + 1) * cw); b2 = A * ((A + 1) - (A - 1) * cw - s);
      a0 = (A + 1) + (A - 1) * cw + s; a1 = -2 * ((A - 1) + (A + 1) * cw); a2 = (A + 1) + (A - 1) * cw - s; break;
    }
    case 'highshelf': {
      const s = 2 * Math.sqrt(A) * alpha;
      b0 = A * ((A + 1) + (A - 1) * cw + s); b1 = -2 * A * ((A - 1) + (A + 1) * cw); b2 = A * ((A + 1) + (A - 1) * cw - s);
      a0 = (A + 1) - (A - 1) * cw + s; a1 = 2 * ((A - 1) - (A + 1) * cw); a2 = (A + 1) - (A - 1) * cw - s; break;
    }
    default: throw new Error(type);
  }
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}
export function biquad(x, c, inPlace = false) {
  const y = inPlace ? x : new Float32Array(x.length);
  const [b0, b1, b2, a1, a2] = c;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i];
    const yi = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = xi; y2 = y1; y1 = yi;
    y[i] = yi;
  }
  return y;
}
export const filt = (x, type, f, q, g) => biquad(x, biquadCoefs(type, f, q, g));

// Time-varying state-variable filter (Simper/Cytomic TPT). mode: 'lp' | 'bp' | 'hp'
export function svf(x, cutoff, res = 0.2, mode = 'lp') {
  const y = new Float32Array(x.length);
  let ic1 = 0, ic2 = 0;
  const k = 2 - 2 * Math.min(res, 0.98);
  for (let i = 0; i < x.length; i++) {
    const fc = typeof cutoff === 'number' ? cutoff : cutoff[i];
    const g = Math.tan(Math.PI * Math.min(fc, SR * 0.45) / SR);
    const a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2;
    const v3 = x[i] - ic2;
    const v1 = a1 * ic1 + a2 * v3;
    const v2 = ic2 + a2 * ic1 + a3 * v3;
    ic1 = 2 * v1 - ic1; ic2 = 2 * v2 - ic2;
    y[i] = mode === 'lp' ? v2 : mode === 'bp' ? v1 : x[i] - k * v1 - v2;
  }
  return y;
}

// ------------------------------------------------------------------ FFT + convolution
function fftInPlace(re, im, inverse = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (2 * Math.PI / len) * (inverse ? 1 : -1);
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      const half = len >> 1;
      for (let k = 0; k < half; k++) {
        const a = i + k, b = a + half;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}
// mono input -> stereo output convolved with a stereo IR (overlap-add)
export function convolveStereo(x, irL, irR) {
  const M = Math.max(irL.length, irR.length);
  let N = 1; while (N < 2 * M) N <<= 1;
  const B = N - M + 1;
  const spec = (ir) => { const re = new Float64Array(N), im = new Float64Array(N); re.set(ir); fftInPlace(re, im); return [re, im]; };
  const [hLr, hLi] = spec(irL), [hRr, hRi] = spec(irR);
  const outL = new Float32Array(x.length + M), outR = new Float32Array(x.length + M);
  const re = new Float64Array(N), im = new Float64Array(N), re2 = new Float64Array(N), im2 = new Float64Array(N);
  for (let s = 0; s < x.length; s += B) {
    re.fill(0); im.fill(0);
    const e = Math.min(x.length, s + B);
    for (let i = s; i < e; i++) re[i - s] = x[i];
    fftInPlace(re, im);
    for (let k = 0; k < N; k++) {
      const ar = re[k], ai = im[k];
      re2[k] = ar * hRr[k] - ai * hRi[k]; im2[k] = ar * hRi[k] + ai * hRr[k];
      re[k] = ar * hLr[k] - ai * hLi[k]; im[k] = ar * hLi[k] + ai * hLr[k];
    }
    fftInPlace(re, im, true);
    fftInPlace(re2, im2, true);
    const lim = Math.min(N, outL.length - s);
    for (let i = 0; i < lim; i++) { outL[s + i] += re[i]; outR[s + i] += re2[i]; }
  }
  return [outL.subarray(0, x.length), outR.subarray(0, x.length)];
}

// Generated reverb impulse response: early reflections + decorrelated stereo tail with
// frequency-dependent decay (highs die first), like a large dark hall.
export function makeIR({ length = 5.5, rt60 = 4.2, seed = 7, predelay = 0.025 } = {}) {
  const n = sec(length);
  const bands = [[0, 250, 1.15], [250, 1200, 1.0], [1200, 4500, 0.72], [4500, 20000, 0.45]]; // rt60 multipliers
  const make = (s) => {
    const out = new Float32Array(n);
    bands.forEach(([lo, hi, mul], bi) => {
      let w = noise(n, s * 31 + bi);
      if (lo > 0) w = filt(filt(w, 'hp', lo, 0.7071), 'hp', lo, 0.7071);
      if (hi < 20000) w = filt(filt(w, 'lp', hi, 0.7071), 'lp', hi, 0.7071);
      const tau = (rt60 * mul) / 6.91;
      for (let i = 0; i < n; i++) {
        const t = i / SR - predelay;
        if (t < 0) continue;
        const build = 1 - Math.exp(-t / 0.035);
        out[i] += w[i] * Math.exp(-t / tau) * build;
      }
    });
    // early reflections
    const r = rng(s * 977);
    for (let k = 0; k < 18; k++) {
      const t = predelay + 0.006 + r() * 0.09;
      const g = 0.6 * Math.exp(-t / 0.08) * (r() < 0.5 ? -1 : 1);
      const idx = sec(t);
      if (idx < n) out[idx] += g;
    }
    let e = 0; for (let i = 0; i < n; i++) e += out[i] * out[i];
    const g = 1 / Math.sqrt(e);
    for (let i = 0; i < n; i++) out[i] *= g;
    return out;
  };
  return [make(seed), make(seed + 1)];
}

// ------------------------------------------------------------------ dynamics
export function softClip(x, drive = 1) {
  const k = Math.tanh(drive);
  for (let i = 0; i < x.length; i++) x[i] = Math.tanh(x[i] * drive) / k;
  return x;
}
// stereo-linked RMS compressor
export function compress(st, { threshold = -18, ratio = 2, attack = 0.03, release = 0.3, makeup = 0, knee = 6 } = {}) {
  const aA = Math.exp(-1 / (attack * SR)), aR = Math.exp(-1 / (release * SR));
  const rmsA = Math.exp(-1 / (0.05 * SR));
  let ms = 0, gr = 0;
  const mk = dbToGain(makeup);
  for (let i = 0; i < st.n; i++) {
    const s = 0.5 * (st.L[i] * st.L[i] + st.R[i] * st.R[i]);
    ms = rmsA * ms + (1 - rmsA) * s;
    const lev = 10 * Math.log10(ms + 1e-12);
    let over = lev - threshold;
    let red;
    if (over <= -knee / 2) red = 0;
    else if (over >= knee / 2) red = over * (1 - 1 / ratio);
    else red = ((over + knee / 2) ** 2 / (2 * knee)) * (1 - 1 / ratio);
    gr = red > gr ? aA * gr + (1 - aA) * red : aR * gr + (1 - aR) * red;
    const g = dbToGain(-gr) * mk;
    st.L[i] *= g; st.R[i] *= g;
  }
}
// mid/side width (applied above a crossover so the low end stays mono)
export function widen(st, width = 1.3, crossover = 160) {
  const M = new Float32Array(st.n), S = new Float32Array(st.n);
  for (let i = 0; i < st.n; i++) { M[i] = 0.5 * (st.L[i] + st.R[i]); S[i] = 0.5 * (st.L[i] - st.R[i]); }
  const Slow = filt(filt(S, 'lp', crossover, 0.7071), 'lp', crossover, 0.7071);
  for (let i = 0; i < st.n; i++) {
    const s = (S[i] - Slow[i]) * width; // remove side info below the crossover, widen above
    st.L[i] = M[i] + s; st.R[i] = M[i] - s;
  }
}
