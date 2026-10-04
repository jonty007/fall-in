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
  { id: 'doppler', name: 'Doppler beaming', t0: 60, t1: 76, still: 64.5 },
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
  [0.0, 170, 86.0, -22, 0, 0, 0, 30, 9.6],
  [7.0, 82, 85.4, -13, 0, -2.0, 0, 30, 9.6],
  // title: push continues
  [12.6, 54, 85.2, -4, 0, -2.5, 0, 29, 9.2],
  // gravity bends light: just outside the disk's rim, 5 deg above its plane, so the far
  // side shows both over and under the shadow; hole on the left, the right third left to
  // sky for the explanation (text and diagram never sit on the disk)
  [15.4, 47, 85.0, 8, -12.0, 0.4, 0, 36, 8.8],
  [29.2, 42, 84.8, 20, -11.5, 0.4, 0, 36, 8.8],
  // photon sphere: closer, the thin photon ring separates from the disk
  [33.0, 36.0, 74.0, 36, 11.0, 0.3, 0, 34, 2.9],
  [45.2, 31.5, 71.0, 56, 11.5, 0.3, 0, 32, 2.0],
  // innermost stable orbit: from above, the gap between shadow and inner edge; hole on the
  // left so the explanation sits over the dimmer, receding side on the right
  [49.2, 34.0, 38.0, 74, -13.0, 1.5, 0, 40, 5.2],
  [59.2, 31.0, 34.0, 88, -12.5, 1.5, 0, 40, 5.2],
  // doppler: almost edge-on, centred
  [62.6, 24.0, 86.0, 92, 0, 7.5, 0, 40, 5.3],
  [75.2, 22.0, 85.5, 102, 0, 7.0, 0, 40, 5.3],
  // close orbit: dive to 1.7 rs and look up along the edge of the shadow; closest at 86 s
  [80.0, 7.2, 82.0, 138, 0, 22, -4, 56, 3.6],
  [82.4, 3.7, 80.5, 166, 0, 60, -9, 78, 1.7],
  [86.0, 3.4, 80.0, 190, 0, 66, -12, 80, 1.55],
  [87.0, 3.42, 80.0, 196, 0, 66, -12, 80, 1.55],
  // pull back, finding the hole again before the long lens
  [88.6, 7.0, 66.0, 206, 0, 24, 30, 66, 2.8],
  [90.0, 40.0, 38.0, 218, 0, 4, 72, 30, 4.5],
  // payoff: pull far back, 17 degrees from the axis (the angle we see M87* at);
  // rolled so the Doppler-bright side is at the bottom, as in the 2017 EHT image
  [91.6, 560, 17.0, 226, 0, 0, 90, 11, 13.0],
  [104.6, 620, 17.0, 236, 0, 0, 90, 10.5, 13.0],
  // end card: the ring, smaller and whole, above the title
  [105.8, 470, 17.0, 237, 3.0, 0, 90, 15, 13.0],
  [108.0, 478, 17.0, 238, 3.1, 0, 90, 15, 13.0],
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
// Doppler comparison: 0 = with Doppler shifts (the real view), 1 = without (as rendered for Interstellar).
// The whole frame morphs between the two rather than wiping: a split would put the approaching side of one
// version next to the receding side of the other and show a false asymmetry.
const WIPE = [[60, 0], [67.2, 0], [69.2, 1], [73.6, 1], [75.6, 0], [76, 0]];
// Telescope blur divider for the payoff: blurred to the right of the divider. It stops at the
// centre, so the frame ends as a side-by-side: sharp on the left, EHT resolution on the right.
const TELE = [[90, 1.05], [95.2, 1.05], [98.6, 0.5], [104.4, 0.5], [105.6, 1.05], [108, 1.05]];
// the photon-sphere diagram interlude: the shot fades out completely (no second hole behind the diagram)
const DIM = [[0, 1], [37.2, 1], [38.4, 0.0], [44.2, 0.0], [45.4, 1], [108, 1]];

// Brighter background sky on the dive: the static observer deep in the potential sees
// starlight blueshifted (already in the shader); this extra gain keeps the lensed
// star rings readable at the low exposure the nearby disk forces.
const STARS = [[0, 1], [76, 1], [82, 2.2], [86, 3], [88, 3], [91.6, 1], [108, 1]];

// Soft darkening behind text blocks (design px rects: x0, y0, x1, y1, strength)
const SCRIMS = [
  { t0: 6.8, t1: 12.6, rect: [500, 840, 1420, 1010], k: 0.5 },
  { t0: 15.4, t1: 29.2, rect: [1250, 60, 1900, 1040], k: 0.7 },
  { t0: 33.0, t1: 38.6, rect: [40, 70, 1000, 250], k: 0.62 },
  { t0: 49.2, t1: 59.4, rect: [1180, 60, 1900, 1040], k: 0.8 },
  { t0: 62.2, t1: 75.4, rect: [380, 60, 1540, 290], k: 0.62 },
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
  const fadeOut = 1 - 0.25 * smootherstep(104.6, 105.8, t);
  return {
    wipe: [0, 0, 0, 1 - Math.min(Math.max(wipeX, 0), 1)],   // x, softness, split on/off, beaming amount
    teleSplit: [teleX, 0.004, t > 94 && t < 105.8 ? 1 : 0, 0],
    // dimmed for the photon-sphere diagram; eased down while the no-Doppler disk (brighter, flatter) fills the frame
    dim: monotone(DIM, t) * (t > 60 && t < 76 ? 1 - 0.32 * Math.min(Math.max(wipeX, 0), 1) : 1),
    fade: fadeIn * fadeOut,
    diskTime: 60 + t * 11,
    starBoost: monotone(STARS, t),
  };
}

