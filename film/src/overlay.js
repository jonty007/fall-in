// Text and diagram layer: a 2D canvas above the WebGL canvas, drawn in a
// 1920x1080 design space at device resolution. Never blurred, never graded.
import { CUES, READOUTS, PANELS, LABELS, smoothstep, smootherstep } from './timeline.js';
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

// all text is warm white; hierarchy comes from typeface and size (diagram labels may take
// the colour of the path they name)
const FONTS = {
  question: { family: 'Cormorant Garamond', style: 'italic', weight: 400, size: 70, spacing: 0.01, alpha: 1 },
  headline: { family: 'Cormorant Garamond', style: 'normal', weight: 500, size: 64, spacing: 0.01, alpha: 1 },
  caption: { family: 'Jost', style: 'normal', weight: 400, size: 38, spacing: 0.015, alpha: 1 },
  title: { family: 'Cormorant Garamond', style: 'normal', weight: 500, size: 150, spacing: 0.14, alpha: 1 },
  credit: { family: 'Jost', style: 'normal', weight: 400, size: 34, spacing: 0.03, alpha: 0.9 },
  mono: { family: 'IBM Plex Mono', style: 'normal', weight: 400, size: 34, spacing: 0, alpha: 0.95 },
  label: { family: 'Jost', style: 'normal', weight: 400, size: 36, spacing: 0.01, alpha: 1 },
};

