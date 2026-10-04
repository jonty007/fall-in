// Text and diagram layer: a 2D canvas above the WebGL canvas, drawn in a
// 1920x1080 design space at device resolution. Never blurred, never graded.
import { CUES, READOUTS, PANELS, LABELS, smoothstep, smootherstep, effectsAt } from './timeline.js';
import * as P from './physics.js';

const COL = {
  white: '#FFF3E3',      // white-hot
  ember: '#FF8A3D',      // blackbody ~2000 K
  star: '#BFD4FF',       // starlight
};
const rgba = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

const FONTS = {
  question: { font: 'italic 400 70px "Cormorant Garamond"', color: COL.white, spacing: '0.01em' },
  headline: { font: '500 64px "Cormorant Garamond"', color: COL.white, spacing: '0.01em' },
  caption: { font: '400 38px "Jost"', color: COL.white, spacing: '0.015em', alpha: 0.92 },
  title: { font: '300 132px "Jost"', color: COL.white, spacing: '0.55em' },
  credit: { font: '400 36px "Jost"', color: COL.white, spacing: '0.04em', alpha: 0.86 },
  mono: { font: '400 25px "IBM Plex Mono"', color: COL.star, spacing: '0.02em', alpha: 0.9 },
  cite: { font: '400 24px "IBM Plex Mono"', color: COL.star, spacing: '0.02em', alpha: 0.82 },
  label: { font: '400 21px "IBM Plex Mono"', color: COL.star, spacing: '0.08em', alpha: 0.85 },
};

// physics values shown on screen: computed from the formulas, never typed in
const PHYS = (() => {
  const ph = P.photonSphereNumerical();
  const isco = P.iscoNumerical();
  const bTan = isco.r / Math.sqrt(1 - 2 / isco.r); // photon emitted along the orbit at the ISCO
  return {
    ph, isco,
    gApp: P.diskG(isco.r, bTan), gRec: P.diskG(isco.r, -bTan),
    clockRate: P.clockRate,
  };
})();
export { PHYS };
export const geometry = () => ({ RAYS_GEO, PHOTON_GEO, ISCO_GEO });

// ---------------------------------------------------------------------------
// Diagram geometry (computed once, deterministic)
// ---------------------------------------------------------------------------
function traceCartesian(x, y, dx, dy, { maxLen = 200, stop }) {
  // null geodesic in the orbital plane: x'' = -3 M h^2 x / r^5 (exact orbit shape)
  const pts = [[x, y]];
  const n0 = Math.hypot(dx, dy);
  let vx = dx / n0, vy = dy / n0;
  const h2 = (x * vy - y * vx) ** 2;
  const acc = (px, py) => { const r2 = px * px + py * py; const r5 = r2 * r2 * Math.sqrt(r2); return [-3 * h2 * px / r5, -3 * h2 * py / r5]; };
  let len = 0;
  for (let i = 0; i < 40000 && len < maxLen; i++) {
    const r = Math.hypot(x, y);
    const ds = Math.min(0.05, 0.01 * r);
    const [a1x, a1y] = acc(x, y);
    const [a2x, a2y] = acc(x + 0.5 * ds * vx, y + 0.5 * ds * vy);
    const k2vx = vx + 0.5 * ds * a1x, k2vy = vy + 0.5 * ds * a1y;
    const [a3x, a3y] = acc(x + 0.5 * ds * k2vx, y + 0.5 * ds * k2vy);
    const k3vx = vx + 0.5 * ds * a2x, k3vy = vy + 0.5 * ds * a2y;
    const [a4x, a4y] = acc(x + ds * k3vx, y + ds * k3vy);
    const k4vx = vx + ds * a3x, k4vy = vy + ds * a3y;
    const nx = x + (ds / 6) * (vx + 2 * k2vx + 2 * k3vx + k4vx);
    const ny = y + (ds / 6) * (vy + 2 * k2vy + 2 * k3vy + k4vy);
    vx += (ds / 6) * (a1x + 2 * a2x + 2 * a3x + a4x);
    vy += (ds / 6) * (a1y + 2 * a2y + 2 * a3y + a4y);
    len += Math.hypot(nx - x, ny - y);
    const res = stop && stop(x, y, nx, ny);
    x = nx; y = ny;
    pts.push([x, y]);
    if (res) return { pts, end: res };
    if (Math.hypot(x, y) < 2.0) return { pts, end: 'horizon' };
  }
  return { pts, end: 'out' };
}

