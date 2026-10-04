// Shared capture helpers: start the static server, open the film page in Playwright
// Chromium, seek to a time, wait for the full draw, screenshot.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { startServer } from './serve.mjs';
import { launch } from './browser.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const OUT = path.join(ROOT, 'film', 'out');

const require = createRequire(import.meta.url);
function resolveBin(envName, pkg, fallback) {
  if (process.env[envName]) return process.env[envName];
  try {
    const p = pkg === 'ffprobe-static' ? require(pkg).path : require(pkg);
    if (p && fs.existsSync(p)) return p;
  } catch { /* not installed */ }
  return fallback;
}
export const FFMPEG = resolveBin('FFMPEG', 'ffmpeg-static', 'ffmpeg');
export const FFPROBE = resolveBin('FFPROBE', 'ffprobe-static', 'ffprobe');

export function parseArgs(argv = process.argv.slice(2)) {
  const out = { _: [] };
  for (const a of argv) {
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      out[k] = v === undefined ? true : v;
    } else out._.push(a);
  }
  return out;
}

export async function openFilm({ cpu = false, headed = false, width = 1920, height = 1080, scale = 2 } = {}) {
  const { server, port } = await startServer();
  const browser = await launch({ cpu, headed });
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: scale });
  page.on('pageerror', (e) => { console.error('[pageerror]', e.message.slice(0, 800)); process.exit(1); });
  page.on('console', (m) => { if (m.type() === 'error') console.error('[page]', m.text().slice(0, 400)); });
  await page.goto(`http://127.0.0.1:${port}/film/src/index.html`);
  await page.waitForFunction(() => window.ready === true, null, { timeout: 180000 });
  const info = await page.evaluate(() => ({ renderer: window.rendererName, duration: window.duration, fps: window.fps }));
  const close = async () => { await browser.close(); server.close(); };
  const frame = async (t, file) => {
    await page.evaluate((tt) => window.seek(tt), t);
    const buf = await page.screenshot({ type: 'png', animations: 'disabled', caret: 'hide' });
    if (file) fs.writeFileSync(file, buf);
    return buf;
  };
  return { page, info, frame, close };
}

export function ffmpeg(args, { quiet = true } = {}) {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', quiet ? 'error' : 'info', '-y', ...args], { stdio: ['ignore', 'inherit', 'inherit'] });
  if (r.status !== 0) throw new Error(`ffmpeg failed (${r.status}): ${args.join(' ')}`);
}
export function ffprobe(args) {
  const r = spawnSync(FFPROBE, args, { encoding: 'utf8' });
  return r.stdout;
}

// Lanczos downscale of a 2x screenshot to the delivery size (PNG out)
export function downscalePng(src, dst, w = 1920, h = 1080) {
  ffmpeg(['-i', src, '-vf', `scale=${w}:${h}:flags=lanczos+accurate_rnd+full_chroma_int`, dst]);
}

export const fmtTime = (t) => `${String(Math.floor(t / 60)).padStart(1, '0')}:${(t % 60).toFixed(1).padStart(4, '0')}`;
export { spawn };