// physics values shown on screen: computed from the formulas, never typed in
const PHYS = (() => {
  const ph = P.photonSphereNumerical();
  const isco = P.iscoNumerical();
  const bTan = isco.r / Math.sqrt(1 - 2 / isco.r); // photon emitted along the orbit at the ISCO
  return {
    ph, isco,
    gApp: P.diskG(isco.r, bTan), gRec: P.diskG(isco.r, -bTan),
    iscoSlow: 1 - Math.sqrt(1 - 3 / isco.r),   // proper time per coordinate time on a circular orbit: sqrt(1 - 3M/r)
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

// Side view for "gravity bends light": rays from an observer (right, 5 deg above the disk
// plane, outside the disk's rim as in the shot, but nearer so the whole picture fits the
// column; the disk drawn to 18 M) traced back until they meet the disk. Drawn as light
// flowing from the disk to the observer.
const DISK_OUT = 18;
const RAYS_GEO = (() => {
  const camR = 30, camEl = (5 * Math.PI) / 180;
  const cx = camR * Math.cos(camEl), cy = camR * Math.sin(camEl);
  const toHole = Math.atan2(-cy, -cx);
  const shoot = (o) => {
    const a = toHole + o;
    return traceCartesian(cx, cy, Math.cos(a), Math.sin(a), {
      maxLen: 120,
      stop: (x0, y0, x1, y1) => {
        if (y0 * y1 <= 0) {
          const xs = x0 + (x1 - x0) * (y0 / (y0 - y1));
          if (Math.abs(xs) >= 6 && Math.abs(xs) <= DISK_OUT) return xs < 0 ? (y0 < 0 ? 'under' : 'far') : 'near';
        }
        return null;
      },
    });
  };
  const out = [];
  // scan the fan of directions; keep a few rays of each kind
  const found = { far: [], under: [], near: [] };
  for (let o = -0.6; o <= 0.6; o += 0.002) {
    const r = shoot(o);
    if (found[r.end]) found[r.end].push({ o, r });
  }
  const pick = (arr, n) => (arr.length <= n ? arr : Array.from({ length: n }, (_, i) => arr[Math.round((i * (arr.length - 1)) / (n - 1))]));
  const hitX = ({ r }) => Math.abs(r.pts[r.pts.length - 1][0]);
  found.far = found.far.filter((x) => hitX(x) >= 9 && hitX(x) <= 17);
  const rMin = ({ r }) => Math.min(...r.pts.map(([x, y]) => Math.hypot(x, y)));
  found.under = found.under.filter((x) => hitX(x) >= 9 && hitX(x) <= 17 && rMin(x) > 4.5);   // no loops round the hole
  // start times (s after the panel appears); each ray takes RAY_DRAW s to reach the observer
  pick(found.far, 3).forEach(({ r }, j) => out.push({ pts: r.pts.slice().reverse(), kind: 'far', st: 0.8 + j * 0.6 }));
  pick(found.under, 2).forEach(({ r }, j) => out.push({ pts: r.pts.slice().reverse(), kind: 'under', st: 5.0 + j * 0.6 }));
  return { rays: out, cam: [cx, cy] };
})();


export const RAY_DRAW = 2.6;
export const PHOTON_MAIN = { st: 0.6, dur: 5.2 };
export const PLUNGE = { st: 1.6, dur: 6.4 };

// Top view for the photon sphere: parallel rays from the left at impact parameters near sqrt(27) M
const PHOTON_GEO = (() => {
  const bc = Math.sqrt(27);
  const set = [
    { b: bc * (1 + 2e-6), main: true },
    { b: bc * 1.06 }, { b: bc * 0.985 },   // one neighbour escapes, one falls in
  ];
  return set.map((s) => {
    const r = traceCartesian(-60, s.b, 1, 0, { maxLen: 260, stop: (x0, y0, x1, y1) => (x1 < -60 || x1 > 60 || Math.abs(y1) > 60 ? 'out' : null) });
    return { ...s, pts: r.pts, end: r.end };
  });
})();

// Top view for the ISCO: a stable circular orbit outside it, and matter released just inside
// it (2.95 rs, 2 % below the ISCO's angular momentum) spiralling into the horizon (timelike geodesics)
const ISCO_GEO = (() => {
  const stableR = 9.0, plungeR = 5.9;
  const st = P.traceMatter({ r0: stableR, L: P.circularL(stableR), dphi: 0.01, maxPhi: 2 * Math.PI + 0.02 });
  const pl = P.traceMatter({ r0: plungeR, L: P.circularL(6) * 0.98, ur0: 0.0, dphi: 0.01, maxPhi: 30 * Math.PI });
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
    this.issues = [];
  }

  draw(t, cam) {
    const ctx = this.ctx;
    const s = this.canvas.width / 1920;
    this.s = s;
    // layout bookkeeping (design px): every text box and every visible stroke of this frame,
    // checked at the end so no label ever sits on a path and no text leaves the safe area
    this.boxes = [];
    this.lines = [];
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(s, 0, 0, s, 0, 0);
    ctx.textBaseline = 'alphabetic';

    for (const p of PANELS) {
      const a = this.env(t, p.t0, p.t1, 0.9);
      if (a > 0) this.panel(p, t - p.t0, a);
    }
    for (const l of LABELS) {
      const a = this.env(t, l.t0, l.t1, 0.6);
      if (a > 0) this.label(l.kind, t, a);
    }
    for (const r of READOUTS) {
      const a = this.env(t, r.t0, r.t1, 0.7);
      if (a <= 0) continue;
      const lines = r.lines(t, cam, PHYS);
      lines.forEach((line, i) => this.text(line, 'mono', r.x, r.y + i * 46, a, r.align));
      if (r.leader) {
        // a 1 px leader from under the block to the feature it describes
        const b0 = this.textBox(lines[lines.length - 1], 'mono', r.x, r.y + (lines.length - 1) * 46, r.align);
        const sx = r.align === 'right' ? b0.x1 - 40 : b0.x0 + 40, sy = b0.y1 + 10;
        const [ax, ay] = r.leader;
        ctx.save();
        ctx.globalAlpha = a * 0.75;
        ctx.strokeStyle = COL.white; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ax, ay); ctx.stroke();
        ctx.restore();
        this.lines.push({ pts: [[sx, sy], [ax, ay]], kind: 'readout leader', own: lines[lines.length - 1], a });
      }
    }
    for (const c of CUES) {
      const a = this.env(t, c.t0, c.t1, c.fade ?? 0.7);
      if (a <= 0) continue;
      const rise = (1 - smootherstep(c.t0, c.t0 + 1.1, t)) * 10;
      const str = typeof c.text === 'function' ? c.text(PHYS) : c.text;
      this.text(str, c.kind, c.x, c.y + rise, a, c.align);
    }
    this.issues = this.check(t);
  }

  // text blocks for the composite (design px, padded): the picture is darkened softly under each
  // and stars are hidden there, both following the text's own fade
  textMasks() {
    return this.boxes.filter((b) => b.a > 0.01).map((b) => ({ rect: [b.x0 - 18, b.y0 - 14, b.x1 + 18, b.y1 + 12], a: b.a }));
  }

  env(t, t0, t1, fade) {
    if (t < t0 || t > t1) return 0;
    return smoothstep(t0, t0 + fade, t) * (1 - smoothstep(t1 - fade, t1, t));
  }

  // ------------------------------------------------------------------ layout check
  check(t) {
    const out = [];
    const PAD = 6;
    const boxes = this.boxes.filter((b) => b.a > 0.25);
    const segHits = (x0, y0, x1, y1, b) => {
      // segment vs padded rectangle (Liang–Barsky clip)
      const rx0 = b.x0 - PAD, ry0 = b.y0 - PAD, rx1 = b.x1 + PAD, ry1 = b.y1 + PAD;
      let u0 = 0, u1 = 1;
      const dx = x1 - x0, dy = y1 - y0;
      for (const [p, q] of [[-dx, x0 - rx0], [dx, rx1 - x0], [-dy, y0 - ry0], [dy, ry1 - y0]]) {
        if (p === 0) { if (q < 0) return false; continue; }
        const r = q / p;
        if (p < 0) { if (r > u1) return false; if (r > u0) u0 = r; } else { if (r < u0) return false; if (r < u1) u1 = r; }
      }
      return true;
    };
    for (const l of this.lines) {
      if (l.a < 0.25) continue;
      for (const b of boxes) {
        if (l.own === b.str) continue;
        for (let i = 1; i < l.pts.length; i++) {
          const [x0, y0] = l.pts[i - 1], [x1, y1] = l.pts[i];
          if (segHits(x0, y0, x1, y1, b)) { out.push(`t=${t.toFixed(2)} ${l.kind} crosses "${b.str}"`); break; }
        }
      }
    }
    for (let i = 0; i < boxes.length; i++) {
      const a = boxes[i];
      if (a.x0 < 96 || a.x1 > 1824 || a.y0 < 54 || a.y1 > 1026) out.push(`t=${t.toFixed(2)} "${a.str}" outside title-safe`);
      for (let j = i + 1; j < boxes.length; j++) {
        const b = boxes[j];
        if (a.x0 < b.x1 + 4 && b.x0 < a.x1 + 4 && a.y0 < b.y1 + 4 && b.y0 < a.y1 + 4) out.push(`t=${t.toFixed(2)} "${a.str}" overlaps "${b.str}"`);
      }
    }
    return out;
  }

  // ------------------------------------------------------------------ text
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

  // the box a string occupies (design px), for leaders and the layout check
  textBox(str, kind, x, y, align = 'left') {
    const f = FONTS[kind];
    const ctx = this.ctx;
    ctx.save();
    // canvas letter-spacing pads after the last glyph; exclude it from alignment
    const w = this.measure(ctx, str, f) - f.spacing * f.size;
    ctx.restore();
    const x0 = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    return { x0, y0: y - f.size * 0.74, x1: x0 + w, y1: y + f.size * 0.24, w };
  }

  text(str, kind, x, y, alpha, align = 'left', color = COL.white) {
    const ctx = this.ctx;
    const f = FONTS[kind];
    const box = this.textBox(str, kind, x, y, align);
    this.boxes.push({ ...box, str, a: alpha });
    ctx.save();
    ctx.textAlign = 'left';
    // no glyph halo: legibility comes from placement and from the composite, which darkens the
    // picture softly under every text block (and hides stars there) with the text's own fade
    ctx.globalAlpha = alpha * f.alpha;
    ctx.fillStyle = color;
    this.drawRuns(ctx, str, f, box.x0, y, color);
    ctx.restore();
  }

  // diagram label tied to its feature by a 1 px leader that stops 8 px short of the text
  dlabel(ctx, str, ax, ay, lx, ly, a, align = 'left', color = COL.white) {
    const b = this.textBox(str, 'label', lx, ly, align);
    const nx = Math.min(Math.max(ax, b.x0), b.x1), ny = Math.min(Math.max(ay, b.y0), b.y1);
    const dx = ax - nx, dy = ay - ny, d = Math.hypot(dx, dy);
    if (d > 20) {
      const ex = nx + (dx / d) * 8, ey = ny + (dy / d) * 8;
      const sx = ax - (dx / d) * 4, sy = ay - (dy / d) * 4;   // and 4 px short of the feature
      ctx.save();
      ctx.globalAlpha = a * 0.75;
      ctx.strokeStyle = COL.white; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.restore();
      this.lines.push({ pts: [[sx, sy], [ex, ey]], kind: `leader of "${str}"`, own: str, a });
    }
    this.text(str, 'label', lx, ly, a, align, color);
  }

  // -------------------------------------------------------------------------
  maskAlpha(X, Y) {
    const m = this.mask;
    if (!m) return 1;
    const q = Math.hypot((X - m.cx) / m.rx, (Y - m.cy) / m.ry);
    return q < 0.72 ? 1 : Math.max(0, 1 - (q - 0.72) / 0.28);
  }

  path(ctx, pts, map, prog, style, headGlow = true, name = 'path') {
    const n = Math.max(2, Math.floor(pts.length * prog));
    ctx.save();
    ctx.strokeStyle = style.color;
    ctx.lineWidth = style.width;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath();
    const vis = [];
    for (let i = 0; i < n; i++) {
      const [X, Y] = map(pts[i]);
      if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
      if (this.maskAlpha(X, Y) > 0.15) vis.push([X, Y]); else if (vis.length) { this.lines.push({ pts: vis.splice(0), kind: name, a: this.diagA }); }
    }
    if (vis.length > 1) this.lines.push({ pts: vis, kind: name, a: this.diagA });
    ctx.stroke();
    if (headGlow && prog > 0 && prog < 1) {
      const [X, Y] = map(pts[n - 1]);
      ctx.fillStyle = rgba(COL.white, 0.95);
      ctx.beginPath(); ctx.arc(X, Y, 3.6, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  circle(ctx, cx, cy, r, name) {
    const pts = [];
    for (let k = 0; k <= 96; k++) { const a = (k / 96) * Math.PI * 2; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
    this.lines.push({ pts, kind: name, a: this.diagA });
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  }

  hole(ctx, cx, cy, scale, { photonSphere = false, isco = false } = {}) {
    // strokes only: a schematic, never a second black hole competing with the render
    ctx.save();
    ctx.strokeStyle = rgba(COL.white, 0.8); ctx.lineWidth = 1.8;
    this.circle(ctx, cx, cy, 2 * scale, 'horizon');
    if (photonSphere) {
      ctx.setLineDash([6, 8]);
      ctx.strokeStyle = rgba(COL.white, 0.6);
      this.circle(ctx, cx, cy, 3 * scale, 'photon sphere');
    }
    if (isco) {
      // dotted, and broken on the left where its label "3 rₛ" sits on the line itself
      ctx.setLineDash([3, 7]);
      ctx.strokeStyle = rgba(COL.white, 0.8);
      // (the gap is at the lower right, 60 deg below the horizontal, where the spiral is furthest inside)
      const r = 6 * scale, gap = 0.36, at = Math.PI / 3;
      ctx.beginPath(); ctx.arc(cx, cy, r, at + gap, at - gap + 2 * Math.PI); ctx.stroke();
      const pts = [];
      for (let k = 0; k <= 80; k++) { const t = at + gap + (k / 80) * (2 * Math.PI - 2 * gap); pts.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]); }
      this.lines.push({ pts, kind: 'ISCO ring', a: this.diagA });
    }
    ctx.restore();
  }

  // Diagrams are drawn on an offscreen layer, then composited through a soft elliptical
  // mask: no box, no hard edge; lines fade out instead of being clipped.
  beginDiagram(cx, cy, rx, ry, a) {
    this.mask = { cx, cy, rx, ry };
    this.diagA = a;
    const o = this.octx;
    o.setTransform(1, 0, 0, 1, 0, 0);
    o.clearRect(0, 0, this.off.width, this.off.height);
    o.setTransform(this.s, 0, 0, this.s, 0, 0);
    return o;
  }
  endDiagram() {
    const { cx, cy, rx, ry } = this.mask;
    const a = this.diagA;
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
    this.mask = null;
  }

  panel(p, lt, a) {
    const ctx = this.ctx;
    if (p.id === 'rays') {
      // side view in the right-hand column (x 1330–1810), clear of the real disk's tail
      const sc = 10, cx = 1510, cy = 470;
      const map = ([x, y]) => [cx + x * sc, cy - y * sc];
      const o = this.beginDiagram(1570, cy, 330, 210, a);
      // the disk: a soft, heavier bar, distinct from the rays
      for (const [x0, x1] of [[-DISK_OUT, -6], [6, DISK_OUT]]) {
        const g = o.createLinearGradient(cx + x0 * sc, 0, cx + x1 * sc, 0);
        const inner = x0 < 0 ? 1 : 0;
        g.addColorStop(inner ? 1 : 0, rgba(COL.white, 0.95)); g.addColorStop(0.55, rgba(COL.ember, 0.85)); g.addColorStop(inner ? 0 : 1, rgba(COL.ember, 0.15));
        o.fillStyle = g;
        o.fillRect(cx + x0 * sc, cy - 3, (x1 - x0) * sc, 6);
        this.lines.push({ pts: [[cx + x0 * sc, cy], [cx + x1 * sc, cy]], kind: 'disk bar', a });
      }
      this.hole(o, cx, cy, sc);
      for (const ray of RAYS_GEO.rays) {
        const prog = smootherstep(ray.st, ray.st + RAY_DRAW, lt);
        if (prog <= 0) continue;
        this.path(o, ray.pts, map, prog, { color: rgba(COL.ember, 0.95), width: 2.6 }, true, `${ray.kind} ray`);
        // emission point on the disk
        const [ex, ey] = map(ray.pts[0]);
        o.fillStyle = rgba(COL.white, 0.95 * Math.min(1, prog * 4));
        o.beginPath(); o.arc(ex, ey, 3.2, 0, Math.PI * 2); o.fill();
      }
      // the observer
      const [ox, oy] = map(RAYS_GEO.cam);
      o.fillStyle = rgba(COL.white, 1);
      o.beginPath(); o.arc(ox, oy, 5, 0, Math.PI * 2); o.fill();
      this.endDiagram();
      const la = a * smoothstep(3.5, 4.5, lt);
      this.text('you', 'label', ox + 12, oy - 28, la, 'right');
      this.dlabel(ctx, 'far side of the disk', cx - (DISK_OUT - 0.4) * sc, cy + 5, cx - DISK_OUT * sc, cy + 122, la, 'left');
    } else if (p.id === 'photon') {
      // full-frame interlude over black: top view of light passing the hole
      const sc = 44, cx = 960, cy = 540;
      const map = ([x, y]) => [cx + x * sc, cy - y * sc];
      const o = this.beginDiagram(cx, cy, 600, 290, a);
      this.hole(o, cx, cy, sc, { photonSphere: true });
      PHOTON_GEO.forEach((ray, i) => {
        const st = ray.main ? PHOTON_MAIN.st : 0.4 + i * 0.35;
        const prog = smootherstep(st, st + (ray.main ? PHOTON_MAIN.dur : 3.0), lt);
        if (prog <= 0) return;
        this.path(o, ray.pts, map, prog, ray.main ? { color: rgba(COL.white, 1), width: 3.0 } : { color: rgba(COL.ember, 0.9), width: 2.4 }, true, ray.main ? 'main ray' : 'neighbour ray');
      });
      this.endDiagram();
      const la = a * smoothstep(1.2, 2.2, lt);
      // labels placed where no ray passes: the horizon is named inside its circle, the photon
      // sphere from its left side (light arrives from the upper left and leaves downward)
      this.text('horizon', 'label', cx, cy + 12, la, 'center');
      this.dlabel(ctx, 'photon sphere, 1.5 rₛ', cx - 3 * sc, cy, cx - 3 * sc - 76, cy + 12, la, 'right');
      const ma = a * smoothstep(PHOTON_MAIN.st + PHOTON_MAIN.dur - 0.6, PHOTON_MAIN.st + PHOTON_MAIN.dur + 0.4, lt);
      const exit = PHOTON_GEO.find((r) => r.main).pts.find(([x, y]) => y < -5.6 && x < 4);
      if (exit) { const [ex, ey] = map(exit); this.dlabel(ctx, 'circles, then escapes', ex, ey, ex - 30, cy + 352, ma, 'center'); }
    } else if (p.id === 'isco') {
      // right-hand column, over the dimmer receding side of the disk
      const sc = 26, cx = 1530, cy = 600;
      const map = ([x, y]) => [cx + x * sc, cy - y * sc];
      const o = this.beginDiagram(cx, cy, 345, 345, a);
      this.hole(o, cx, cy, sc, { isco: true });
      this.path(o, ISCO_GEO.stable, map, smootherstep(0.8, 6.0, lt), { color: rgba(COL.white, 0.9), width: 2.0 }, true, 'stable orbit');
      this.path(o, ISCO_GEO.plunge, map, smootherstep(PLUNGE.st, PLUNGE.st + PLUNGE.dur, lt), { color: rgba(COL.ember, 0.95), width: 2.2 }, true, 'plunge');
      this.endDiagram();
      const la = a * smoothstep(2.0, 3.0, lt);
      this.text('stays in orbit', 'label', cx, cy - ISCO_GEO.stableR * sc - 22, la, 'center');
      this.text('spirals in', 'label', cx, cy + ISCO_GEO.stableR * sc + 52, la * smoothstep(PLUNGE.st + 2, PLUNGE.st + 3, lt), 'center', COL.ember);
      this.text('3 rₛ', 'label', cx + 6 * sc * Math.cos(Math.PI / 3), cy + 6 * sc * Math.sin(Math.PI / 3) + 12, la, 'center');
    }
  }

  label(kind, t, a) {
    const ctx = this.ctx;
    if (kind === 'split') {
      // the payoff ends side by side; each half is named just under the ring, either side of the seam
      this.text('sharp', 'label', 936, 905, a, 'right');
      this.text('EHT resolution', 'label', 984, 905, a, 'left');
    }
  }
}
