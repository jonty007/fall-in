// FALL IN — the single source of truth for timing. Used by the page (visuals,
// overlays) and by the score generator (hit points), so picture and sound agree.
// Every value here is a pure function of time t (seconds).

export const DURATION = 108;
export const FPS = 30;

export const BEATS = [
  { id: 'hook', name: 'Hook', t0: 0, t1: 7, still: 3.6 },
  { id: 'title', name: 'Title', t0: 7, t1: 13, still: 10.2 },
  { id: 'gravity', name: 'Gravity bends light', t0: 13, t1: 30, still: 24.5 },
  { id: 'photon', name: 'Photon sphere', t0: 30, t1: 46, still: 41.0 },
  { id: 'isco', name: 'Innermost stable orbit', t0: 46, t1: 60, still: 55.5 },
  { id: 'doppler', name: 'Doppler beaming', t0: 60, t1: 76, still: 69.5 },
  { id: 'close', name: 'Close orbit', t0: 76, t1: 90, still: 84.8 },
  { id: 'payoff', name: 'Payoff: M87*', t0: 90, t1: 105, still: 101.0 },
  { id: 'end', name: 'End card', t0: 105, t1: 108, still: 106.6 },
];

// ---------------------------------------------------------------------------
// Monotone cubic (Fritsch–Carlson) interpolation: C1, no overshoot, and it eases
// naturally where a fast move meets a slow drift.
// ---------------------------------------------------------------------------
export function monotone(keys, t) {
  const n = keys.length;
  if (t <= keys[0][0]) return keys[0][1];
  if (t >= keys[n - 1][0]) return keys[n - 1][1];
  let i = 0;
  while (t > keys[i + 1][0]) i++;
  const slope = (j) => (keys[j + 1][1] - keys[j][1]) / (keys[j + 1][0] - keys[j][0]);
  const tangent = (j) => {
    if (j === 0 || j === n - 1) return 0; // ease in/out at the ends
    const s0 = slope(j - 1), s1 = slope(j);
    if (s0 * s1 <= 0) return 0;
    const h0 = keys[j][0] - keys[j - 1][0], h1 = keys[j + 1][0] - keys[j][0];
    const w1 = 2 * h1 + h0, w2 = h1 + 2 * h0;
    return (w1 + w2) / (w1 / s0 + w2 / s1); // weighted harmonic mean
  };
  const [t0, v0] = keys[i], [t1, v1] = keys[i + 1];
  const h = t1 - t0, s = (t - t0) / h;
  const m0 = tangent(i) * h, m1 = tangent(i + 1) * h;
  const s2 = s * s, s3 = s2 * s;
  return (2 * s3 - 3 * s2 + 1) * v0 + (s3 - 2 * s2 + s) * m0 + (-2 * s3 + 3 * s2) * v1 + (s3 - s2) * m1;
}
export const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const smootherstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * t * (t * (6 * t - 15) + 10); };
const lerp = (a, b, t) => a + (b - a) * t;