// Side view for "gravity bends light": rays from the camera (right, 8 deg above
// the disk plane) traced back until they meet the disk. Drawn as light flowing
// from the disk to the camera.
const RAYS_GEO = (() => {
  const camR = 44, camEl = (5 * Math.PI) / 180;
  const cx = camR * Math.cos(camEl), cy = camR * Math.sin(camEl);
  const toHole = Math.atan2(-cy, -cx);
  const shoot = (o) => {
    const a = toHole + o;
    return traceCartesian(cx, cy, Math.cos(a), Math.sin(a), {
      maxLen: 140,
      stop: (x0, y0, x1, y1) => {
        if (y0 * y1 <= 0) {
          const xs = x0 + (x1 - x0) * (y0 / (y0 - y1));
          if (Math.abs(xs) >= 6 && Math.abs(xs) <= 30) return xs < 0 ? (y0 < 0 ? 'under' : 'far') : 'near';
        }
        return null;
      },
    });
  };
  const out = [];
  // scan the fan of directions; keep a few rays of each kind
  const found = { far: [], under: [], near: [] };
  for (let o = -0.3; o <= 0.3; o += 0.0025) {
    const r = shoot(o);
    if (found[r.end]) found[r.end].push({ o, r });
  }
  const pick = (arr, n) => (arr.length <= n ? arr : Array.from({ length: n }, (_, i) => arr[Math.round((i * (arr.length - 1)) / (n - 1))]));
  // start times (s after the panel appears); each ray takes RAY_DRAW s to reach the camera
  pick(found.near, 3).forEach(({ r }, j) => out.push({ pts: r.pts.slice().reverse(), kind: 'near', st: 0.6 + j * 0.25 }));
  pick(found.far, 4).forEach(({ r }, j) => out.push({ pts: r.pts.slice().reverse(), kind: 'far', st: 1.6 + j * 0.5 }));
  pick(found.under, 3).forEach(({ r }, j) => out.push({ pts: r.pts.slice().reverse(), kind: 'under', st: 5.0 + j * 0.45 }));
  return { rays: out, cam: [cx, cy] };
})();


export const RAY_DRAW = 2.6;
export const PHOTON_MAIN = { st: 1.4, dur: 8.0 };
export const PLUNGE = { st: 1.6, dur: 6.4 };

// Top view for the photon sphere: parallel rays from the left at impact parameters near sqrt(27) M
const PHOTON_GEO = (() => {
  const bc = Math.sqrt(27);
  const set = [
    { b: bc * (1 + 2e-6), main: true },
    { b: bc * 1.06 }, { b: bc * 1.22 }, { b: bc * 0.985 }, { b: bc * 0.9 },
  ];
  return set.map((s) => {
    const r = traceCartesian(-60, s.b, 1, 0, { maxLen: 260, stop: (x0, y0, x1, y1) => (x1 < -60 || x1 > 60 || Math.abs(y1) > 60 ? 'out' : null) });
    return { ...s, pts: r.pts, end: r.end };
  });
})();

// Top view for the ISCO: one stable precessing orbit and one plunge (timelike geodesics)
const ISCO_GEO = (() => {
  const stableR = 6.8, plungeR = 5.8;
  const st = P.traceMatter({ r0: stableR, L: P.circularL(stableR) * 1.02, dphi: 0.01, maxPhi: 6 * Math.PI });
  const pl = P.traceMatter({ r0: plungeR, L: P.circularL(plungeR) * 0.999, ur0: 0.0, dphi: 0.01, maxPhi: 30 * Math.PI });
  const toXY = (pts) => pts.map(([r, phi]) => [r * Math.cos(phi), r * Math.sin(phi)]);
  return { stable: toXY(st.pts), plunge: toXY(pl.pts), plunged: pl.plunged, stableR, plungeR };
})();

