// Render look-development stills: node film/scripts/lookdev.mjs <shots.json> <outdir> [--cpu] [--scale=2] [--w=1920 --h=1080]
import fs from 'node:fs';
import path from 'node:path';
import { startServer } from './serve.mjs';
import { launch } from './browser.mjs';

const args = process.argv.slice(2);
const flag = (n, d) => { const a = args.find((x) => x.startsWith(`--${n}=`)); return a ? a.split('=')[1] : d; };
const shots = JSON.parse(fs.readFileSync(args[0], 'utf8'));
const outdir = args[1];
const cpu = args.includes('--cpu');
const scale = Number(flag('scale', 2));
const W = Number(flag('w', 1920)), H = Number(flag('h', 1080));
fs.mkdirSync(outdir, { recursive: true });

const { server, port } = await startServer();
const browser = await launch({ cpu });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: scale });
page.on('console', (m) => console.log('[page]', m.text()));
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:${port}/film/src/lookdev.html`);
await page.waitForFunction(() => window.ready === true, null, { timeout: 120000 });
console.log('renderer:', await page.evaluate(() => window.rendererName), 'disk T peak at r =', await page.evaluate(() => window.diskPeak));
for (const [name, shot] of Object.entries(shots)) {
  const ms = await page.evaluate((o) => window.shot(o), shot);
  const file = path.join(outdir, `${name}.png`);
  await page.screenshot({ path: file });
  console.log(`${name}: ${(ms / 1000).toFixed(2)} s`);
}
await browser.close();
server.close();