// ---------------------------------------------------------------------------
// Camera: keyframes per channel. r is interpolated in log space.
// Columns: t, r [M], inclination from the disk axis [deg], azimuth [deg],
//          yaw [deg] (hole off-centre), pitch [deg], roll [deg], vertical FOV [deg], exposure
// ---------------------------------------------------------------------------
const CAM = [
  // hook: slow push-in, hole centred, stars warping into a ring
  [0.0, 170, 86.0, -22, 0, 0, 0, 30, 24],
  [7.0, 82, 85.4, -13, 0, 0, 0, 30, 24],
  // title: push continues
  [12.6, 54, 85.2, -4, 0, 0, 0, 29, 23],
  // gravity bends light: just outside the disk's rim, 5 deg above its plane, so the far
  // side shows both over and under the shadow; hole on the left third, panel on the right
  [15.4, 47, 85.0, 8, -9.5, 0.4, 0, 27, 22],
  [29.2, 42, 84.8, 20, -8.8, 0.4, 0, 27, 22],
  // photon sphere: closer, the thin photon ring separates from the disk
  [33.0, 36.0, 74.0, 36, -10.0, 0.3, 0, 30, 18],
  [45.2, 31.5, 71.0, 56, -9.5, 0.3, 0, 28, 18],
  // innermost stable orbit: from above, the gap between shadow and inner edge
  [49.2, 25.0, 61.0, 70, -10.0, 0, 0, 44, 13],
  [59.2, 22.5, 57.0, 82, -9.5, 0, 0, 44, 13],
  // doppler: almost edge-on, centred
  [62.6, 24.0, 86.0, 92, 0, 0, 0, 40, 21],
  [75.2, 22.0, 85.5, 102, 0, 0, 0, 40, 21],
  // close orbit: dive to 1.7 rs and look up along the edge of the shadow; closest at 86 s
  [80.5, 7.0, 82.0, 140, 0, 24, 4, 58, 9],
  [86.0, 3.4, 80.0, 190, 0, 68, 0, 82, 3.6],
  [87.0, 3.42, 80.0, 196, 0, 69, 0, 82, 3.6],
  // payoff: pull far back, 17 degrees from the axis (the angle we see M87* at);
  // rolled so the Doppler-bright side is at the bottom, as in the 2017 EHT image
  [91.6, 300, 17.0, 226, 0, 0, 90, 11, 34],
  [104.8, 330, 17.0, 236, 0, 0, 90, 10.5, 34],
  [108.0, 340, 17.0, 238, 0, 0, 90, 10.5, 34],
];
const ch = (k) => CAM.map((row) => [row[0], k === 1 ? Math.log(row[1]) : row[k]]);
const CH = { r: ch(1), incl: ch(2), az: ch(3), yaw: ch(4), pitch: ch(5), roll: ch(6), fov: ch(7), exposure: ch(8) };

export function cameraAt(t) {
  return {
    r: Math.exp(monotone(CH.r, t)),
    incl: monotone(CH.incl, t),
    az: monotone(CH.az, t),
    yaw: monotone(CH.yaw, t),
    pitch: monotone(CH.pitch, t),
    roll: monotone(CH.roll, t),
    fov: monotone(CH.fov, t),
    exposure: monotone(CH.exposure, t),
  };
}

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------
// Doppler wipe: beaming is ON to the right of the divider (screen x in 0..1).
const WIPE = [[60, 0], [66.0, 0], [68.2, 1.04], [71.4, 1.04], [73.8, 0], [76, 0]];
// Telescope blur divider for the payoff: blurred to the right of the divider.
const TELE = [[90, 1.05], [95.2, 1.05], [98.6, -0.05], [108, -0.05]];

// Brighter background sky on the dive: the static observer deep in the potential sees
// starlight blueshifted (already in the shader); this extra gain keeps the lensed
// star rings readable at the low exposure the nearby disk forces.
const STARS = [[0, 1], [76, 1], [82, 3.2], [86, 5], [88, 5], [91.6, 1], [108, 1]];

// Soft darkening behind text blocks (design px rects: x0, y0, x1, y1, strength)
const SCRIMS = [
  { t0: 15.4, t1: 29.2, rect: [40, 70, 1020, 260], k: 0.45 },
  { t0: 15.4, t1: 29.2, rect: [40, 880, 900, 1010], k: 0.45 },
  { t0: 33.0, t1: 45.4, rect: [40, 70, 1020, 260], k: 0.45 },
  { t0: 33.0, t1: 45.4, rect: [40, 860, 1000, 1030], k: 0.55 },
  { t0: 49.2, t1: 59.4, rect: [40, 70, 1020, 260], k: 0.6 },
  { t0: 49.2, t1: 59.4, rect: [40, 860, 1000, 1030], k: 0.6 },
  { t0: 61.4, t1: 75.2, rect: [420, 70, 1500, 300], k: 0.5 },
  { t0: 61.4, t1: 75.2, rect: [40, 860, 1000, 1030], k: 0.55 },
  { t0: 80.6, t1: 86.0, rect: [40, 70, 1020, 260], k: 0.5 },
];

