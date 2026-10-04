// FALL IN — page entry. Exposes window.seek(t) and window.duration.
// Every frame is a pure function of t: no clocks, no accumulated state.
import { Renderer } from './renderer.js';
import { Overlay } from './overlay.js';
import { sph, lookBasis } from './camera.js';
import { DURATION, FPS, cameraAt, effectsAt, scrimsAt } from './timeline.js';

const glCanvas = document.getElementById('gl');
const uiCanvas = document.getElementById('ui');
const dpr = window.devicePixelRatio || 1;
for (const c of [glCanvas, uiCanvas]) {
  c.width = Math.round(window.innerWidth * dpr);
  c.height = Math.round(window.innerHeight * dpr);
}

const renderer = new Renderer(glCanvas);
const overlay = new Overlay(uiCanvas);

// look-dev only: ?ev=-1 renders one stop darker (never set by the render scripts)
const EV = Math.pow(2, Number(new URLSearchParams(location.search).get('ev') || 0));
const LOOKSAT = Number(new URLSearchParams(location.search).get('sat') || 0.85);
const SHUTTER = Number(new URLSearchParams(location.search).get('shutter') ?? 1) || 1e-3;   // look-dev: streak-length check

export function frameState(t) {
  const cam = cameraAt(t);
  const fx = effectsAt(t);
  const pos = sph(cam.r, cam.incl, cam.az);
  const basis = lookBasis(pos, { yaw: cam.yaw, pitch: cam.pitch, roll: cam.roll });
  // the camera's motion while a 180-degree shutter is open, for the stars' motion blur: its
  // rotation about the hole, its own turn relative to that, and its change of distance
  const h = (0.25 / FPS) * SHUTTER;
  const ca = cameraAt(t - h), cb = cameraAt(t + h);
  const pa = sph(ca.r, ca.incl, ca.az), pb = sph(cb.r, cb.incl, cb.az);
  const cr = [pa[1] * pb[2] - pa[2] * pb[1], pa[2] * pb[0] - pa[0] * pb[2], pa[0] * pb[1] - pa[1] * pb[0]];
  const crn = Math.hypot(...cr), ang = Math.atan2(crn, pa[0] * pb[0] + pa[1] * pb[1] + pa[2] * pb[2]);
  const omega = crn > 0 ? cr.map((v) => (v / crn) * ang) : [0, 0, 0];
  const Ba = lookBasis(pa, { yaw: ca.yaw, pitch: ca.pitch, roll: ca.roll });
  const Bb = lookBasis(pb, { yaw: cb.yaw, pitch: cb.pitch, roll: cb.roll });
  // rotation vector of Rb * Ra^T (camera basis vectors as columns), small-angle log map
  const cols = (B) => [B.camRight, B.camUp, B.camFwd];
  const A = cols(Ba), Bc = cols(Bb);
  const R = (i, j) => Bc[0][i] * A[0][j] + Bc[1][i] * A[1][j] + Bc[2][i] * A[2][j];
  const vee = [(R(2, 1) - R(1, 2)) / 2, (R(0, 2) - R(2, 0)) / 2, (R(1, 0) - R(0, 1)) / 2];
  const sn = Math.hypot(...vee), th = Math.asin(Math.min(1, sn));
  const rotB = sn > 1e-12 ? vee.map((v) => (v / sn) * th) : [0, 0, 0];
  const viewRot = rotB.map((v, i) => v - omega[i]);
  const dr = cb.r - ca.r;
  // telescope blur: EHT resolution (~20 µas) relative to the M87* ring (42 µas)
  // applied to our ring (2 x 1.04 x sqrt(27) M across), as a Gaussian sigma in device pixels
  const ringM = 2 * 1.04 * Math.sqrt(27);
  const fwhmM = ringM * (20 / 42);
  const pxPerRad = (glCanvas.height / 2) / Math.tan((cam.fov * Math.PI) / 360);
  const teleSigmaPx = (fwhmM / cam.r) * pxPerRad / 2.355;
  return {
    cam,
    render: {
      ...basis,
      fov: cam.fov,
      diskTime: fx.diskTime,
      tPeak: 4500, rIn: 6, rOut: 30,
      wipe: fx.wipe,
      diskGain: 1, starGain: 1.3 * fx.starBoost, galaxyGain: 0.00035 * Math.pow(fx.starBoost, 0.7), spin: 1, omega, viewRot, dr,
      exposure: cam.exposure * fx.dim * EV,
      bloomThreshold: 2.4, bloomStrength: 0.12,
      teleSplit: fx.teleSplit, teleSigmaPx,
      fade: fx.fade,
      frame: Math.round(t * FPS),
      grainPx: dpr,
      vignette: 0.22,
      look: [1, LOOKSAT, 1],
      compress: [0.35, 0.6],
      scrims: scrimsAt(t),
    },
  };
}

window.duration = DURATION;
window.fps = FPS;
window.rendererName = renderer.rendererName;
const query = new URLSearchParams(location.search);
const noUi = query.has('noui');       // picture only, for exposure measurements
const uiOnly = query.has('uionly');   // text and diagrams only, over black, for layout checks
if (uiOnly) uiCanvas.style.display = 'block';
window.seek = async (t, opts = {}) => {
  const st = frameState(t);
  if (!noUi) { overlay.draw(t, st.cam); st.render.textMasks = overlay.textMasks(); }
  window.overlayIssues = overlay.issues;
  if (!uiOnly) await renderer.render(st.render, { tileRows: opts.tileRows ?? 135, ui: noUi || overlay.empty ? null : uiCanvas });
  // let the compositor pick up both canvases
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  return st.cam;
};

await Promise.all([
  document.fonts.load('500 64px "Cormorant Garamond"'),
  document.fonts.load('italic 400 70px "Cormorant Garamond"'),
  document.fonts.load('italic 500 64px "Cormorant Garamond"'),
  document.fonts.load('300 132px "Jost"'),
  document.fonts.load('400 38px "Jost"'),
  document.fonts.load('400 25px "IBM Plex Mono"'),
]);
await document.fonts.ready;
window.ready = true;

// viewing aid: ?t=42 shows that moment (the renderer itself always calls seek explicitly)
const qt = query.get('t');
if (qt !== null) window.seek(Number(qt));
