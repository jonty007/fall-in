// Verify a delivered video: ffprobe summary against the spec + frames at 0 s, 3 s, middle and end.
//   node film/scripts/verify.mjs [film/out/film_16x9.mp4] [--out=film/out/verify]
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, ffmpeg, ffprobe, OUT } from './capture.mjs';

const args = parseArgs();
const file = path.resolve(args._[0] || path.join(OUT, 'film_16x9.mp4'));
const outDir = path.resolve(args.out || path.join(OUT, 'verify'));
fs.mkdirSync(outDir, { recursive: true });

const probe = JSON.parse(ffprobe(['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file]));
const v = probe.streams.find((s) => s.codec_type === 'video');
const a = probe.streams.find((s) => s.codec_type === 'audio');
const dur = Number(probe.format.duration);
const sizeMB = Number(probe.format.size) / 1e6;
const head = fs.readFileSync(file).subarray(0, 64 * 1024);
const moovFirst = head.indexOf('moov') >= 0 && (head.indexOf('mdat') < 0 || head.indexOf('moov') < head.indexOf('mdat'));
const checks = [
  ['duration 90–120 s', dur >= 90 && dur <= 120, `${dur.toFixed(3)} s`],
  ['H.264 High', v.codec_name === 'h264' && v.profile === 'High', `${v.codec_name} ${v.profile}`],
  ['yuv420p', v.pix_fmt === 'yuv420p', v.pix_fmt],
  ['30 fps', v.r_frame_rate === '30/1', v.r_frame_rate],
  ['BT.709 tags', v.color_space === 'bt709' && v.color_primaries === 'bt709' && v.color_transfer === 'bt709', `${v.color_space}/${v.color_primaries}/${v.color_transfer} ${v.color_range}`],
  ['AAC 48 kHz stereo', a && a.codec_name === 'aac' && a.sample_rate === '48000' && a.channels === 2, a ? `${a.codec_name} ${a.sample_rate} ${a.channels}ch ${Math.round(a.bit_rate / 1000)} kb/s` : 'none'],
  ['audio length = video length', a && Math.abs(Number(a.duration) - Number(v.duration)) < 0.05, a ? `${Number(a.duration).toFixed(3)} vs ${Number(v.duration).toFixed(3)}` : ''],
  ['+faststart (moov before mdat)', moovFirst, moovFirst ? 'yes' : 'no'],
  ['under 95 MB', sizeMB < 95, `${sizeMB.toFixed(1)} MB`],
];
console.log(`${file}  ${v.width}x${v.height}`);
for (const [name, ok, val] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(30)} ${val}`);

const times = [0, 3, dur / 2, dur - 1 / 30];
for (const t of times) {
  const f = path.join(outDir, `frame_${t.toFixed(2).replace('.', '_')}.png`);
  ffmpeg(['-ss', String(t), '-i', file, '-frames:v', '1', f]);
  console.log('frame', f);
}