export function scrimsAt(t) {
  const out = [];
  for (const s of SCRIMS) {
    const a = smoothstep(s.t0, s.t0 + 0.8, t) * (1 - smoothstep(s.t1 - 0.8, s.t1, t));
    if (a > 0) out.push({ rect: s.rect, k: s.k * a });
  }
  return out.slice(0, 3);
}

export function effectsAt(t) {
  const wipeX = monotone(WIPE, t);
  const teleX = monotone(TELE, t);
  const fadeIn = smootherstep(0.0, 2.2, t);
  const fadeOut = 1 - 0.82 * smootherstep(104.6, 105.6, t);
  return {
    wipe: [wipeX, 0.004, t > 60 && t < 76 ? 1 : 0, 1],
    teleSplit: [teleX, 0.006, t > 94 ? 1 : 0, 0],
    fade: fadeIn * fadeOut,
    diskTime: 60 + t * 11,
    starBoost: monotone(STARS, t),
  };
}

// ---------------------------------------------------------------------------
// Text. Positions in a 1920x1080 design space. Each cue fades in/out over `fade` s.
// kinds: headline (serif, 64), question (serif italic, 68), caption (sans, 38),
//        title (sans light, 132, wide tracking), credit (sans, 36), mono (readout, 26), cite (mono, 24)
// ---------------------------------------------------------------------------
export const CUES = [
  { t0: 1.2, t1: 5.9, kind: 'question', text: 'What would you actually see?', x: 960, y: 900, align: 'center' },
  { t0: 7.0, t1: 12.3, kind: 'title', text: 'FALL IN', x: 960, y: 905, align: 'center' },

  { t0: 15.6, t1: 29.0, kind: 'headline', text: 'Gravity bends light', x: 120, y: 150 },
  { t0: 17.4, t1: 22.6, kind: 'caption', text: 'You’re seeing the disk’s far side.', x: 120, y: 214 },
  { t0: 23.0, t1: 28.6, kind: 'caption', text: 'Bent over the top, and under.', x: 120, y: 214 },

  { t0: 33.2, t1: 45.2, kind: 'headline', text: 'The photon sphere', x: 120, y: 150 },
  { t0: 34.8, t1: 39.8, kind: 'caption', text: 'Here, light itself can orbit.', x: 120, y: 214 },
  { t0: 40.2, t1: 45.0, kind: 'caption', text: 'One nudge: it falls or escapes.', x: 120, y: 214 },

  { t0: 49.4, t1: 59.2, kind: 'headline', text: 'The last stable orbit', x: 120, y: 150 },
  { t0: 51.0, t1: 58.8, kind: 'caption', text: 'Inside 3 rₛ, matter plunges in.', x: 120, y: 214 },

  { t0: 61.6, t1: 75.0, kind: 'headline', text: 'One side is brighter', x: 960, y: 150, align: 'center' },
  { t0: 62.6, t1: 66.6, kind: 'caption', text: 'The side moving toward you is brighter.', x: 960, y: 214, align: 'center' },
  { t0: 68.0, t1: 73.0, kind: 'caption', text: 'Interstellar left this out, on purpose.', x: 960, y: 214, align: 'center' },
  { t0: 68.4, t1: 73.0, kind: 'cite', text: 'James, von Tunzelmann, Franklin & Thorne · Class. Quantum Grav. 32, 065001 (2015)', x: 960, y: 262, align: 'center' },

  { t0: 80.8, t1: 85.6, kind: 'headline', text: '1.7 rₛ from the centre', x: 120, y: 150 },
  { t0: 81.6, t1: 85.6, kind: 'caption', text: 'The shadow covers ≈ 40% of the sky.', x: 120, y: 214 },

  { t0: 92.2, t1: 104.4, kind: 'headline', text: 'Compare: the first real image', x: 960, y: 150, align: 'center' },
  { t0: 94.6, t1: 98.8, kind: 'caption', text: 'Blur ours to the telescope’s sharpness…', x: 960, y: 214, align: 'center' },
  { t0: 99.0, t1: 104.4, kind: 'caption', text: 'M87*: the same lopsided glowing ring.', x: 960, y: 214, align: 'center' },

  { t0: 105.2, t1: 108.2, kind: 'title', text: 'FALL IN', x: 960, y: 520, align: 'center', fade: 0.5 },
  { t0: 105.5, t1: 108.2, kind: 'credit', text: 'Made by @vivekst1 with Claude Opus 5.5 from one prompt', x: 960, y: 640, align: 'center', fade: 0.5 },
];

