// Physics shared by the renderer, the overlay diagrams and the readouts.
// Units: G = c = M = 1, so the Schwarzschild radius rs = 2.
// Everything here is deterministic and runs once at load time.

export const RS = 2;

// ---------------------------------------------------------------------------
// Blackbody colour: Planck spectrum integrated against the CIE 1931 2° colour
// matching functions (multi-lobe Gaussian fit, Wyman, Sloan & Shirley 2013),
// then XYZ -> linear Rec.709/sRGB primaries.
// ---------------------------------------------------------------------------
function lobe(l, mu, s1, s2) {
  const t = (l - mu) / (l < mu ? s1 : s2);
  return Math.exp(-0.5 * t * t);
}
export function cie1931(l) {
  const x = 1.056 * lobe(l, 599.8, 37.9, 31.0) + 0.362 * lobe(l, 442.0, 16.0, 26.7) - 0.065 * lobe(l, 501.1, 20.4, 26.2);
  const y = 0.821 * lobe(l, 568.8, 46.9, 40.5) + 0.286 * lobe(l, 530.9, 16.3, 31.1);
  const z = 1.217 * lobe(l, 437.0, 11.8, 36.0) + 0.681 * lobe(l, 459.0, 26.0, 13.8);
  return [x, y, z];
}
const C2 = 1.4387769e7; // second radiation constant in nm*K
function planck(lnm, T) {
  // spectral radiance up to a constant factor (2hc^2 dropped)
  return 1 / (Math.pow(lnm * 1e-3, 5) * (Math.exp(C2 / (lnm * T)) - 1));
}
export function blackbodyXYZ(T) {
  let X = 0, Y = 0, Z = 0;
  for (let l = 360; l <= 830; l += 1) {
    const p = planck(l, T);
    const [x, y, z] = cie1931(l);
    X += p * x; Y += p * y; Z += p * z;
  }
  return [X, Y, Z];
}
export function xyzToLinear709([X, Y, Z]) {
  return [
    3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z,
    -0.969266 * X + 1.8760108 * Y + 0.041556 * Z,
    0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z,
  ];
}

// LUT layout: T = T_MIN * (T_MAX/T_MIN)^(i/(N-1)), i in [0, N)
export const BB_LUT = { N: 512, T_MIN: 600, T_MAX: 120000 };

