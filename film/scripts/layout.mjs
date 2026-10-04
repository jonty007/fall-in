// Layout check: steps through the film drawing only the text/diagram layer and reports any
// label that touches a path or another text block, or leaves the safe area.
//   node film/scripts/layout.mjs [--step=0.25] [--shots=24.5,41] [--out=film/out/tmp/layout]
import fs from 'node:fs';
import path from 'node:path';
import { openFilm, parseArgs, OUT } from './capture.mjs';

const args = parseArgs();
const step = Number(args.step || 0.25);
const outDir = path.resolve(args.out || path.join(OUT, 'tmp', 'layout'));
fs.mkdirSync(outDir, { recursive: true });
const film = await openFilm({ cpu: true, scale: 1, query: '?uionly' });
const issues = new Map();
for (let t = 0; t <= film.info.duration + 1e-6; t += step) {
  await film.page.evaluate((tt) => window.seek(tt), +t.toFixed(3));
  for (const s of await film.page.evaluate(() => window.overlayIssues || [])) {
    const key = s.replace(/^t=\S+ /, '');
    if (!issues.has(key)) issues.set(key, []);
    issues.get(key).push(+t.toFixed(2));
  }
}
for (const [k, ts] of issues) console.log(`${k}  (t ${ts[0]}–${ts[ts.length - 1]}, ${ts.length}×)`);
console.log(issues.size ? `${issues.size} layout issue(s)` : 'layout clean');
if (args.shots) {
  for (const t of String(args.shots).split(',').map(Number)) {
    await film.frame(t, path.join(outDir, `ui_${String(t).replace('.', '_')}.png`));
  }
}
await film.close();
