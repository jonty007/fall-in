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

// all text is warm white; hierarchy comes from typeface, size and opacity
const FONTS = {
  question: { family: 'Cormorant Garamond', style: 'italic', weight: 400, size: 70, spacing: 0.01, alpha: 1 },
  headline: { family: 'Cormorant Garamond', style: 'normal', weight: 500, size: 64, spacing: 0.01, alpha: 1 },
  caption: { family: 'Jost', style: 'normal', weight: 400, size: 38, spacing: 0.015, alpha: 0.94 },
  title: { family: 'Jost', style: 'normal', weight: 300, size: 132, spacing: 0.32, alpha: 1 },
  credit: { family: 'Jost', style: 'normal', weight: 400, size: 34, spacing: 0.03, alpha: 0.86 },
  mono: { family: 'IBM Plex Mono', style: 'normal', weight: 400, size: 26, spacing: 0.01, alpha: 0.8 },
  cite: { family: 'Jost', style: 'normal', weight: 400, size: 30, spacing: 0.02, alpha: 0.8 },
  label: { family: 'Jost', style: 'normal', weight: 400, size: 26, spacing: 0.02, alpha: 0.88 },
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
export const PHOTON_MAIN = { st: 1.0, dur: 5.6 };
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
// Rich text: subscripts (ₛ), superscripts (¹²³⁴) and a drawn "≈", because none of the
// three typefaces carries those glyphs and a system fallback would not match.
const SUB = { 'ₛ': 's' }, SUP = { '¹': '1', '²': '2', '³': '3', '⁴': '4' };
function runs(str) {
  const out = [];
  let buf = '';
  const flush = () => { if (buf) { out.push({ t: 'n', s: buf }); buf = ''; } };
  for (const ch of str) {
    if (SUB[ch]) { flush(); out.push({ t: 'sub', s: SUB[ch] }); }
    else if (SUP[ch]) { flush(); out.push({ t: 'sup', s: SUP[ch] }); }
    else if (ch === '≈') { flush(); out.push({ t: 'approx' }); }
    else buf += ch;
  }
  flush();
  return out;
}

export class Overlay {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.off = document.createElement('canvas');
    this.off.width = canvas.width; this.off.height = canvas.height;
    this.octx = this.off.getContext('2d');
  }

  draw(t, cam) {
    const ctx = this.ctx;
    const s = this.canvas.width / 1920;
    this.s = s;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(s, 0, 0, s, 0, 0);
    ctx.textBaseline = 'alphabetic';

    for (const p of PANELS) {
      const a = this.env(t, p.t0, p.t1, 0.9);
      if (a > 0) this.panel(p, t - p.t0, a);
    }
    for (const l of LABELS) {
      const a = this.env(t, l.t0, l.t1, 0.5);
      if (a > 0) this.label(l.kind, t, a);
    }
    for (const r of READOUTS) {
      const a = this.env(t, r.t0, r.t1, 0.7);
      if (a <= 0) continue;
      const lines = r.lines(t, cam, PHYS);
      lines.forEach((line, i) => this.text(line, 'mono', r.x, r.y + i * 38, a, r.align));
    }
    for (const c of CUES) {
      const a = this.env(t, c.t0, c.t1, c.fade ?? 0.7);
      if (a <= 0) continue;
      const rise = (1 - smootherstep(c.t0, c.t0 + 1.1, t)) * 10;
      this.text(c.text, c.kind, c.x, c.y + rise, a, c.align);
    }
  }

  env(t, t0, t1, fade) {
    if (t < t0 || t > t1) return 0;
    return smoothstep(t0, t0 + fade, t) * (1 - smoothstep(t1 - fade, t1, t));
  }

  font(f, scale = 1) { return `${f.style} ${f.weight} ${f.size * scale}px "${f.family}"`; }

  measure(ctx, str, f) {
    let w = 0;
    for (const r of runs(str)) w += this.runWidth(ctx, r, f);
    return w;
  }
  runWidth(ctx, r, f) {
    if (r.t === 'approx') return f.size * 0.62;
    const sc = r.t === 'n' ? 1 : 0.64;
    ctx.font = this.font(f, sc);
    ctx.letterSpacing = `${f.spacing * f.size * sc}px`;
    return ctx.measureText(r.s).width;
  }
  drawRuns(ctx, str, f, x, y, fill) {
    let cx = x;
    for (const r of runs(str)) {
      const w = this.runWidth(ctx, r, f);
      if (r.t === 'approx') {
        // two gentle waves, on the maths axis of the current size
        const em = f.size, lw = Math.max(1.6, em * (f.weight >= 500 ? 0.065 : 0.055));
        ctx.save();
        ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.strokeStyle = fill;
        for (const dy of [-0.40, -0.21]) {
          ctx.beginPath();
          const x0 = cx + em * 0.08, x1 = cx + em * 0.54, yy = y + dy * em;
          for (let k = 0; k <= 16; k++) {
            const u = k / 16;
            const px = x0 + (x1 - x0) * u, py = yy - Math.sin(u * Math.PI * 2) * em * 0.055;
            if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
          }
          ctx.stroke();
        }
        ctx.restore();
      } else {
        const dy = r.t === 'sub' ? f.size * 0.17 : r.t === 'sup' ? -f.size * 0.36 : 0;
        ctx.fillText(r.s, cx, y + dy);
      }
      cx += w;
    }
  }

  text(str, kind, x, y, alpha, align = 'left') {
    const ctx = this.ctx;
    const f = FONTS[kind];
    ctx.save();
    ctx.textAlign = 'left';
    let w = this.measure(ctx, str, f);
    // canvas letter-spacing pads after the last glyph; exclude it from alignment
    w -= f.spacing * f.size;
    const x0 = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    // legibility: a soft dark halo behind the glyphs, then the crisp glyphs on top
    ctx.globalAlpha = alpha * 0.8;
    ctx.shadowColor = '#000';
    ctx.shadowBlur = (kind === 'title' ? 44 : 24) * this.s;
    ctx.fillStyle = '#000';
    this.drawRuns(ctx, str, f, x0, y, '#000');
    ctx.shadowBlur = 0;
    ctx.globalAlpha = alpha * f.alpha;
    ctx.fillStyle = COL.white;
    this.drawRuns(ctx, str, f, x0, y, COL.white);
    ctx.restore();
  }

  // label inside a diagram: black knockout stroke so lines never cut through it
  dlabel(ctx, str, x, y, a, align = 'left') {
    const f = FONTS.label;
    ctx.save();
    ctx.textAlign = 'left';
    let w = this.measure(ctx, str, f) - f.spacing * f.size;
    const x0 = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.filter = 'blur(6px)';
    ctx.fillRect(x0 - 10, y - f.size * 0.85, w + 20, f.size * 1.25);
    ctx.filter = 'none';
    ctx.globalAlpha = a * f.alpha;
    ctx.fillStyle = COL.white;
    this.drawRuns(ctx, str, f, x0, y, COL.white);
    ctx.restore();
  }

  // -------------------------------------------------------------------------
  path(ctx, pts, map, prog, style, headGlow = true) {
    const n = Math.max(2, Math.floor(pts.length * prog));
    ctx.save();
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
      const g = ctx.createRadialGradient(X, Y, 0, X, Y, 16);
      g.addColorStop(0, rgba(COL.white, 0.95));
      g.addColorStop(0.25, rgba(style.head || COL.ember, 0.6));
      g.addColorStop(1, rgba(style.head || COL.ember, 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(X, Y, 16, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  hole(ctx, cx, cy, scale, { photonSphere = false, isco = false } = {}) {
    ctx.save();
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.arc(cx, cy, 2 * scale, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = rgba(COL.white, 0.75); ctx.lineWidth = 1.6;
    ctx.stroke();
    if (photonSphere) {
      ctx.setLineDash([6, 8]);
      ctx.strokeStyle = rgba(COL.white, 0.6);
      ctx.beginPath(); ctx.arc(cx, cy, 3 * scale, 0, Math.PI * 2); ctx.stroke();
    }
    if (isco) {
      ctx.setLineDash([2, 7]);
      ctx.strokeStyle = rgba(COL.white, 0.7);
      ctx.beginPath(); ctx.arc(cx, cy, 6 * scale, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }

  // Diagrams are drawn on an offscreen layer, then composited through a soft radial
  // mask: no box, no hard edge; lines fade out instead of being clipped.
  beginDiagram() {
    const o = this.octx;
    o.setTransform(1, 0, 0, 1, 0, 0);
    o.clearRect(0, 0, this.off.width, this.off.height);
    o.setTransform(this.s, 0, 0, this.s, 0, 0);
    return o;
  }
  endDiagram(cx, cy, rx, ry, a) {
    const o = this.octx;
    o.save();
    o.setTransform(this.s, 0, 0, this.s, 0, 0);
    o.globalCompositeOperation = 'destination-in';
    o.translate(cx, cy); o.scale(rx, ry);
    const g = o.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.72, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    o.fillStyle = g;
    o.fillRect(-1, -1, 2, 2);
    o.restore();
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = a;
    ctx.drawImage(this.off, 0, 0);
    ctx.restore();
  }

  panel(p, lt, a) {
    const ctx = this.ctx;
    if (p.id === 'rays') {
      // side view, right of frame
      const sc = 19, cx = 1560, cy = 540;
      const map = ([x, y]) => [cx + x * sc, cy - y * sc];
      const o = this.beginDiagram();
      const grad = o.createLinearGradient(cx - 24 * sc, 0, cx + 24 * sc, 0);
      grad.addColorStop(0, rgba(COL.ember, 0)); grad.addColorStop(0.25, rgba(COL.ember, 0.9));
      grad.addColorStop(0.5, rgba(COL.white, 0.9)); grad.addColorStop(0.75, rgba(COL.ember, 0.9)); grad.addColorStop(1, rgba(COL.ember, 0));
      o.fillStyle = grad;
      o.fillRect(cx - 24 * sc, cy - 2, 18 * sc, 4);
      o.fillRect(cx + 6 * sc, cy - 2, 18 * sc, 4);
      this.hole(o, cx, cy, sc);
      for (const ray of RAYS_GEO.rays) {
        const prog = smootherstep(ray.st, ray.st + RAY_DRAW, lt);
        if (prog <= 0) continue;
        const hot = ray.kind !== 'near';
        this.path(o, ray.pts, map, prog, { color: rgba(hot ? COL.ember : COL.white, hot ? 0.95 : 0.4), width: hot ? 2.4 : 1.4 });
      }
      this.endDiagram(cx, cy, 330, 300, a);
      const la = a * smoothstep(3.5, 4.5, lt);
      this.text('Light paths, seen from the side', 'label', cx, 262, la, 'center');
      this.dlabel(ctx, 'far side of the disk', cx - 210, cy + 48, la, 'center');
      this.dlabel(ctx, 'toward you', cx + 230, cy - 128, la, 'center');
    } else if (p.id === 'photon') {
      // full-frame interlude over the dimmed shot: top view of the critical ray
      const sc = 42, cx = 700, cy = 560;
      const map = ([x, y]) => [cx + x * sc, cy - y * sc];
      const o = this.beginDiagram();
      this.hole(o, cx, cy, sc, { photonSphere: true });
      PHOTON_GEO.forEach((ray, i) => {
        const st = ray.main ? PHOTON_MAIN.st : 0.6 + i * 0.25;
        const prog = smootherstep(st, st + (ray.main ? PHOTON_MAIN.dur : 3.0), lt);
        if (prog <= 0) return;
        this.path(o, ray.pts, map, prog, ray.main ? { color: rgba(COL.white, 0.95), width: 2.6, head: COL.white } : { color: rgba(COL.ember, 0.55), width: 1.6 });
      });
      this.endDiagram(cx, cy, 620, 440, a);
      const la = a * smoothstep(1.6, 2.6, lt);
      this.text('Top view of one ray, traced', 'label', cx, 790, la, 'center');
      this.dlabel(ctx, 'photon sphere, 1.5 rₛ', cx, cy - 3 * sc - 22, la, 'center');
      this.dlabel(ctx, 'event horizon, 1 rₛ', cx, cy + 6, la * 0.9, 'center');
    } else if (p.id === 'isco') {
      // small inset, lower right
      const sc = 21, cx = 1610, cy = 744;
      const map = ([x, y]) => [cx + x * sc, cy - y * sc];
      const o = this.beginDiagram();
      this.hole(o, cx, cy, sc, { isco: true });
      this.path(o, ISCO_GEO.stable, map, smootherstep(0.8, 8.5, lt), { color: rgba(COL.white, 0.85), width: 1.8, head: COL.white });
      this.path(o, ISCO_GEO.plunge, map, smootherstep(PLUNGE.st, PLUNGE.st + PLUNGE.dur, lt), { color: rgba(COL.ember, 0.95), width: 2.2 });
      this.endDiagram(cx, cy, 250, 250, a);
      const la = a * smoothstep(2.0, 3.0, lt);
      this.dlabel(ctx, 'last stable orbit, 3 rₛ', cx, cy - 6 * sc - 18, la, 'center');
      ctx.save(); ctx.globalAlpha = la;
      ctx.fillStyle = rgba(COL.white, 0.85); ctx.fillRect(cx - 170, cy + 208, 32, 2.5);
      ctx.fillStyle = rgba(COL.ember, 0.95); ctx.fillRect(cx - 170, cy + 246, 32, 2.5);
      ctx.restore();
      this.text('released at 3.4 rₛ: stable', 'label', cx - 126, cy + 217, la);
      this.text('released at 2.9 rₛ: plunges', 'label', cx - 126, cy + 255, la);
    }
  }

  label(kind, t, a) {
    const ctx = this.ctx;
    if (kind === 'divider') {
      const x = effectsAt(t).wipe[0] * 1920;
      if (x > 4 && x < 1916) {
        ctx.save(); ctx.globalAlpha = a * 0.85;
        const g = ctx.createLinearGradient(0, 300, 0, 900);
        g.addColorStop(0, rgba(COL.white, 0)); g.addColorStop(0.2, rgba(COL.white, 0.85)); g.addColorStop(0.8, rgba(COL.white, 0.85)); g.addColorStop(1, rgba(COL.white, 0));
        ctx.fillStyle = g;
        ctx.fillRect(x - 0.75, 300, 1.5, 600);
        ctx.restore();
        const lx = Math.min(Math.max(x, 330), 1590);
        this.text('without Doppler', 'label', lx - 22, 330, a, 'right');
        this.text('with Doppler', 'label', lx + 22, 330, a, 'left');
      }
    } else if (kind === 'teleDivider') {
      const x = effectsAt(t).teleSplit[0] * 1920;
      if (x > 4 && x < 1916) {
        ctx.save(); ctx.globalAlpha = a * 0.85;
        const g = ctx.createLinearGradient(0, 280, 0, 860);
        g.addColorStop(0, rgba(COL.white, 0)); g.addColorStop(0.2, rgba(COL.white, 0.85)); g.addColorStop(0.8, rgba(COL.white, 0.85)); g.addColorStop(1, rgba(COL.white, 0));
        ctx.fillStyle = g;
        ctx.fillRect(x - 0.75, 280, 1.5, 580);
        ctx.restore();
        const lx = Math.min(Math.max(x, 260), 1560);
        this.text('sharp', 'label', lx - 22, 320, a, 'right');
        this.text('at EHT sharpness, ≈ 20 µas', 'label', lx + 22, 320, a, 'left');
      }
    }
  }
}
