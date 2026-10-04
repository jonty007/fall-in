// Contact sheet: one frame every 2 s, tiled with timestamps.
//   node film/scripts/contact.mjs [--cpu] [--every=2] [--out=film/out/contact_sheet.jpg] [--scale=0.5]
// Frames are rendered with the same shader settings as the film; only the pixel
// count is reduced (deviceScaleFactor 0.5 -> 960x540) because they are thumbnails.
import fs from 'node:fs';
import path from 'node:path';
import { openFilm, parseArgs, ffmpeg, OUT, fmtTime } from './capture.mjs';

const args = parseArgs();
const every = Number(args.every || 2);
const out = path.resolve(args.out || path.join(OUT, 'contact_sheet.jpg'));
const scale = Number(args.scale || 0.5);
const work = path.join(OUT, 'tmp', 'contact');
fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(work, { recursive: true });

const film = await openFilm({ cpu: !!args.cpu, scale });
const dur = film.info.duration;
const times = [];
for (let t = 0; t < dur - 0.01; t += every) times.push(+t.toFixed(3));
times.push(dur - 1 / 30);
let i = 0;
for (const t of times) {
  const f = path.join(work, `f_${String(i).padStart(3, '0')}.png`);
  await film.frame(t, f);
  // burn a small timestamp under the frame
  const lab = path.join(work, `l_${String(i).padStart(3, '0')}.png`);
  ffmpeg(['-i', f, '-vf', `scale=480:270:flags=lanczos,pad=480:300:0:0:black,drawtext=text='${fmtTime(t).replace(':', '\\:')}':x=8:y=278:fontsize=18:fontcolor=0xBFD4FF`, lab]);
  i++;
  process.stdout.write(`\rframe ${i}/${times.length}`);
}
await film.close();
const cols = 6;
const rows = Math.ceil(i / cols);
ffmpeg(['-framerate', '1', '-i', path.join(work, 'l_%03d.png'), '-vf', `tile=${cols}x${rows}:padding=6:margin=12:color=0x050506`, '-frames:v', '1', '-q:v', '3', out]);
console.log(`\ncontact sheet: ${out} (${i} frames)`);