// Returns Float32Array RGBA: rgb = chromaticity scaled so Y = 1, a = log2(Y) relative to Y(6500 K)
export function buildBlackbodyLUT() {
  const { N, T_MIN, T_MAX } = BB_LUT;
  const out = new Float32Array(N * 4);
  const Yref = blackbodyXYZ(6500)[1];
  for (let i = 0; i < N; i++) {
    const T = T_MIN * Math.pow(T_MAX / T_MIN, i / (N - 1));
    const xyz = blackbodyXYZ(T);
    const Y = xyz[1];
    let [r, g, b] = xyzToLinear709(xyz.map((v) => v / Y));
    r = Math.max(r, 0); g = Math.max(g, 0); b = Math.max(b, 0);
    out[i * 4 + 0] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = Math.log2(Y / Yref);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Thin accretion disk: Novikov–Thorne / Page–Thorne radiative flux for a
// Schwarzschild hole with zero torque at the ISCO, from the general formula
//   F(r) = -(Mdot / 4 pi sqrt(-g)) * Omega_,r / (E - Omega L)^2 * Int_{r_in}^{r} (E - Omega L) L_,r dr
// with circular-orbit E, L, Omega, sqrt(-g) = r (equatorial plane). T ∝ F^(1/4).
// ---------------------------------------------------------------------------
export const R_ISCO = 6;
const E_ = (r) => (1 - 2 / r) / Math.sqrt(1 - 3 / r);
const L_ = (r) => Math.sqrt(r) / Math.sqrt(1 - 3 / r);
const W_ = (r) => Math.pow(r, -1.5);
const d = (f, r, h = 1e-5 * r) => (f(r + h) - f(r - h)) / (2 * h);

export function pageThorneFlux(r, rin = R_ISCO) {
  if (r <= rin) return 0;
  // Simpson integration of (E - Omega L) dL/dr from rin to r
  const n = 400;
  const h = (r - rin) / n;
  let s = 0;
  for (let i = 0; i <= n; i++) {
    const x = rin + i * h;
    const w = i === 0 || i === n ? 1 : i % 2 ? 4 : 2;
    s += w * (E_(x) - W_(x) * L_(x)) * d(L_, x);
  }
  s *= h / 3;
  const EmWL = E_(r) - W_(r) * L_(r);
  return (-d(W_, r) / (EmWL * EmWL)) * s / r; // drop Mdot/4pi
}

// Closed form for a = 0 (Page & Thorne 1974), used to cross-check the integral.
export function pageThorneFluxClosed(r) {
  const x = Math.sqrt(r);
  const x0 = Math.sqrt(6), x3 = Math.sqrt(3);
  if (r <= 6) return 0;
  const bracket = x - x0 + (x3 / 2) * Math.log(((x + x3) * (x0 - x3)) / ((x - x3) * (x0 + x3)));
  return (3 / (2 * x * x * x * x * (x * x * x - 3 * x))) * bracket; // ∝ 1/(r^2 (r^{3/2} - 3 r^{1/2})) ...
}

// Disk temperature profile T(r)/T_peak sampled for the shader on r in [6, R_PROFILE_MAX]
export const DISK_LUT = { N: 512, R_MIN: 6, R_MAX: 60 };
export function buildDiskProfile() {
  const { N, R_MIN, R_MAX } = DISK_LUT;
  const T = new Float32Array(N);
  let tmax = 0, rpeak = 0;
  for (let i = 0; i < N; i++) {
    const r = R_MIN + ((R_MAX - R_MIN) * i) / (N - 1);
    const t = Math.pow(Math.max(pageThorneFlux(r), 0), 0.25);
    T[i] = t;
    if (t > tmax) { tmax = t; rpeak = r; }
  }
  for (let i = 0; i < N; i++) T[i] /= tmax;
  return { T, rpeak };
}

// ---------------------------------------------------------------------------
// Geodesics in the orbital plane (Binet form). Light:   u'' = 3 u^2 - u
//                                                Matter: u'' = 1/L^2 - u + 3 u^2
// with u = 1/r and ' = d/dphi. Integrated with RK4 (same scheme as the shader).
// ---------------------------------------------------------------------------
export function traceLight({ b, r0 = 60, dphi = 0.004, maxPhi = 40 }) {
  // incoming from radius r0 on the far side, moving inward, impact parameter b
  let u = 1 / r0;
  let w = Math.sqrt(Math.max(1 / (b * b) - u * u * (1 - 2 * u), 0)); // du/dphi > 0 (inward)
  let phi = 0;
  const pts = [[r0, 0]];
  let rmin = r0;
  let captured = false;
  const acc = (u) => 3 * u * u - u;
  while (phi < maxPhi) {
    const h = dphi;
    const k1u = w, k1w = acc(u);
    const k2u = w + 0.5 * h * k1w, k2w = acc(u + 0.5 * h * k1u);
    const k3u = w + 0.5 * h * k2w, k3w = acc(u + 0.5 * h * k2u);
    const k4u = w + h * k3w, k4w = acc(u + h * k3u);
    u += (h / 6) * (k1u + 2 * k2u + 2 * k3u + k4u);
    w += (h / 6) * (k1w + 2 * k2w + 2 * k3w + k4w);
    phi += h;
    if (u >= 0.5) { captured = true; pts.push([2, phi]); break; }
    if (u <= 1 / r0) { pts.push([1 / Math.max(u, 1e-9), phi]); break; }
    pts.push([1 / u, phi]);
    rmin = Math.min(rmin, 1 / u);
  }
  return { pts, rmin, captured, phiTotal: phi };
}

export function traceMatter({ r0, L, ur0 = 0, dphi = 0.004, maxPhi = 60 }) {
  let u = 1 / r0;
  let w = ur0;
  let phi = 0;
  const pts = [[r0, 0]];
  let plunged = false;
  const acc = (u) => 1 / (L * L) - u + 3 * u * u;
  while (phi < maxPhi) {
    const h = dphi;
    const k1u = w, k1w = acc(u);
    const k2u = w + 0.5 * h * k1w, k2w = acc(u + 0.5 * h * k1u);
    const k3u = w + 0.5 * h * k2w, k3w = acc(u + 0.5 * h * k2u);
    const k4u = w + h * k3w, k4w = acc(u + h * k3u);
    u += (h / 6) * (k1u + 2 * k2u + 2 * k3u + k4u);
    w += (h / 6) * (k1w + 2 * k2w + 2 * k3w + k4w);
    phi += h;
    if (u >= 0.5) { plunged = true; pts.push([2, phi]); break; }
    pts.push([1 / u, phi]);
  }
  return { pts, plunged };
}

// Circular-orbit angular momentum for matter at radius r (per unit mass)
export const circularL = (r) => Math.sqrt(r) / Math.sqrt(1 - 3 / r);

// ---------------------------------------------------------------------------
// Numerical checks shown on screen (computed, not typed in)
// ---------------------------------------------------------------------------
// Photon sphere: maximum of the photon effective potential V(r) = (1 - 2/r)/r^2
export function photonSphereNumerical() {
  const V = (r) => (1 - 2 / r) / (r * r);
  let a = 2.1, b = 10;
  for (let i = 0; i < 200; i++) { // golden-section search for the maximum
    const c = b - (b - a) / 1.618033988749895, e = a + (b - a) / 1.618033988749895;
    if (V(c) > V(e)) b = e; else a = c;
  }
  const r = (a + b) / 2;
  const bc = 1 / Math.sqrt(V(r)); // critical impact parameter
  return { r, bc };
}
// ISCO: smallest r where the matter effective potential still has a minimum,
// i.e. dL/dr = 0 for circular orbits L(r) = sqrt(r)/sqrt(1 - 3/r)
export function iscoNumerical() {
  const dL = (r) => d(circularL, r);
  let a = 3.5, b = 20; // dL changes sign at the ISCO
  for (let i = 0; i < 200; i++) {
    const m = (a + b) / 2;
    if (dL(m) < 0) a = m; else b = m;
  }
  const r = (a + b) / 2;
  const v = Math.sqrt(1 / (r - 2)); // local orbital speed seen by a static observer
  return { r, v };
}
// Redshift factor g = nu_obs/nu_emit for gas on a circular orbit at r, photon with
// angular momentum per unit energy bz (sign: + along the gas motion), static observer at robs.
export function diskG(r, bz, robs = Infinity) {
  const ut = 1 / Math.sqrt(1 - 3 / r);
  const Om = Math.pow(r, -1.5);
  const fobs = robs === Infinity ? 1 : 1 - 2 / robs;
  return 1 / (Math.sqrt(fobs) * ut * (1 - Om * bz));
}
// Shadow angular radius (from the direction of the hole) for a static observer at r
export function shadowHalfAngle(r) {
  const s = (Math.sqrt(27) / r) * Math.sqrt(1 - 2 / r);
  if (r <= 3) return Math.PI - Math.asin(Math.min(s, 1));
  return Math.asin(Math.min(s, 1));
}
export const skyFractionInShadow = (r) => (1 - Math.cos(shadowHalfAngle(r))) / 2;
export const clockRate = (r) => Math.sqrt(1 - 2 / r);
