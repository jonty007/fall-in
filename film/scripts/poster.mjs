// Render the portrait poster: node film/scripts/poster.mjs [--cpu]  -> film/out/poster.jpg (2000x3000)
import fs from 'node:fs';
import path from 'node:path';
import { startServer } from './serve.mjs';
import { launch } from './browser.mjs';
import { parseArgs, ffmpeg, OUT } from './capture.mjs';

const args = parseArgs();
const { server, port } = await startServer();
const browser = await launch({ cpu: !!args.cpu });
const page = await browser.newPage({ viewport: { width: 1200, height: 1800 }, deviceScaleFactor: Number(args.scale || 2) });
page.on('pageerror', (e) => { console.error(e.message.slice(0, 500)); process.exit(1); });
await page.goto(`http://127.0.0.1:${port}/film/src/poster.html`);
await page.waitForFunction(() => window.ready === true, null, { timeout: 120000 });
await page.evaluate(() => window.render());
const raw = path.join(OUT, 'tmp', 'poster_raw.png');
fs.mkdirSync(path.dirname(raw), { recursive: true });
await page.screenshot({ path: raw });
await browser.close();
server.close();
const dst = args.out ? path.resolve(args.out) : path.join(OUT, 'poster.jpg');
ffmpeg(['-i', raw, '-vf', 'scale=2000:3000:flags=lanczos+accurate_rnd', '-q:v', '2', dst]);
console.log('poster:', path.join(OUT, 'poster.jpg'));
