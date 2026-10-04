// Exposure check: render frames without the text layer and report how the image sits.
//   node film/scripts/measure.mjs --times=3,24.5,41 [--cpu]
// white%: share of pixels at >= 0.92 luma (clipped highlights); body: median luma of lit pixels.
import { openFilm, parseArgs } from './capture.mjs';
const args = parseArgs();
const times = String(args.times).split(',').map(Number);
const film = await openFilm({ cpu: !!args.cpu, width: 480, height: 270, scale: 1, query: '?noui' });
for (const t of times) {
  await film.page.evaluate((tt) => window.seek(tt), t);
  const st = await film.page.evaluate(() => {
    const c = document.getElementById('gl');
    const gl = c.getContext('webgl2');
    const w = c.width, h = c.height, px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const L = [];
    let white = 0;
    for (let i = 0; i < w * h; i++) {
      const l = (0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2]) / 255;
      if (l >= 0.92) white++;
      if (l > 0.06) L.push(l);
    }
    L.sort((a, b) => a - b);
    const q = (p) => (L.length ? L[Math.floor(p * (L.length - 1))] : 0);
    return { white: (100 * white) / (w * h), lit: (100 * L.length) / (w * h), body: q(0.5), p90: q(0.9), p99: q(0.99) };
  });
  console.log(`t=${String(t).padEnd(6)} white ${st.white.toFixed(2)}%  lit ${st.lit.toFixed(0)}%  body ${st.body.toFixed(2)}  p90 ${st.p90.toFixed(2)}  p99 ${st.p99.toFixed(2)}`);
}
await film.close();
