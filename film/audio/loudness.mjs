// ITU-R BS.1770-4 integrated loudness, true peak (4x oversampling) and a
// look-ahead true-peak limiter.
import { SR, biquad } from './dsp.mjs';

// K-weighting coefficients for 48 kHz (BS.1770-4, table 1 and 2)
const K1 = [1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585];
const K2 = [1.0, -2.0, 1.0, -1.99004745483398, 0.99007225036621];

export function integratedLoudness(L, R) {
  if (SR !== 48000) throw new Error('K-weighting coefficients are for 48 kHz');
  const kl = biquad(biquad(L, K1), K2), kr = biquad(biquad(R, K1), K2);
  const block = Math.round(0.4 * SR), hop = Math.round(0.1 * SR);
  const zs = [];
  for (let s = 0; s + block <= L.length; s += hop) {
    let a = 0, b = 0;
    for (let i = s; i < s + block; i++) { a += kl[i] * kl[i]; b += kr[i] * kr[i]; }
    zs.push((a + b) / block);
  }
  const lk = (z) => -0.691 + 10 * Math.log10(z + 1e-20);
  const abs = zs.filter((z) => lk(z) > -70);
  const mean = (arr) => arr.reduce((p, c) => p + c, 0) / Math.max(arr.length, 1);
  const rel = lk(mean(abs)) - 10;
  const gated = abs.filter((z) => lk(z) > rel);
  return lk(mean(gated));
}

// short-term (3 s) loudness curve, for the report
export function shortTermCurve(L, R, step = 1.0) {
  const kl = biquad(biquad(L, K1), K2), kr = biquad(biquad(R, K1), K2);
  const w = 3 * SR, out = [];
  for (let s = 0; s + w <= L.length; s += Math.round(step * SR)) {
    let a = 0;
    for (let i = s; i < s + w; i++) a += kl[i] * kl[i] + kr[i] * kr[i];
    out.push([(s + w) / SR, -0.691 + 10 * Math.log10(a / w + 1e-20)]);
  }
  return out;
}

// 4x oversampling with a windowed-sinc polyphase FIR (48 taps per phase)
const OS = 4, TAPS = 48;
const PHASES = (() => {
  const ph = [];
  for (let p = 0; p < OS; p++) {
    const h = new Float64Array(TAPS);
    let sum = 0;
    for (let k = 0; k < TAPS; k++) {
      const x = k - TAPS / 2 + 1 - p / OS;
      const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
      const win = 0.42 - 0.5 * Math.cos((2 * Math.PI * (k + p / OS)) / TAPS) + 0.08 * Math.cos((4 * Math.PI * (k + p / OS)) / TAPS);
      h[k] = sinc * win; sum += h[k];
    }
    for (let k = 0; k < TAPS; k++) h[k] /= sum;
    ph.push(h);
  }
  return ph;
})();
// per-sample true-peak estimate |x| over the 4 oversampled points near each sample
export function truePeakPerSample(x) {
  const out = new Float32Array(x.length);
  for (let n = 0; n < x.length; n++) {
    let m = Math.abs(x[n]);
    for (let p = 1; p < OS; p++) {
      const h = PHASES[p];
      let acc = 0;
      for (let k = 0; k < TAPS; k++) {
        const idx = n + k - TAPS / 2 + 1;
        if (idx >= 0 && idx < x.length) acc += h[k] * x[idx];
      }
      const a = Math.abs(acc);
      if (a > m) m = a;
    }
    out[n] = m;
  }
  return out;
}
export function truePeakDb(L, R) {
  let m = 0;
  for (const ch of [L, R]) { const tp = truePeakPerSample(ch); for (let i = 0; i < tp.length; i++) if (tp[i] > m) m = tp[i]; }
  return 20 * Math.log10(m + 1e-20);
}
export function samplePeakDb(L, R) {
  let m = 0;
  for (const ch of [L, R]) for (let i = 0; i < ch.length; i++) { const a = Math.abs(ch[i]); if (a > m) m = a; }
  return 20 * Math.log10(m + 1e-20);
}

// Look-ahead limiter on the true-peak estimate, stereo-linked. gain = movingAverage(slidingMin(required)),
// which never exceeds the required gain at a peak; then a slow release.
export function limit(L, R, { ceilingDb = -1.5, lookahead = 0.003, release = 0.12 } = {}) {
  const n = L.length, la = Math.round(lookahead * SR);
  const c = Math.pow(10, ceilingDb / 20);
  const tl = truePeakPerSample(L), tr = truePeakPerSample(R);
  const req = new Float32Array(n);
  for (let i = 0; i < n; i++) req[i] = Math.min(1, c / Math.max(tl[i], tr[i], 1e-9));
  // sliding minimum over the forward window [i, i + la] (monotonic deque)
  const W = la + 1;
  const minEnd = new Float32Array(n);
  const dq = new Int32Array(n); let h = 0, t = 0;
  for (let j = 0; j < n; j++) {
    while (t > h && req[dq[t - 1]] >= req[j]) t--;
    dq[t++] = j;
    while (dq[h] <= j - W) h++;
    minEnd[j] = req[dq[h]];
  }
  const mn = new Float32Array(n);
  for (let i = 0; i < n; i++) mn[i] = minEnd[Math.min(n - 1, i + la)];
  // moving average over the look-ahead window, then release smoothing
  const g = new Float32Array(n);
  let acc = 0;
  const rel = 1 - Math.exp(-1 / (release * SR));
  let prev = 1;
  for (let i = 0; i < n; i++) {
    acc += mn[i]; if (i >= la + 1) acc -= mn[i - la - 1];
    const avg = acc / Math.min(i + 1, la + 1);
    const target = Math.min(avg, req[i]);
    const smooth = prev + (target - prev) * (target > prev ? rel : 1);
    prev = Math.min(smooth, target);
    g[i] = prev;
  }
  for (let i = 0; i < n; i++) { L[i] *= g[i]; R[i] *= g[i]; }
  let minG = 1; for (let i = 0; i < n; i++) if (g[i] < minG) minG = g[i];
  return { maxReductionDb: -20 * Math.log10(minG) };
}