// ---------------------------------------------------------------------------
// Text. Positions in a 1920x1080 design space. Each cue fades in/out over `fade` s.
// kinds: headline (serif, 64), question (serif italic, 70), caption (sans, 38), title (serif, 150),
//        credit (sans, 34), mono (readout, 34). `text` may be a function of the physics values.
// ---------------------------------------------------------------------------
export const CUES = [
  { t0: 1.2, t1: 5.9, kind: 'question', text: 'What would you actually see?', x: 960, y: 900, align: 'center' },
  { t0: 7.0, t1: 12.3, kind: 'title', text: 'FALL IN', x: 960, y: 968, align: 'center' },

  // gravity and ISCO: hole on the left, the explanation in a right-hand column over sky
  { t0: 15.6, t1: 29.0, kind: 'headline', text: 'Gravity bends light', x: 1250, y: 150 },
  { t0: 17.4, t1: 22.6, kind: 'caption', text: 'You’re seeing the disk’s far side.', x: 1250, y: 214 },
  { t0: 23.0, t1: 28.6, kind: 'caption', text: 'Bent over the top, and under.', x: 1250, y: 214 },

  { t0: 33.2, t1: 44.8, kind: 'headline', text: 'The photon sphere', x: 120, y: 150 },
  { t0: 34.4, t1: 39.2, kind: 'caption', text: 'Here, light itself can orbit.', x: 120, y: 214 },
  { t0: 39.8, t1: 44.8, kind: 'caption', text: 'One nudge: it falls or escapes.', x: 120, y: 214 },

  { t0: 49.4, t1: 59.2, kind: 'headline', text: 'The last stable orbit', x: 1180, y: 150 },
  { t0: 50.6, t1: 58.8, kind: 'caption', text: 'Inside 3 rₛ, matter plunges in.', x: 1180, y: 214 },

  { t0: 62.6, t1: 67.0, kind: 'headline', text: 'One side is brighter', x: 960, y: 150, align: 'center' },
  { t0: 63.0, t1: 67.0, kind: 'caption', text: (P) => `Gas coming toward you: up to ${Math.round(Math.pow(P.gApp / P.gRec, 4))}× brighter.`, x: 960, y: 214, align: 'center' },
  { t0: 69.0, t1: 73.6, kind: 'headline', text: 'How Interstellar showed it', x: 960, y: 150, align: 'center' },
  { t0: 69.4, t1: 73.6, kind: 'caption', text: 'Doppler left out, on purpose.', x: 960, y: 214, align: 'center' },

  { t0: 80.8, t1: 85.9, kind: 'headline', text: 'Just outside the photon sphere', x: 120, y: 740 },
  { t0: 81.2, t1: 85.9, kind: 'caption', text: 'The shadow covers ≈ 40% of the sky.', x: 120, y: 804 },

  { t0: 92.0, t1: 104.2, kind: 'headline', text: 'What a telescope would see', x: 960, y: 150, align: 'center' },
  { t0: 94.6, t1: 99.4, kind: 'caption', text: 'Our render, blurred to EHT resolution.', x: 960, y: 214, align: 'center' },
  { t0: 99.8, t1: 104.2, kind: 'caption', text: 'The real M87* (2019): brighter below too.', x: 960, y: 214, align: 'center' },

  { t0: 105.4, t1: 108.2, kind: 'title', text: 'FALL IN', x: 960, y: 760, align: 'center', fade: 0.5 },
  { t0: 105.7, t1: 108.2, kind: 'credit', text: 'Made by @vivekst1 with Claude Opus 5.5 from one prompt', x: 960, y: 858, align: 'center', fade: 0.5 },
];

// Readout blocks (mono). `lines` is a function of (t, cam, phys) so physics values
// come from formulas at render time.
export const READOUTS = [
  { t0: 38.6, t1: 44.8, x: 120, y: 930, lines: (t, c, P) => [`photon orbit  ${(P.ph.r / 2).toFixed(3)} rₛ`, `shadow edge   ${(P.ph.bc / 2).toFixed(3)} rₛ`] },
  { t0: 50.0, t1: 59.2, x: 1180, y: 960, lines: (t, c, P) => [`orbital speed  ${P.isco.v.toFixed(1)} c`] },
  // Doppler: one block over the sky on each side of the hole, tied to the side it describes
  { t0: 63.2, t1: 67.0, x: 120, y: 380, leader: [330, 640], lines: (t, c, P) => ['approaching', `≈ ${Math.round(Math.pow(P.gApp, 4))}× brighter`] },
  { t0: 63.2, t1: 67.0, x: 1800, y: 380, align: 'right', leader: [1600, 650], lines: (t, c, P) => ['receding', `≈ ${Math.round(Math.pow(P.gRec, -4))}× dimmer`] },
  { t0: 81.4, t1: 85.9, x: 120, y: 900, lines: (t, c, P) => [`distance   ${(c.r / 2).toFixed(2)} rₛ`, `time runs  ${((1 - P.clockRate(c.r)) * 100).toFixed(0)}% slower`, `starlight  ${(1 / P.clockRate(c.r)).toFixed(2)}× bluer`] },
];

// Small labels pinned to screen positions
export const LABELS = [
  { t0: 98.8, t1: 104.2, kind: 'split' },   // the payoff's side-by-side: "sharp" | "EHT resolution"
];

// Side panels
export const PANELS = [
  { id: 'rays', t0: 15.4, t1: 29.2 },
  { id: 'photon', t0: 38.2, t1: 45.0 },
  { id: 'isco', t0: 49.2, t1: 59.4 },
];

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
  wipeOff: 67.2,
  wipeOn: 73.6,
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
