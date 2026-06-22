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
const cap = page => page.screenshot({ path: join(FRAMES_DIR, `${String(frameNum++).padStart(3, '0')}.png`) });

// Inject key overlay into page
const injectOverlay = page => page.evaluate(() => {
  const s = document.createElement('style');
  s.textContent = `
    #dk { position:fixed;bottom:60px;left:50%;transform:translateX(-50%);z-index:999999;
          font-family:'SF Mono',Menlo,monospace;pointer-events:none;text-align:center;
          transition:opacity .15s; }
    #dk .keys { display:flex;gap:8px;justify-content:center;margin-bottom:8px; }
    #dk kbd { background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.3);
              border-radius:6px;padding:6px 14px;font-size:17px;font-weight:700;color:#fff;
              box-shadow:0 2px 6px rgba(0,0,0,0.4); }
    #dk .cap { color:#fff;font-size:15px;background:rgba(0,0,0,0.75);padding:8px 20px;
               border-radius:8px;line-height:1.5;backdrop-filter:blur(4px); }
  `;
  document.head.appendChild(s);
  const d = document.createElement('div'); d.id = 'dk';
  d.innerHTML = '<div class="keys"></div><div class="cap"></div>';
  document.body.appendChild(d);
});

const showKeys = (page, keys, cap) => page.evaluate(({keys, cap}) => {
  document.querySelector('#dk .keys').innerHTML = keys.map(k => `<kbd>${k}</kbd>`).join('');
  document.querySelector('#dk .cap').innerHTML = cap;
}, {keys, cap});

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

  await page.goto(`file://${join(ROOT, 'tests/test-page.html')}`, {
    waitUntil: 'networkidle0', timeout: 20000
  });
  await new Promise(r => setTimeout(r, 3000));
  await injectOverlay(page);

  // Start video from beginning
  await page.evaluate(() => {
    const v = document.querySelector('video');
    if (v) { v.currentTime = 0; v.muted = true; v.playbackRate = 1; v.play().catch(() => {}); }
  });
  await new Promise(r => setTimeout(r, 1000));

  // ────────────────────────────────────────────
  // Helper: press key, then wait and capture
  // ────────────────────────────────────────────
  const pressAndCapture = async (key, label, waitMs = 1000) => {
    await showKeys(page, [key], label);
    await new Promise(r => setTimeout(r, 300));
    await page.keyboard.press(key);
    await new Promise(r => setTimeout(r, waitMs));
    await showKeys(page, [], '');
    await cap(page);
  };

  const holdAndCapture = async (key, label, holdMs = 900) => {
    await showKeys(page, [key.toUpperCase()], label);
    await page.keyboard.down(key);
    await new Promise(r => setTimeout(r, holdMs));
    await cap(page); // capture mid-hold
    await page.keyboard.up(key);
    await new Promise(r => setTimeout(r, 500));
    await showKeys(page, [], '');
    await cap(page); // capture after release
  };

  // ============= DEMO SEQUENCE =============

  // 1. Initial state
  await showKeys(page, [], 'Default: 1× speed, 10s step, overlay visible');
  await new Promise(r => setTimeout(r, 800));
  await cap(page);
  await showKeys(page, [], '');
  await new Promise(r => setTimeout(r, 400));

  // 2. Speed up: d × 3 (1.0 → 1.3)
  await pressAndCapture('d', 'd → speed +0.1', 700);
  await pressAndCapture('d', 'd → speed 1.2×', 700);
  await pressAndCapture('d', 'd → speed 1.3×', 1200);

  // 3. Show result
  await showKeys(page, [], '1.3× speed — overlay shows "1.3×/10"');
  await new Promise(r => setTimeout(r, 1200));
  await cap(page);
  await showKeys(page, [], '');
  await new Promise(r => setTimeout(r, 300));

  // 4. Toggle back to 1×
  await pressAndCapture('a', 'a → toggle to 1×', 1000);
  await showKeys(page, [], 'Back to 1×');
  await new Promise(r => setTimeout(r, 800));
  await cap(page);
  await showKeys(page, [], '');
  await new Promise(r => setTimeout(r, 300));

  // 5. Toggle back to 1.3×
  await pressAndCapture('a', 'a → toggle back to 1.3×', 1200);

  // 6. Resume to 1× before hold demos, seek to start
  await page.evaluate(() => {
    const v = document.querySelector('video');
    if (v) { v.playbackRate = 1; v.currentTime = 1; }
  });
  await new Promise(r => setTimeout(r, 500));
  await cap(page);

  // 7. Hold Z — slow motion
  await holdAndCapture('z', 'Hold Z → slow motion 0.4×', 900);
  await showKeys(page, [], 'Released — back to normal speed');
  await new Promise(r => setTimeout(r, 600));
  await cap(page);
  await showKeys(page, [], '');
  await new Promise(r => setTimeout(r, 300));

  // 8. Hold X — fast-forward
  await holdAndCapture('x', 'Hold X → fast-forward 2×', 900);
  await showKeys(page, [], 'Released — back to normal speed');
  await new Promise(r => setTimeout(r, 600));
  await cap(page);
  await showKeys(page, [], '');
  await new Promise(r => setTimeout(r, 300));

  // 9. Final
  await showKeys(page, [], 'All keys, speeds, and styles customizable in side panel');
  await new Promise(r => setTimeout(r, 1200));
  await cap(page);

  // 10. Side panel preview
  await showKeys(page, [], 'Open side panel → click extension icon');
  await new Promise(r => setTimeout(r, 800));
  await cap(page);

  await page.close();
  await browser.close();
  console.log(`Frames: ${frameNum}`);

  // ── GIF generation: very slow (0.6 fps = each frame ~1.7s) ──
  console.log('Generating GIF...');
  const cmd = `ffmpeg -y -framerate 0.6 -i ${FRAMES_DIR}/%03d.png ` +
    `-vf "fps=0.6,scale=900:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer" ` +
    `-loop 0 ${OUTPUT} 2>&1 | tail -5`;
  const result = execSync(cmd).toString();
  console.log(result);
  console.log(`✅ demo.gif (${(statSync(OUTPUT).size/1024).toFixed(0)} KB)`);
})();