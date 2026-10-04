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

// all text is warm white; hierarchy comes from typeface and size (diagram labels may take
// the colour of the path they name)
const FONTS = {
  question: { family: 'Cormorant Garamond', style: 'italic', weight: 400, size: 70, spacing: 0.01, alpha: 1 },
  headline: { family: 'Cormorant Garamond', style: 'normal', weight: 500, size: 64, spacing: 0.01, alpha: 1 },
  caption: { family: 'Jost', style: 'normal', weight: 400, size: 38, spacing: 0.015, alpha: 1 },
  title: { family: 'Cormorant Garamond', style: 'normal', weight: 500, size: 150, spacing: 0.14, alpha: 1 },
  credit: { family: 'Jost', style: 'normal', weight: 400, size: 38, spacing: 0.02, alpha: 0.92 },
  mono: { family: 'IBM Plex Mono', style: 'normal', weight: 400, size: 36, spacing: 0, alpha: 0.95 },
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
export const PLUNGE = { st: 1.6, dur: 6.4 };

// Top view for the photon sphere: parallel rays from the left at impact parameters near sqrt(27) M,
// integrated in u(phi) (the Binet form, as in the shader): near the critical value the orbit is
// exponentially sensitive, and a Cartesian integration loses the laps. At b = bc (1 + 2.8e-7) the ray
// circles ≈ 1.9 times within 0.0013 M of r = 3M (under 0.1 px here), then leaves down-left, inside the
// escaping neighbour (so the two never cross) and clear of the incoming rays.
const PHOTON_GEO = (() => {
  const bc = Math.sqrt(27);
  const set = [
    { b: bc * (1 + 2.8e-7), main: true },
    { b: bc * 1.15, kind: 'escapes' }, { b: bc * 0.9, kind: 'falls' },   // one neighbour escapes, one falls in
  ];
  return set.map((s) => {
    const r = P.traceLight({ b: s.b, r0: 60, dphi: 0.002, maxPhi: 60 });
    // light arrives from the left above the hole and is turned clockwise
    const th0 = Math.PI - Math.asin(s.b / 60);
    const pts = r.pts.map(([rr, ph]) => [rr * Math.cos(th0 - ph), rr * Math.sin(th0 - ph)]);
    // drawn from just outside the visible area, so the drawing time is spent where the bending happens
    const i0 = Math.max(0, pts.findIndex(([x]) => x > -13));
    return { ...s, pts: pts.slice(i0), end: r.captured ? 'horizon' : 'out' };
  });
})();

// The circling ray's timing (s after the panel appears): its approach, then the lap at an even pace
// while it is alone on screen, then its exit; the two neighbours branch off after the lap.
export const PHOTON_T = { approach: [0.6, 1.4], lap: [1.4, 4.8], exit: [4.8, 5.5], branch: 4.6 };
const MAIN_IDX = (() => {
  const pts = PHOTON_GEO.find((r) => r.main).pts;
  const near = (p) => Math.hypot(p[0], p[1]) < 3.6;
  const a = pts.findIndex(near);
  let b = a;
  for (let i = pts.length - 1; i >= 0; i--) if (near(pts[i])) { b = i; break; }
  return { a, b, n: pts.length };
})();
export function mainProg(lt) {
  const { a, b, n } = MAIN_IDX;
  const T = PHOTON_T;
  const seg = ([t0, t1], i0, i1) => i0 + (i1 - i0) * Math.min(1, Math.max(0, (lt - t0) / (t1 - t0)));
  if (lt <= T.approach[0]) return 0;
  const idx = lt < T.lap[0] ? seg(T.approach, 0, a) : lt < T.exit[0] ? seg(T.lap, a, b) : seg(T.exit, b, n - 1);
  return idx / (n - 1);
}

// Top view for the ISCO: a stable circular orbit outside it, and matter released inside it (2.6 rs, with
// the ISCO's own angular momentum) spiralling into the horizon in ≈ 1.3 turns (timelike geodesics)
const ISCO_GEO = (() => {
  const stableR = 10.0, plungeR = 5.2;
  const st = P.traceMatter({ r0: stableR, L: P.circularL(stableR), dphi: 0.01, maxPhi: 2 * Math.PI + 0.02 });
  const pl = P.traceMatter({ r0: plungeR, L: P.circularL(6), ur0: 0.0, dphi: 0.01, maxPhi: 30 * Math.PI });
  const toXY = (pts) => pts.map(([r, phi]) => [r * Math.cos(phi), r * Math.sin(phi)]);
  return { stable: toXY(st.pts), plunge: toXY(pl.pts), plunged: pl.plunged, stableR, plungeR };
})();

// ---------------------------------------------------------------------------
// Rich text: subscripts (ₛ), superscripts (¹²³⁴) and a drawn "≈", because none of the
// three typefaces carries those glyphs and a system fallback would not match.
const SUB = { 'ₛ': 's' }, SUP = { '¹': '1', '²': '2', '³': '3', '⁴': '4' };
const KERN = { 'FALL IN': { IN: -0.035 } };   // em; letter-spacing is included by measureText
function runs(str) {
  const out = [];
  let buf = '', it = false;
  const flush = () => { if (buf) { out.push({ t: 'n', s: buf, it }); buf = ''; } };
  for (const ch of str) {
    if (ch === '_') { flush(); it = !it; }   // _title_ is set in italic (an asterisk is a real character: M87*)
    else if (SUB[ch]) { flush(); out.push({ t: 'sub', s: SUB[ch] }); }
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
      const rk = r.kind || 'mono';
      lines.forEach((line, i) => this.text(line, rk, r.x, r.y + i * 46, a, r.align));
      if (r.leader) {
        // a 1 px leader from under the block to the feature it describes
        const b0 = this.textBox(lines[lines.length - 1], rk, r.x, r.y + (lines.length - 1) * 46, r.align);
        const sx = r.align === 'right' ? b0.x1 - 40 : b0.x0 + 40, sy = b0.y1 + 10;
        const [ax, ay] = r.leader;
        ctx.save();
        ctx.globalAlpha = a * 0.5;
        ctx.strokeStyle = '#000'; ctx.lineWidth = 4.5;   // a dark keyline so it holds on the white-hot disk
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ax, ay); ctx.stroke();
        ctx.globalAlpha = a * 0.9;
        ctx.strokeStyle = COL.white; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ax, ay); ctx.stroke();
        // the end marker: a cream dot with a thin dark edge, one style on bright and dim disk
        ctx.globalAlpha = a;
        ctx.fillStyle = COL.white; ctx.beginPath(); ctx.arc(ax, ay, 5, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(ax, ay, 5.75, 0, Math.PI * 2); ctx.stroke();
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
    // nothing drawn this frame: the caller skips the text pass (an empty 2D canvas could hand
    // WebGL a stale snapshot of the last frame that had text)
    this.empty = this.boxes.length === 0 && this.lines.length === 0;
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
  font(f, scale = 1, it = false) { return `${it ? 'italic' : f.style} ${f.weight} ${f.size * scale}px "${f.family}"`; }

  measure(ctx, str, f) {
    let w = 0;
    for (const r of runs(str)) w += this.runWidth(ctx, r, f);
    return w;
  }
  runWidth(ctx, r, f) {
    if (r.t === 'approx') return f.size * 0.62;
    const sc = r.t === 'n' ? 1 : 0.76;
    ctx.font = this.font(f, sc, !!r.it);
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
        const k = KERN[r.s];
        if (k && f === FONTS.title) {
          // per-glyph with pair kerning (only the title needs it)
          let gx = cx;
          for (let i = 0; i < r.s.length; i++) {
            ctx.fillText(r.s[i], gx, y + dy);
            gx += ctx.measureText(r.s[i]).width + (k[r.s.slice(i, i + 2)] || 0) * f.size;
          }
        } else ctx.fillText(r.s, cx, y + dy);
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
      // a closed reference ring in its own style (long dashes), distinct from the paths
      ctx.setLineDash([10, 7]);
      ctx.lineWidth = 2.0;
      ctx.strokeStyle = rgba(COL.white, 0.9);
      this.circle(ctx, cx, cy, 6 * scale, 'ISCO ring');
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
      const sc = 13.5, cx = 1400, cy = 365;
      const map = ([x, y]) => [cx + x * sc, cy - y * sc];
      const o = this.beginDiagram(cx + 6 * sc, cy, 470, 175, a);
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
        this.path(o, ray.pts, map, prog, { color: rgba(COL.white, 0.9), width: 2.8 }, true, `${ray.kind} ray`);
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
      this.dlabel(ctx, 'far side of the disk', cx - (DISK_OUT - 0.4) * sc, cy + 5, cx - DISK_OUT * sc, cy + 150, la, 'left');
    } else if (p.id === 'photon') {
      // full-frame interlude over black: top view of light passing the hole
      const sc = 58, cx = 960, cy = 600;
      const map = ([x, y]) => [cx + x * sc, cy - y * sc];
      const o = this.beginDiagram(cx, cy, 640, 330, a);
      // a thin dashed reference for the photon sphere; the circling ray laps it alone first
      o.save();
      o.strokeStyle = rgba(COL.white, 0.8); o.lineWidth = 1.8;
      this.circle(o, cx, cy, 2 * sc, 'horizon');
      const T = PHOTON_T;
      const done = smoothstep(T.exit[1], T.exit[1] + 0.8, lt);
      // the dashed reference shows where the sphere is only over the part of the circle the ray has not
      // yet covered, so the two never sit side by side (the ray's entry leg runs just outside r = 3M)
      {
        const m = PHOTON_GEO.find((r) => r.main);
        const n = Math.max(2, Math.floor(m.pts.length * mainProg(lt)));
        let swept = 0, started = false;
        for (let k = 1; k < n; k++) {
          const [x0, y0] = m.pts[k - 1], [x1, y1] = m.pts[k];
          if (!started && Math.hypot(x1, y1) < 3.6) started = true;
          if (!started) continue;
          let d = Math.atan2(y0, x0) - Math.atan2(y1, x1);   // clockwise travel, positive
          if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI;
          swept += d;
        }
        const rem = 2 * Math.PI - swept - 0.25;
        if (rem > 0 && done < 1) {
          const [hx, hy] = m.pts[n - 1];
          const phi0 = -Math.atan2(hy, hx) + 0.25;   // canvas angle just ahead of the head
          o.setLineDash([4, 10]); o.lineWidth = 1.2; o.strokeStyle = rgba(COL.white, 0.3 * (1 - done));
          o.beginPath(); o.arc(cx, cy, 3 * sc, phi0, phi0 + rem, false); o.stroke();
          const pts = [];
          for (let k = 0; k <= 48; k++) { const t = phi0 + (rem * k) / 48; pts.push([cx + 3 * sc * Math.cos(t), cy + 3 * sc * Math.sin(t)]); }
          this.lines.push({ pts, kind: 'photon sphere', a: this.diagA });
        }
      }
      o.restore();
      PHOTON_GEO.forEach((ray, i) => {
        if (ray.main) {
          const prog = mainProg(lt);
          if (prog <= 0) return;
          const n = Math.max(2, Math.floor(ray.pts.length * prog));
          // while it moves: a faint path with a bright fading trail and a glowing head, so the lap
          // reads as motion; once it has left, the whole path comes up to full strength
          const base = 0.3 + 0.7 * done;
          this.path(o, ray.pts, map, prog, { color: rgba(COL.white, base), width: 2.6 }, false, 'main ray');
          if (lt < T.exit[1] + 0.8) {
            const trail = 420, k0 = Math.max(0, n - trail);
            for (let c = 0; c < 6; c++) {
              const i0 = Math.floor(k0 + ((n - k0) * c) / 6), i1 = Math.floor(k0 + ((n - k0) * (c + 1)) / 6);
              if (i1 - i0 < 2) continue;
              o.save();
              o.strokeStyle = rgba(COL.white, (1 - base) * ((c + 1) / 6) * (1 - done));
              o.lineWidth = 2.6; o.lineCap = 'round'; o.lineJoin = 'round';
              o.beginPath();
              for (let k = i0; k <= Math.min(i1, n - 1); k++) { const [X, Y] = map(ray.pts[k]); if (k === i0) o.moveTo(X, Y); else o.lineTo(X, Y); }
              o.stroke(); o.restore();
            }
            if (prog < 1) {
              // the head is smeared along its own path over the half frame before this one (a 180°
              // shutter), so it glides instead of stepping
              const nb = Math.max(1, Math.floor(ray.pts.length * mainProg(lt - 1 / 60)) - 1);
              o.save();
              o.lineCap = 'round'; o.lineJoin = 'round';
              for (const [w, al] of [[16, 0.18], [9, 0.35], [4.5, 0.75]]) {
                o.strokeStyle = rgba(COL.white, al); o.lineWidth = w;
                o.beginPath();
                for (let k = nb; k <= n - 1; k++) { const [X, Y] = map(ray.pts[k]); if (k === nb) o.moveTo(X, Y); else o.lineTo(X, Y); }
                o.stroke();
              }
              o.restore();
              const [hx, hy] = map(ray.pts[n - 1]);
              const g = o.createRadialGradient(hx, hy, 0, hx, hy, 14);
              g.addColorStop(0, rgba(COL.white, 0.9)); g.addColorStop(1, rgba(COL.white, 0));
              o.fillStyle = g; o.beginPath(); o.arc(hx, hy, 14, 0, Math.PI * 2); o.fill();
            }
          }
          return;
        }
        const st = T.branch + (ray.kind === 'falls' ? 0.2 : 0);
        const prog = smootherstep(st, st + 1.6, lt);
        if (prog <= 0) return;
        const style = ray.kind === 'falls' ? { color: rgba(COL.ember, 0.95), width: 2.4 } : { color: rgba(COL.white, 0.6), width: 1.8 };
        if (style.dash) o.setLineDash(style.dash);
        this.path(o, ray.pts, map, prog, style, true, `${ray.kind} ray`);
        o.setLineDash([]);
      });
      this.endDiagram();
      // labels at the end of each ray (the photon sphere from its free left side, during the lap)
      this.dlabel(ctx, `photon sphere, ${(PHYS.ph.r / 2).toFixed(1)} rₛ`, cx - 3 * sc, cy, cx - 3 * sc - 76, cy + 12, a * smoothstep(2.4, 3.2, lt), 'right');
      // the falling ray is named on its way in, outside the loop, where it is the only ember line
      const fall = PHOTON_GEO.find((r) => r.kind === 'falls');
      const fpt = fall && fall.pts.find(([x]) => x > -4.2);
      const fa = a * smoothstep(T.branch + 0.6, T.branch + 1.3, lt);
      if (fpt && fa > 0) { const [fx, fy] = map(fpt); this.dlabel(ctx, 'falls in', fx, fy + 4, fx - 20, fy + 66, fa, 'right', COL.ember); }
      const R = (k) => PHOTON_GEO.find((r) => (k === 'main' ? r.main : r.kind === k));
      const BOTTOM = cy + 362;   // the two exit labels share one baseline
      const tag = (ray, txt, dx, align, t0) => {
        const ta = a * smoothstep(t0, t0 + 0.8, lt);
        const pt = ray && ray.pts.find(([x, y]) => y < -5.0 && Math.abs(x) < 9);
        if (pt && ta > 0) { const [ex, ey] = map(pt); this.dlabel(ctx, txt, ex, ey, ex + dx, BOTTOM, ta, align); }
      };
      // the circling ray is named where it leaves the sphere (first point past 5.5 M after its laps)
      {
        const m = R('main');
        const ta = a * smoothstep(T.branch + 1.3, T.branch + 2.1, lt);
        const k = m.pts.findIndex(([x, y], i) => i > 200 && Math.hypot(x, y) > 5.5 && m.pts.slice(0, i).some(([px, py]) => Math.hypot(px, py) < 3.1));
        if (k > 0 && ta > 0) { const [ex, ey] = map(m.pts[k]); this.dlabel(ctx, 'orbits, then leaves', ex, ey, ex - 40, BOTTOM, ta, 'right'); }
      }
      tag(R('escapes'), 'escapes', 40, 'left', T.branch + 2.0);
    } else if (p.id === 'isco') {
      // right-hand column, over the dimmer receding side of the disk
      const sc = 26, cx = 1530, cy = 566;
      const map = ([x, y]) => [cx + x * sc, cy - y * sc];
      const o = this.beginDiagram(cx, cy, 345, 345, a);
      this.hole(o, cx, cy, sc, { isco: true });
      const sp = smootherstep(0.8, 6.0, lt);
      this.path(o, ISCO_GEO.stable, map, sp, { color: rgba(COL.white, 0.85), width: 1.8 }, true, 'stable orbit');
      if (sp >= 1) {
        // the stable particle keeps going round
        const ang = ((lt - 6.0) / 3.2) * Math.PI * 2;
        const [px, py] = map([ISCO_GEO.stableR * Math.cos(ang), ISCO_GEO.stableR * Math.sin(ang)]);
        o.fillStyle = rgba(COL.white, 0.95); o.beginPath(); o.arc(px, py, 4.2, 0, Math.PI * 2); o.fill();
      }
      const pp = smootherstep(PLUNGE.st, PLUNGE.st + PLUNGE.dur, lt);
      if (pp > 0) {
        // drawn faint at its start and full at the horizon, so even a held frame reads as falling inward
        const pts = ISCO_GEO.plunge, n = Math.max(2, Math.floor(pts.length * pp)), K = 8;
        for (let c = 0; c < K; c++) {
          const i0 = Math.floor((n * c) / K), i1 = Math.floor((n * (c + 1)) / K);
          if (i1 - i0 < 1) continue;
          this.path(o, pts.slice(i0, i1 + 1), map, 1, { color: rgba(COL.ember, 0.3 + 0.65 * ((c + 1) / K)), width: 2.4 }, false, 'plunge');
        }
        const [hx, hy] = map(pts[n - 1]);
        o.fillStyle = rgba(pp < 1 ? COL.white : COL.ember, 0.95); o.beginPath(); o.arc(hx, hy, pp < 1 ? 3.6 : 4.2, 0, Math.PI * 2); o.fill();
      }
      this.endDiagram();
      const la = a * smoothstep(2.0, 3.0, lt);
      // one callout style for the two paths: a legend under the diagram (leaders to the inner spiral
      // would have to cross the rings); the 3 rₛ reference ring carries its own label on the line
      const lx = cx - 150, ly = cy + ISCO_GEO.stableR * sc + 50;
      const pa = la * smoothstep(PLUNGE.st + 2, PLUNGE.st + 3, lt);
      ctx.save();
      ctx.lineCap = 'round';
      ctx.globalAlpha = la; ctx.strokeStyle = rgba(COL.white, 0.85); ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.moveTo(lx, ly - 11); ctx.lineTo(lx + 34, ly - 11); ctx.stroke();
      ctx.fillStyle = rgba(COL.white, 0.95); ctx.beginPath(); ctx.arc(lx + 34, ly - 11, 4, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = pa; ctx.strokeStyle = rgba(COL.ember, 0.95); ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.moveTo(lx, ly + 33); ctx.lineTo(lx + 34, ly + 33); ctx.stroke();
      ctx.fillStyle = rgba(COL.ember, 0.95); ctx.beginPath(); ctx.arc(lx + 34, ly + 33, 4, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      this.text('stays in orbit', 'label', lx + 50, ly, la, 'left');
      this.text('spirals in', 'label', lx + 50, ly + 44, pa, 'left', COL.ember);
      // "3 rₛ" in the gap between the reference ring and the stable orbit, on a short leader
      {
        const ang = Math.PI / 7, r0 = 6 * sc;
        const ax = cx + r0 * Math.cos(ang), ay = cy + r0 * Math.sin(ang);
        this.dlabel(ctx, '3 rₛ', ax, ay, cx + 6.6 * sc, ay + 14, la, 'left');
      }
    }
  }

  label(kind, t, a) {
    const ctx = this.ctx;
    if (kind === 'split') {
      // the seam carries a soft cream hairline from the moment the wipe starts, following it, running a
      // little past the disk at both ends; the halves are named once the seam has settled at the centre
      const x = Math.min(1, effectsAt(t).teleSplit[0]) * 1920;
      ctx.save();
      const g = ctx.createLinearGradient(0, 280, 0, 820);
      g.addColorStop(0, rgba(COL.white, 0)); g.addColorStop(0.08, rgba(COL.white, 0.7)); g.addColorStop(0.92, rgba(COL.white, 0.7)); g.addColorStop(1, rgba(COL.white, 0));
      for (const [w, al] of [[3.0, 0.25], [1.6, 0.6], [0.8, 1.0]]) { ctx.globalAlpha = a * al; ctx.fillStyle = g; ctx.fillRect(x - w / 2, 280, w, 540); }
      ctx.restore();
      this.lines.push({ pts: [[x, 300], [x, 800]], kind: 'split line', a });
      const na = a * smoothstep(97.8, 98.5, t);
      this.text('sharp', 'label', 924, 880, na, 'right');
      this.text('EHT resolution', 'label', 996, 880, na, 'left');
    }
  }
}