// ---------------------------------------------------------------------------
export class Overlay {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
  }

  draw(t, cam) {
    const ctx = this.ctx;
    const s = this.canvas.width / 1920;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(s, 0, 0, s, 0, 0);
    ctx.textBaseline = 'alphabetic';

    for (const p of PANELS) {
      const a = this.env(t, p.t0, p.t1, 0.8);
      if (a > 0) this.panel(p.id, t - p.t0, p.t1 - p.t0, a);
    }
    for (const l of LABELS) {
      const a = this.env(t, l.t0, l.t1, 0.5);
      if (a > 0) this.label(l.kind, t, a);
    }
    for (const r of READOUTS) {
      const a = this.env(t, r.t0, r.t1, 0.7);
      if (a <= 0) continue;
      const lines = r.lines(t, cam, PHYS);
      lines.forEach((line, i) => this.text(line, 'mono', r.x, r.y + i * 36, a, r.align));
    }
    for (const c of CUES) {
      const a = this.env(t, c.t0, c.t1, c.fade ?? 0.7);
      if (a <= 0) continue;
      const rise = (1 - smootherstep(c.t0, c.t0 + 1.1, t)) * 10;
      let spacing;
      if (c.kind === 'title') spacing = `${(0.55 + 0.12 * (1 - smootherstep(c.t0, c.t1, t))).toFixed(3)}em`;
      this.text(c.text, c.kind, c.x, c.y + rise, a, c.align, spacing);
    }
  }

  env(t, t0, t1, fade) {
    if (t < t0 || t > t1) return 0;
    return smoothstep(t0, t0 + fade, t) * (1 - smoothstep(t1 - fade, t1, t));
  }

  text(str, kind, x, y, alpha, align = 'left', spacing) {
    const ctx = this.ctx;
    const f = FONTS[kind];
    ctx.save();
    ctx.font = f.font;
    ctx.letterSpacing = spacing || f.spacing || '0px';
    ctx.textAlign = align;
    // legibility: a soft dark halo behind the glyphs (the glyphs themselves stay crisp)
    ctx.shadowColor = `rgba(0,0,0,${0.78 * alpha})`;
    ctx.shadowBlur = kind === 'title' ? 40 : 22;
    ctx.globalAlpha = alpha * (f.alpha ?? 1);
    ctx.fillStyle = f.color;
    // canvas letter-spacing also pads after the last glyph; compensate when centred
    let dx = 0;
    if (align === 'center' && ctx.letterSpacing !== '0px') {
      const em = parseFloat(ctx.letterSpacing);
      const px = parseFloat(f.font.match(/(\d+)px/)[1]);
      dx = (em * px) / 2;
    }
    ctx.fillText(str, x + dx, y);
    ctx.shadowBlur = 0;
    ctx.fillText(str, x + dx, y);
    ctx.restore();
  }

  // -------------------------------------------------------------------------
  frame(x, y, w, h, a, title) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(2,2,3,0.62)';
    ctx.fillRect(x, y, w, h);
    // corner ticks only
    ctx.strokeStyle = rgba(COL.white, 0.55);
    ctx.lineWidth = 1.5;
    const k = 18;
    ctx.beginPath();
    for (const [cx, cy, sx, sy] of [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]]) {
      ctx.moveTo(cx + sx * k, cy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy + sy * k);
    }
    ctx.stroke();
    ctx.restore();
    this.text(title, 'label', x + 24, y + 40, a);
  }

  path(pts, map, prog, style, a, headGlow = true) {
    const ctx = this.ctx;
    const n = Math.max(2, Math.floor(pts.length * prog));
    ctx.save();
    ctx.globalAlpha = a;
    ctx.strokeStyle = style.color;
    ctx.lineWidth = style.width;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const [X, Y] = map(pts[i]);
      if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
    }
    ctx.stroke();
    if (headGlow && prog > 0 && prog < 1) {
      const [X, Y] = map(pts[n - 1]);
      const g = ctx.createRadialGradient(X, Y, 0, X, Y, 14);
      g.addColorStop(0, rgba(COL.white, 0.95));
      g.addColorStop(0.25, rgba(style.head || COL.ember, 0.6));
      g.addColorStop(1, rgba(style.head || COL.ember, 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(X, Y, 14, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  hole(cx, cy, scale, a, { photonSphere = true, isco = false } = {}) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = a;
    // event horizon
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.arc(cx, cy, 2 * scale, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = rgba(COL.white, 0.7); ctx.lineWidth = 1.5;
    ctx.stroke();
    if (photonSphere) {
      ctx.setLineDash([5, 7]);
      ctx.strokeStyle = rgba(COL.star, 0.55);
      ctx.beginPath(); ctx.arc(cx, cy, 3 * scale, 0, Math.PI * 2); ctx.stroke();
    }
    if (isco) {
      ctx.setLineDash([2, 6]);
      ctx.strokeStyle = rgba(COL.star, 0.75);
      ctx.beginPath(); ctx.arc(cx, cy, 6 * scale, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }

  panel(id, lt, dur, a) {
    const X = 1262, Y = 236, W = 590, H = 600;
    const ctx = this.ctx;
    if (id === 'rays') {
      this.frame(X, Y, W, H, a, 'LIGHT PATHS · SIDE VIEW');
      const sc = 19, cx = X + W / 2 + 10, cy = Y + H / 2 + 34;
      const map = ([x, y]) => [cx + x * sc, cy - y * sc];
      ctx.save(); ctx.beginPath(); ctx.rect(X, Y + 56, W, H - 56); ctx.clip();
      // disk, edge-on
      ctx.globalAlpha = a;
      const grad = ctx.createLinearGradient(cx - 22 * sc, 0, cx + 22 * sc, 0);
      grad.addColorStop(0, rgba(COL.ember, 0.0)); grad.addColorStop(0.3, rgba(COL.ember, 0.9));
      grad.addColorStop(0.5, rgba(COL.white, 0.9)); grad.addColorStop(0.7, rgba(COL.ember, 0.9)); grad.addColorStop(1, rgba(COL.ember, 0));
      ctx.fillStyle = grad;
      ctx.fillRect(cx - 22 * sc, cy - 2, 16 * sc, 4);
      ctx.fillRect(cx + 6 * sc, cy - 2, 16 * sc, 4);
      ctx.restore();
      this.hole(cx, cy, sc, a, { photonSphere: false });
      // rays: light leaves the disk and bends toward the camera
      RAYS_GEO.rays.forEach((ray) => {
        const prog = smootherstep(ray.st, ray.st + RAY_DRAW, lt);
        if (prog <= 0) return;
        const hot = ray.kind !== 'near';
        ctx.save(); ctx.beginPath(); ctx.rect(X, Y + 56, W, H - 56); ctx.clip();
        this.path(ray.pts, map, prog, { color: rgba(hot ? COL.ember : COL.star, hot ? 0.95 : 0.45), width: hot ? 2.4 : 1.4 }, a);
        ctx.restore();
      });
      const la = a * smoothstep(3.5, 4.5, lt);
      this.text('far side', 'label', X + 26, cy + 40, la);
      this.text('to you →', 'label', X + W - 24, cy - 150, la, 'right');
      this.text('horizon', 'label', cx, cy + 74, la, 'center');
    } else if (id === 'photon') {
      this.frame(X, Y, W, H, a, 'LIGHT PATHS · TOP VIEW');
      const sc = 32, cx = X + W / 2, cy = Y + H / 2 + 30;
      const map = ([x, y]) => [cx + x * sc, cy - y * sc];
      this.hole(cx, cy, sc, a, { photonSphere: true });
      ctx.save(); ctx.beginPath(); ctx.rect(X, Y + 56, W, H - 56); ctx.clip();
      PHOTON_GEO.forEach((ray, i) => {
        const st = ray.main ? PHOTON_MAIN.st : 0.6 + i * 0.25;
        const prog = smootherstep(st, st + (ray.main ? PHOTON_MAIN.dur : 3.0), lt);
        if (prog <= 0) return;
        this.path(ray.pts, map, prog, ray.main ? { color: rgba(COL.white, 0.95), width: 2.4, head: COL.white } : { color: rgba(COL.ember, 0.5), width: 1.4 }, a);
      });
      ctx.restore();
      const la = a * smoothstep(2.0, 3.0, lt);
      this.text('photon sphere  r = 1.5 rₛ', 'label', cx, cy - 3 * sc - 18, la, 'center');
      this.text('b = √27 M ≈ 2.60 rₛ', 'label', X + 26, Y + H - 28, la);
    } else if (id === 'isco') {
      this.frame(X, Y, W, H, a, 'PARTICLE ORBITS · TOP VIEW');
      const sc = 27, cx = X + W / 2, cy = Y + H / 2 + 6;
      const map = ([x, y]) => [cx + x * sc, cy - y * sc];
      this.hole(cx, cy, sc, a, { photonSphere: false, isco: true });
      ctx.save(); ctx.beginPath(); ctx.rect(X, Y + 56, W, H - 56); ctx.clip();
      this.path(ISCO_GEO.stable, map, smootherstep(0.8, 8.5, lt), { color: rgba(COL.star, 0.85), width: 1.8, head: COL.star }, a);
      this.path(ISCO_GEO.plunge, map, smootherstep(PLUNGE.st, PLUNGE.st + PLUNGE.dur, lt), { color: rgba(COL.ember, 0.95), width: 2.2 }, a);
      ctx.restore();
      const la = a * smoothstep(2.0, 3.0, lt);
      this.text('last stable orbit 3 rₛ', 'label', cx, cy - 6 * sc - 14, la, 'center');
      ctx.save(); ctx.globalAlpha = la;
      ctx.fillStyle = rgba(COL.star, 0.85); ctx.fillRect(X + 26, Y + H - 66, 34, 2.5);
      ctx.fillStyle = rgba(COL.ember, 0.95); ctx.fillRect(X + 26, Y + H - 36, 34, 2.5);
      ctx.restore();
      this.text('starts at 3.4 rₛ: stable', 'label', X + 72, Y + H - 58, la);
      this.text('starts at 2.9 rₛ: plunges', 'label', X + 72, Y + H - 28, la);
    }
  }

  label(kind, t, a) {
    const ctx = this.ctx;
    if (kind === 'divider') {
      const x = effectsAt(t).wipe[0] * 1920;
      if (x > 4 && x < 1916) {
        ctx.save(); ctx.globalAlpha = a * 0.8;
        ctx.fillStyle = rgba(COL.white, 0.85);
        ctx.fillRect(x - 0.75, 280, 1.5, 560);
        ctx.restore();
        this.text('WITHOUT DOPPLER', 'label', x - 20, 300, a, 'right');
        this.text('WITH DOPPLER', 'label', x + 20, 300, a, 'left');
      } else if (x >= 1916) {
        this.text('RENDERED WITHOUT DOPPLER SHIFT, AS IN INTERSTELLAR', 'label', 1800, 1004, a, 'right');
      }
    } else if (kind === 'teleDivider') {
      const x = effectsAt(t).teleSplit[0] * 1920;
      if (x > 4 && x < 1916) {
        ctx.save(); ctx.globalAlpha = a * 0.8;
        ctx.fillStyle = rgba(COL.white, 0.85);
        ctx.fillRect(x - 0.75, 300, 1.5, 480);
        ctx.restore();
        this.text('OUR RENDER', 'label', x - 20, 320, a, 'right');
        this.text('AT EHT RESOLUTION ≈ 20 µas', 'label', x + 20, 320, a, 'left');
      }
    }
  }
}
