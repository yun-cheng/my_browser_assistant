import puppeteer from 'puppeteer';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { mkdirSync, rmSync, existsSync, statSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const FRAMES_DIR = join(ROOT, 'screenshots', 'frames');
const OUTPUT = join(ROOT, 'screenshots', 'demo.gif');

if (existsSync(FRAMES_DIR)) rmSync(FRAMES_DIR, { recursive: true });
mkdirSync(FRAMES_DIR, { recursive: true });

let frameNum = 0;
const capture = page => page.screenshot({ path: join(FRAMES_DIR, `${String(frameNum++).padStart(3, '0')}.png`) });

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    args: [
      `--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`,
      '--no-first-run', `--user-data-dir=/tmp/ppg_${Date.now()}`,
      '--window-size=1100,700', '--no-sandbox', '--disable-setuid-sandbox',
      '--disable-features=ChromeWhatsNewUI'
    ]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1100, height: 700 });

  // Navigate to test page
  await page.goto(`file://${join(ROOT, 'tests/test-page.html')}`, {
    waitUntil: 'networkidle0', timeout: 20000
  });
  await new Promise(r => setTimeout(r, 2500));
  console.log('Page loaded');

  // Inject key overlay
  await page.evaluate(() => {
    const style = document.createElement('style');
    style.textContent = `
      #demo-k { position:fixed;bottom:70px;left:50%;transform:translateX(-50%);z-index:999999;
                font-family:monospace;pointer-events:none;text-align:center; }
      #demo-k .keys { display:flex;gap:6px;justify-content:center;margin-bottom:6px; }
      #demo-k kbd { background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.25);
                    border-radius:5px;padding:4px 10px;font-size:16px;font-weight:600;color:#fff; }
      #demo-k .cap { color:#fff;font-size:14px;background:rgba(0,0,0,0.6);padding:6px 16px;border-radius:6px; }
    `;
    document.head.appendChild(style);
    const div = document.createElement('div');
    div.id = 'demo-k';
    div.innerHTML = '<div class="keys"></div><div class="cap"></div>';
    document.body.appendChild(div);
  });
  const setKeys = (keys, cap) => page.evaluate(({keys, cap}) => {
    document.querySelector('#demo-k .keys').innerHTML = keys.map(k => `<kbd>${k}</kbd>`).join('');
    document.querySelector('#demo-k .cap').textContent = cap;
  }, {keys, cap});

  // Start video
  await page.evaluate(() => {
    const v = document.querySelector('video');
    if (v) { v.muted = true; v.playbackRate = 1; v.play().catch(() => {}); }
  });
  await new Promise(r => setTimeout(r, 1500));

  // ── Demo sequence ──
  await setKeys([], 'Speed: 1× • Step: 10s');
  await new Promise(r => setTimeout(r, 600));
  await capture(page);
  console.log('Frame 0: initial');

  // D x 3 → 1.3x
  for (const [key, cap] of [['d','d → speed 1.1×'], ['d','d → speed 1.2×'], ['d','d → speed 1.3×']]) {
    await setKeys([key], cap);
    await new Promise(r => setTimeout(r, 300));
    await page.keyboard.press(key);
    await new Promise(r => setTimeout(r, 500));
    await capture(page);
  }
  console.log('Frames: speed up to 1.3×');

  // A x 2 → toggle
  await setKeys(['a'], 'a → toggle to 1×');
  await new Promise(r => setTimeout(r, 200));
  await capture(page);
  await page.keyboard.press('a');
  await new Promise(r => setTimeout(r, 500));
  await capture(page);

  await setKeys(['a'], 'a → toggle back to 1.3×');
  await page.keyboard.press('a');
  await new Promise(r => setTimeout(r, 500));
  await capture(page);
  console.log('Frames: toggle');

  // Hold Z
  await setKeys(['Z'], 'Hold Z → slow motion 0.4×');
  await page.keyboard.down('z');
  await new Promise(r => setTimeout(r, 700));
  await capture(page);
  await page.keyboard.up('z');
  await new Promise(r => setTimeout(r, 400));

  // Hold X
  await setKeys(['X'], 'Hold X → fast-forward 2×');
  await page.keyboard.down('x');
  await new Promise(r => setTimeout(r, 700));
  await capture(page);
  await page.keyboard.up('x');
  await new Promise(r => setTimeout(r, 400));
  console.log('Frames: hold FF/slow-mo');

  // Final
  await setKeys([], 'Customize everything in the side panel');
  await new Promise(r => setTimeout(r, 800));
  await capture(page);

  await page.close();
  await browser.close();
  console.log(`Total: ${frameNum} frames`);

  // ── GIF generation ──
  console.log('Generating GIF...');
  const cmd = `ffmpeg -y -framerate 1.8 -i ${FRAMES_DIR}/%03d.png ` +
    `-vf "fps=1.8,scale=800:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=64[p];[s1][p]paletteuse=dither=bayer" ` +
    `-loop 0 ${OUTPUT} 2>&1 | tail -5`;
  const result = execSync(cmd).toString();
  console.log(result);
  console.log(`✅ demo.gif (${(statSync(OUTPUT).size/1024).toFixed(0)} KB)`);
})();