// Readout blocks (mono). `lines` is a function of (t, cam, phys) so physics values
// come from formulas at render time.
export const READOUTS = [
  { t0: 15.6, t1: 29.0, x: 120, y: 950, lines: (t, c, P) => [`r      ${(c.r / 2).toFixed(1)} rₛ`, `clock  ${P.clockRate(c.r).toFixed(3)} × far-away clock`] },
  { t0: 33.2, t1: 45.2, x: 120, y: 914, lines: (t, c, P) => [`photon orbit   r = ${(P.ph.r / 2).toFixed(3)} rₛ   (numerical)`, `shadow edge    b = ${(P.ph.bc / 2).toFixed(3)} rₛ   (√27 M)`, `camera         r = ${(c.r / 2).toFixed(1)} rₛ`] },
  { t0: 49.4, t1: 59.2, x: 120, y: 914, lines: (t, c, P) => [`last stable orbit  r = ${(P.isco.r / 2).toFixed(3)} rₛ  (numerical)`, `orbital speed      v = ${P.isco.v.toFixed(3)} c`, `camera             r = ${(c.r / 2).toFixed(1)} rₛ`] },
  { t0: 61.6, t1: 75.0, x: 120, y: 914, lines: (t, c, P) => [`inner edge, edge-on:`, `approaching  g = ${P.gApp.toFixed(2)}   receding  g = ${P.gRec.toFixed(2)}`, `brightness ∝ g⁴  →  ≈ ${Math.round(Math.pow(P.gApp / P.gRec, 4))}× brighter`] },
  { t0: 80.8, t1: 86.0, x: 120, y: 914, lines: (t, c, P) => [`r            ${(c.r / 2).toFixed(2)} rₛ`, `clock rate   ${P.clockRate(c.r).toFixed(2)}`, `starlight    ×${(1 / P.clockRate(c.r)).toFixed(2)} bluer`] },
  { t0: 99.0, t1: 104.4, x: 960, y: 930, align: 'center', lines: () => ['M87* · Event Horizon Telescope · imaged April 2017, published 10 April 2019', 'ring ≈ 42 µas across  ·  ≈ 6.5 billion Suns  ·  ≈ 55 million light-years'] },
];

// Small labels pinned to screen positions
export const LABELS = [
  { t0: 66.4, t1: 73.4, kind: 'divider' }, // drawn at the wipe position
  { t0: 95.0, t1: 99.0, kind: 'teleDivider' },
];

// Side panels
export const PANELS = [
  { id: 'rays', t0: 15.4, t1: 29.2 },
  { id: 'photon', t0: 33.0, t1: 45.4 },
  { id: 'isco', t0: 49.2, t1: 59.4 },
];

// Live distance readout in the corner during the flight
export const HUD = { t0: 13.4, t1: 89.6 };

// ---------------------------------------------------------------------------
// Music hit points (seconds). The heartbeat is the film's clock: 60 bpm, so beats
// land on whole seconds, slowing during the dive, silent 86–87 s.
// ---------------------------------------------------------------------------
export const HITS = {
  firstBeat: 1.0,
  title: 7.0,
  gravity: 13.0,
  photon: 30.0,
  isco: 46.0,
  doppler: 60.0,
  wipeOff: 66.0,
  wipeOn: 71.4,
  dive: 76.0,
  silenceStart: 86.0,
  silenceEnd: 87.0,
  payoff: 90.0,
  blur: 95.2,
  end: 105.0,
};

export function heartbeatTimes() {
  const beats = [];
  for (let t = 1; t <= 76; t += 1) beats.push(t);
  // slowing pulse on the dive: intervals stretch toward the closest point
  let t = 76, iv = 1.0;
  while (true) {
    iv *= 1.13;
    t += iv;
    if (t > 85.2) break;
    beats.push(+t.toFixed(3));
  }
  return beats;
}

export { lerp };
