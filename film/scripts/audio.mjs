// Render the score: synthesis -> mix -> mastering -> film/out/score.wav (+ report, spectrogram).
//   node film/scripts/audio.mjs
import fs from 'node:fs';
import path from 'node:path';
import { SR, sec, filt, compress, widen, softClip } from '../audio/dsp.mjs';
import { integratedLoudness, truePeakDb, samplePeakDb, limit, shortTermCurve } from '../audio/loudness.mjs';
import { renderScore } from '../audio/score.mjs';
import { DURATION, HITS } from '../src/timeline.js';
import { spawnSync } from 'node:child_process';
import { OUT, ffmpeg, FFMPEG } from './capture.mjs';

const TARGET_LUFS = -14, CEILING_DBTP = -1.5;
const t0 = Date.now();
const log = (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);

const mix = renderScore({ log });

// ---------------------------------------------------------------- mastering chain
log('master');
// 1. clean the sub-sonic rumble, keep the drone (D1 = 36.7 Hz)
for (const ch of ['L', 'R']) {
  mix[ch] = filt(filt(mix[ch], 'hp', 26, 0.7071), 'hp', 26, 0.7071);
  mix[ch] = filt(mix[ch], 'peak', 280, 0.8, -1.5);    // a little less mud
  mix[ch] = filt(mix[ch], 'highshelf', 9000, 0.7, 1.0); // air
}
// 2. stereo width above 160 Hz, mono below
widen(mix, 1.25, 160);
// 3. glue compression
compress(mix, { threshold: -17, ratio: 1.6, attack: 0.04, release: 0.4, knee: 8 });
// 4. loudness normalisation + true-peak limiting, iterated to land on -14 LUFS
const silence = [sec(HITS.silenceStart), sec(HITS.silenceEnd)];
const applyGates = () => {
  // one second of true silence at the closest point (20 ms fades), and the final fade
  const f = sec(0.02);
  for (let i = silence[0] - f; i < silence[1] + f; i++) {
    let g = 0;
    if (i < silence[0]) g = (silence[0] - i) / f;
    else if (i >= silence[1]) g = (i - silence[1]) / f;
    mix.L[i] *= g; mix.R[i] *= g;
  }
  const fs0 = sec(DURATION - 1.4);
  for (let i = fs0; i < mix.n; i++) { const g = Math.cos(((i - fs0) / (mix.n - fs0)) * Math.PI / 2) ** 2; mix.L[i] *= g; mix.R[i] *= g; }
};
applyGates();
let lufs = integratedLoudness(mix.L, mix.R);
log(`pre-limit loudness ${lufs.toFixed(2)} LUFS`);
const base = { L: Float32Array.from(mix.L), R: Float32Array.from(mix.R) };
let gainDb = TARGET_LUFS - lufs;
for (let iter = 0; iter < 6; iter++) {
  const g = Math.pow(10, gainDb / 20);
  for (let i = 0; i < mix.n; i++) { mix.L[i] = base.L[i] * g; mix.R[i] = base.R[i] * g; }
  const lim = limit(mix.L, mix.R, { ceilingDb: CEILING_DBTP, lookahead: 0.004, release: 0.15 });
  applyGates();
  lufs = integratedLoudness(mix.L, mix.R);
  log(`iter ${iter}: gain ${gainDb.toFixed(2)} dB, limiter max GR ${lim.maxReductionDb.toFixed(2)} dB -> ${lufs.toFixed(2)} LUFS`);
  if (Math.abs(lufs - TARGET_LUFS) < 0.1) break;
  gainDb += TARGET_LUFS - lufs;
}
const tp = truePeakDb(mix.L, mix.R), sp = samplePeakDb(mix.L, mix.R);
log(`final: ${lufs.toFixed(2)} LUFS integrated, true peak ${tp.toFixed(2)} dBTP, sample peak ${sp.toFixed(2)} dBFS`);

// ---------------------------------------------------------------- write WAV (32-bit float)
const wavPath = path.join(OUT, 'score.wav');
fs.mkdirSync(OUT, { recursive: true });
{
  const n = mix.n, ch = 2, bytes = n * ch * 4;
  const buf = Buffer.alloc(44 + bytes);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + bytes, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(3, 20); buf.writeUInt16LE(ch, 22);
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * ch * 4, 28); buf.writeUInt16LE(ch * 4, 32); buf.writeUInt16LE(32, 34);
  buf.write('data', 36); buf.writeUInt32LE(bytes, 40);
  for (let i = 0; i < n; i++) { buf.writeFloatLE(mix.L[i], 44 + i * 8); buf.writeFloatLE(mix.R[i], 48 + i * 8); }
  fs.writeFileSync(wavPath, buf);
}
log(`wrote ${wavPath} (${(mix.n / SR).toFixed(3)} s)`);

// ---------------------------------------------------------------- checks
// gaps: 100 ms windows below -60 dBFS RMS outside the intended silence and the very start/end
const gaps = [];
for (let s = sec(0.6); s + sec(0.1) < mix.n - sec(0.8); s += sec(0.1)) {
  let e = 0; for (let i = s; i < s + sec(0.1); i++) e += mix.L[i] ** 2 + mix.R[i] ** 2;
  const db = 10 * Math.log10(e / (2 * sec(0.1)) + 1e-20);
  const t = s / SR;
  const intended = t >= HITS.silenceStart - 0.05 && t < HITS.silenceEnd + 0.02;
  if (db < -60 && !intended) gaps.push(+t.toFixed(1));
}
let clipped = 0; for (let i = 0; i < mix.n; i++) if (Math.abs(mix.L[i]) >= 1 || Math.abs(mix.R[i]) >= 1) clipped++;
const st = shortTermCurve(mix.L, mix.R, 2);
const report = {
  durationSeconds: mix.n / SR, sampleRate: SR, integratedLUFS: +lufs.toFixed(2), truePeakDBTP: +tp.toFixed(2), samplePeakDBFS: +sp.toFixed(2),
  clippedSamples: clipped, unintendedGapsAt: gaps, silence: [HITS.silenceStart, HITS.silenceEnd],
  shortTermLUFS: st.map(([t, l]) => [+t.toFixed(1), +l.toFixed(1)]),
};
fs.writeFileSync(path.join(OUT, 'score_report.json'), JSON.stringify(report, null, 1));
log(`gaps: ${gaps.length ? gaps.join(', ') : 'none'}; clipped samples: ${clipped}`);

// spectrogram for visual inspection
// linear frequency axis: ffmpeg 7's log-frequency axis labels are wrong (a 36.7 Hz sine is drawn at ~800 Hz)
ffmpeg(['-i', wavPath, '-lavfi', 'showspectrumpic=s=1600x700:legend=1:scale=log:fscale=lin:stop=6000:color=intensity', path.join(OUT, 'score_spectrogram.png')]);
// independent loudness check with ffmpeg's EBU R128 meter
const r128 = (() => {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-nostats', '-i', wavPath, '-filter_complex', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8' });
  const txt = r.stderr || '';
  const I = txt.match(/I:\s+(-?[\d.]+) LUFS/g); const P = txt.match(/Peak:\s+(-?[\d.]+) dBFS/g);
  return { I: I ? I[I.length - 1] : '?', TP: P ? P[P.length - 1] : '?' };
})();
log(`ffmpeg ebur128 check: ${r128.I}, true ${r128.TP}`);
