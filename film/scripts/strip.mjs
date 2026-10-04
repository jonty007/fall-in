// One-second full-resolution strip for flicker/shimmer checks.
//   node film/scripts/strip.mjs --start=69 [--frames=30] [--cpu] [--out=dir]
// Writes 1080p PNG frames, an ffv1 clip and a tiled overview image.
import fs from 'node:fs';
import path from 'node:path';
import { openFilm, parseArgs, ffmpeg, downscalePng, OUT } from './capture.mjs';

const args = parseArgs();
const start = Number(args.start ?? 69);
const n = Number(args.frames || 30);
const outDir = path.resolve(args.out || path.join(OUT, 'tmp', `strip_${start}`));
fs.mkdirSync(outDir, { recursive: true });
const film = await openFilm({ cpu: !!args.cpu, scale: 2 });
const fps = film.info.fps;
const raw = path.join(outDir, '_raw.png');
for (let i = 0; i < n; i++) {
  const t = start + i / fps;
  const f = path.join(outDir, `s_${String(i).padStart(3, '0')}.png`);
  if (fs.existsSync(f)) continue;
  const t0 = Date.now();
  await film.frame(t, raw);
  downscalePng(raw, f);
  process.stdout.write(`\rframe ${i + 1}/${n} ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}
fs.rmSync(raw, { force: true });
await film.close();
ffmpeg(['-framerate', String(fps), '-i', path.join(outDir, 's_%03d.png'), '-c:v', 'ffv1', path.join(outDir, 'strip.mkv')]);
ffmpeg(['-framerate', String(fps), '-i', path.join(outDir, 's_%03d.png'), '-vf', 'scale=640:360:flags=lanczos,tile=6x5:padding=4', '-frames:v', '1', path.join(outDir, 'strip_tiles.png')]);
console.log(`\nstrip written to ${outDir}`);
