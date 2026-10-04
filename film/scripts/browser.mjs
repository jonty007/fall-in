// Launch Playwright Chromium. Default: the machine's GPU. --cpu: SwiftShader (software WebGL).
import { chromium } from 'playwright';
import fs from 'node:fs';

export function gpuArgs() {
  switch (process.platform) {
    case 'darwin': return ['--use-angle=metal'];
    case 'win32': return ['--use-angle=d3d11'];
    default: return ['--use-angle=vulkan', '--enable-features=Vulkan', '--use-gl=angle'];
  }
}

export async function launch({ cpu = false, headed = false } = {}) {
  const common = ['--ignore-gpu-blocklist', '--disable-gpu-watchdog', '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--enable-gpu-rasterization'];
  const args = cpu
    ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', ...common]
    : [...gpuArgs(), '--enable-gpu', ...common];
  const opts = { headless: !headed, args };
  // new headless mode (full Chromium) is required for hardware GPU access
  if (!cpu && !headed) opts.channel = 'chromium';
  try {
    return await chromium.launch(opts);
  } catch (e) {
    // fall back to a locally provided Chromium (e.g. preinstalled in a container)
    const local = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => fs.existsSync(p));
    if (!local) throw e;
    delete opts.channel;
    return chromium.launch({ ...opts, executablePath: local });
  }
}
