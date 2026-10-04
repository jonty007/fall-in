// Render the film: 5-second chunks, each encoded (with the 2x -> 1x Lanczos downscale)
// to a near-lossless 10-bit intermediate, PNGs deleted, resumable per chunk, then
// joined, muxed with the score and encoded to the delivery spec.
//
//   npm run render                       # GPU, full quality -> film/out/film_16x9.mp4
//   npm run render -- --cpu              # SwiftShader (very slow)
//   npm run render -- --preview          # 640x360 preview -> film/out/preview_640x360.mp4
//   options: --from=SECONDS --to=SECONDS --chunk=5 --headed --keep-frames
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { openFilm, parseArgs, ffmpeg, ffprobe, OUT, ROOT } from './capture.mjs';
import { DURATION, FPS } from '../src/timeline.js';

const args = parseArgs();
const preview = !!args.preview;
const profile = preview
  ? { name: 'preview', vw: 640, vh: 360, scale: Number(args.scale || 1.5), ow: 640, oh: 360, out: path.join(OUT, 'preview_640x360.mp4') }
  : { name: 'final', vw: 1920, vh: 1080, scale: Number(args.scale || 2), ow: 1920, oh: 1080, out: path.join(OUT, 'film_16x9.mp4') };
const CHUNK = Number(args.chunk || 5);
const totalFrames = Math.round(DURATION * FPS);
const framesPerChunk = Math.round(CHUNK * FPS);
const nChunks = Math.ceil(totalFrames / framesPerChunk);
const fromChunk = Math.floor((Number(args.from || 0) * FPS) / framesPerChunk);
const toChunk = Math.min(nChunks, Math.ceil((Number(args.to || DURATION) * FPS) / framesPerChunk));
const work = path.join(OUT, 'chunks', profile.name);
fs.mkdirSync(work, { recursive: true });

const BT709 = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];
const chunkPath = (k) => path.join(work, `chunk_${String(k).padStart(3, '0')}.mkv`);
const donePath = (k) => chunkPath(k) + '.done';

const pending = [];
for (let k = fromChunk; k < toChunk; k++) if (!fs.existsSync(donePath(k))) pending.push(k);
console.log(`profile ${profile.name}: ${nChunks} chunks of ${CHUNK}s, ${pending.length} to render (${profile.vw}x${profile.vh} @ ${profile.scale}x -> ${profile.ow}x${profile.oh})`);

if (pending.length) {
  const film = await openFilm({ cpu: !!args.cpu, headed: !!args.headed, width: profile.vw, height: profile.vh, scale: profile.scale });
  console.log('WebGL renderer:', film.info.renderer);
  if (!args.cpu && /swiftshader/i.test(film.info.renderer)) {
    console.warn('WARNING: Chromium fell back to SwiftShader (software). Try `npm run render -- --headed`, or check GPU drivers.');
  }
  const started = Date.now();
  let framesDone = 0;
  const totalPending = pending.reduce((s, k) => s + Math.min(framesPerChunk, totalFrames - k * framesPerChunk), 0);
  for (const k of pending) {
    const dir = path.join(work, `chunk_${String(k).padStart(3, '0')}_frames`);
    fs.mkdirSync(dir, { recursive: true });
    const f0 = k * framesPerChunk, f1 = Math.min(totalFrames, f0 + framesPerChunk);
    for (let f = f0; f < f1; f++) {
      const file = path.join(dir, `${String(f - f0).padStart(5, '0')}.png`);
      if (fs.existsSync(file)) { framesDone++; continue; }
      const buf = await film.frame(f / FPS);
      fs.writeFileSync(file + '.tmp', buf);
      fs.renameSync(file + '.tmp', file);
      framesDone++;
      const el = (Date.now() - started) / 1000;
      const eta = (el / framesDone) * (totalPending - framesDone);
      process.stdout.write(`\rchunk ${k + 1}/${nChunks}  frame ${f + 1}/${totalFrames}  ${(el / framesDone).toFixed(1)} s/frame  ETA ${(eta / 3600).toFixed(2)} h   `);
    }
    // downscale (Lanczos) + BT.709 conversion into a near-lossless 10-bit 4:4:4 intermediate
    ffmpeg(['-framerate', String(FPS), '-i', path.join(dir, '%05d.png'),
      '-vf', `scale=${profile.ow}:${profile.oh}:flags=lanczos+accurate_rnd+full_chroma_int+full_chroma_inp:out_color_matrix=bt709:out_range=tv,format=yuv444p10le`,
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '4', '-profile:v', 'high444', '-pix_fmt', 'yuv444p10le', ...BT709, chunkPath(k)]);
    fs.writeFileSync(donePath(k), new Date().toISOString());
    if (!args['keep-frames']) fs.rmSync(dir, { recursive: true, force: true });
  }
  await film.close();
  console.log('');
}

// all chunks present?
const missing = [];
for (let k = 0; k < nChunks; k++) if (!fs.existsSync(donePath(k))) missing.push(k);
if (missing.length) {
  console.log(`chunks still missing: ${missing.join(', ')} — run again to continue.`);
  process.exit(0);
}

// score
const wav = path.join(OUT, 'score.wav');
if (!fs.existsSync(wav)) {
  console.log('rendering score…');
  const r = spawnSync(process.execPath, [path.join(ROOT, 'film', 'scripts', 'audio.mjs')], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('audio render failed');
}

// join + final encode (H.264 High, yuv420p, CRF 17, preset slow, BT.709, AAC 256k 48 kHz, faststart).
// A VBV cap keeps the file under 95 MB in the worst case; in this mostly dark film CRF 17 sits below it.
const list = path.join(work, 'concat.txt');
fs.writeFileSync(list, Array.from({ length: nChunks }, (_, k) => `file '${chunkPath(k)}'`).join('\n'));
const capKbps = preview ? 1500 : 6500;
ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-i', wav,
  '-map', '0:v:0', '-map', '1:a:0',
  '-vf', 'scale=in_color_matrix=bt709:out_color_matrix=bt709:in_range=tv:out_range=tv:flags=accurate_rnd+full_chroma_int,format=yuv420p',
  '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'slow', '-crf', '17', '-maxrate', `${capKbps}k`, '-bufsize', `${capKbps * 2}k`,
  '-pix_fmt', 'yuv420p', '-x264-params', 'colorprim=bt709:transfer=bt709:colormatrix=bt709:range=tv',
  ...BT709, '-r', String(FPS),
  '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-ac', '2',
  '-t', String(DURATION), '-movflags', '+faststart', profile.out], { quiet: false });

const probe = JSON.parse(ffprobe(['-v', 'error', '-show_format', '-show_streams', '-of', 'json', profile.out]));
const v = probe.streams.find((s) => s.codec_type === 'video'), a = probe.streams.find((s) => s.codec_type === 'audio');
const sizeMB = Number(probe.format.size) / 1e6;
console.log(`\n${profile.out}
  duration ${Number(probe.format.duration).toFixed(3)} s, size ${sizeMB.toFixed(1)} MB
  video ${v.codec_name} ${v.profile} ${v.width}x${v.height} ${v.pix_fmt} ${v.r_frame_rate} fps, ${v.color_space}/${v.color_primaries}/${v.color_transfer} ${v.color_range}
  audio ${a.codec_name} ${a.sample_rate} Hz ${a.channels} ch ${Math.round(a.bit_rate / 1000)} kb/s, duration ${Number(a.duration).toFixed(3)} s`);
if (sizeMB > 95) console.warn('WARNING: file is over 95 MB');
