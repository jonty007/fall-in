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

export function frameState(t) {
  const cam = cameraAt(t);
  const fx = effectsAt(t);
  const pos = sph(cam.r, cam.incl, cam.az);
  const basis = lookBasis(pos, { yaw: cam.yaw, pitch: cam.pitch, roll: cam.roll });
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
      tPeak: 4300, rIn: 6, rOut: 30,
      wipe: fx.wipe,
      diskGain: 1, starGain: fx.starBoost, galaxyGain: 0.0005 * Math.pow(fx.starBoost, 0.9), spin: 1,
      exposure: cam.exposure * fx.dim,
      bloomThreshold: 2.4, bloomStrength: 0.12,
      teleSplit: fx.teleSplit, teleSigmaPx,
      fade: fx.fade,
      frame: Math.round(t * FPS),
      grainPx: dpr,
      vignette: 0.22,
      look: [1, 1, 1],
      scrims: scrimsAt(t),
    },
  };
}

window.duration = DURATION;
window.fps = FPS;
window.rendererName = renderer.rendererName;
window.seek = async (t, opts = {}) => {
  const st = frameState(t);
  await renderer.render(st.render, { tileRows: opts.tileRows ?? 135 });
  overlay.draw(t, st.cam);
  // let the compositor pick up both canvases
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  return st.cam;
};

await Promise.all([
  document.fonts.load('500 64px "Cormorant Garamond"'),
  document.fonts.load('italic 400 70px "Cormorant Garamond"'),
  document.fonts.load('300 132px "Jost"'),
  document.fonts.load('400 38px "Jost"'),
  document.fonts.load('400 25px "IBM Plex Mono"'),
]);
await document.fonts.ready;
window.ready = true;

// viewing aid: ?t=42 shows that moment (the renderer itself always calls seek explicitly)
const qt = new URLSearchParams(location.search).get('t');
if (qt !== null) window.seek(Number(qt));
