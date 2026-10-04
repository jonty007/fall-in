// Full-resolution stills: one per beat (default) or at given times.
//   node film/scripts/stills.mjs [--cpu] [--out=film/out/stills] [--times=3,41.5] [--prefix=beat] [--view=960x540 --scale=1 --size=960x540] [--noui]
// Renders at 1920x1080 CSS px with deviceScaleFactor 2, Lanczos-downscaled to 1920x1080.
import fs from 'node:fs';
import path from 'node:path';
import { openFilm, parseArgs, downscalePng, OUT } from './capture.mjs';
import { BEATS } from '../src/timeline.js';

const args = parseArgs();
const outDir = path.resolve(args.out || path.join(OUT, 'stills'));
fs.mkdirSync(outDir, { recursive: true });
const jobs = args.times
  ? String(args.times).split(',').map((s, i) => ({ t: Number(s), name: `${args.prefix || 't'}_${String(Number(s).toFixed(2)).replace('.', '_')}` }))
  : BEATS.map((b, i) => ({ t: b.still, name: `${String(i).padStart(2, '0')}_${b.id}` }));

// --view=960x540 renders a smaller viewport (look-dev); the delivery stills use the default 1920x1080
const [vw, vh] = String(args.view || '1920x1080').split('x').map(Number);
const film = await openFilm({ cpu: !!args.cpu, scale: Number(args.scale || 2), width: vw, height: vh, query: '?' + [args.noui ? 'noui' : '', args.ev ? `ev=${args.ev}` : '', args.sat ? `sat=${args.sat}` : ''].filter(Boolean).join('&') });
console.log('renderer:', film.info.renderer);
const tmp = path.join(outDir, '_raw.png');
for (const j of jobs) {
  const t0 = Date.now();
  await film.frame(j.t, tmp);
  const [ow, oh] = String(args.size || '1920x1080').split('x').map(Number);
  downscalePng(tmp, path.join(outDir, `${j.name}.png`), ow, oh);
  console.log(`${j.name} (t=${j.t}s) ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
fs.rmSync(tmp, { force: true });
await film.close();
