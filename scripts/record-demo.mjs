import puppeteer from 'puppeteer';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { mkdirSync, rmSync, existsSync, statSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SHOTS = join(ROOT, 'screenshots');

function injectUI(page) {
  return page.evaluate(() => {
    const s = document.createElement('style');
    s.textContent = `
      #dk { position:fixed;bottom:55px;left:50%;transform:translateX(-50%);z-index:999999;
            font-family:'SF Mono',Menlo,monospace;pointer-events:none;text-align:center; }
      #dk .keys { display:flex;gap:6px;justify-content:center;margin-bottom:6px; }
      #dk kbd { background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.3);
                border-radius:5px;padding:5px 12px;font-size:16px;font-weight:700;color:#fff;
                box-shadow:0 2px 5px rgba(0,0,0,0.4); }
      #dk .cap { color:#fff;font-size:14px;background:rgba(0,0,0,0.75);padding:6px 16px;
                 border-radius:6px;line-height:1.5;backdrop-filter:blur(4px); }
    `;
    document.head.appendChild(s);
    const d = document.createElement('div'); d.id = 'dk';
    d.innerHTML = '<div class="keys"></div><div class="cap"></div>';
    document.body.appendChild(d);
  });
}

function show(page, keys, cap) {
  return page.evaluate(({keys, cap}) => {
    document.querySelector('#dk .keys').innerHTML = keys.map(k => `<kbd>${k}</kbd>`).join('');
    document.querySelector('#dk .cap').innerHTML = cap;
  }, {keys, cap});
}

function fmtTime(s) {
  const m = Math.floor(s/60);
  const sec = Math.floor(s%60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

async function recordGif(name, fps, fn) {
  const FRAMES = join(SHOTS, 'frames');
  if (existsSync(FRAMES)) rmSync(FRAMES, { recursive: true });
  mkdirSync(FRAMES, { recursive: true });

  let frameNum = 0;
  const cap = page => page.screenshot({ path: join(FRAMES, `${String(frameNum++).padStart(3, '0')}.png`) });

  const browser = await puppeteer.launch({
    headless: false,
    args: [
      `--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`,
      '--no-first-run', `--user-data-dir=/tmp/ppg_${Date.now()}`,
      '--window-size=1100,700', '--no-sandbox', '--disable-setuid-sandbox',
      '--disable-features=ChromeWhatsNewUI'
    ]
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1100, height: 700 });
    await page.goto(`file://${join(ROOT, 'tests/test-page.html')}`, {
      waitUntil: 'networkidle0', timeout: 20000
    });
    await new Promise(r => setTimeout(r, 2500));
    await injectUI(page);

    await page.evaluate(() => {
      const v = document.querySelector('video');
      if (v) { v.currentTime = 0; v.muted = true; v.playbackRate = 1; v.play().catch(() => {}); }
    });
    await new Promise(r => setTimeout(r, 1000));

    await fn(page, cap, show);

    await page.close();
  } finally {
    await browser.close();
  }

  console.log(`  ${frameNum} frames captured`);

  // Generate GIF
  const output = join(SHOTS, `${name}.gif`);
  const interval = 1000 / fps;
  const cmd = `ffmpeg -y -framerate ${fps} -i ${FRAMES}/%03d.png ` +
    `-vf "fps=${fps},scale=700:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=64[p];[s1][p]paletteuse=dither=floyd_steinberg" ` +
    `-loop 0 ${output} 2>&1 | tail -3`;
  execSync(cmd).toString();
  console.log(`  ✅ ${name}.gif (${(statSync(output).size/1024).toFixed(0)} KB)`);

  rmSync(FRAMES, { recursive: true });
  return output;
}

// ──────────────────────────────────────────
// GIF 1: Speed Controls
// Sequence: d×3 → 1.3x, wait 2s, a, wait 2s, a, wait 2s
// ──────────────────────────────────────────
async function recordSpeedGif(page, cap, show) {
  const captureLoop = async (ms) => {
    const every = 250;
    let elapsed = 0;
    while (elapsed < ms) {
      await new Promise(r => setTimeout(r, every));
      await cap(page);
      elapsed += every;
    }
  };

  const pressKey = async (key, label, afterMs = 0) => {
    await show(page, [key], label);
    await new Promise(r => setTimeout(r, 200));
    await cap(page);
    await page.keyboard.press(key);
    if (afterMs > 0) await captureLoop(afterMs);
  };

  const wait = async (ms, label) => {
    if (label) await show(page, [], label);
    await captureLoop(ms);
  };

  // Initial: 1×, progress bar visible
  await show(page, [], 'Speed: 1×');
  await captureLoop(600);

  // d × 3 → 1.3×
  await pressKey('d', 'd → speed up', 500);
  await pressKey('d', 'd → speed up', 500);
  await pressKey('d', 'd → speed 1.3×', 500);

  // Wait 2 seconds — see 1.3× clearly
  await wait(2000, 'Speed: 1.3×');

  // a → toggle to 1×
  await pressKey('a', 'a → toggle to 1×', 500);

  // Wait 2 seconds — see 1× clearly
  await wait(2000, 'Speed: 1×');

  // a → toggle back to 1.3×
  await pressKey('a', 'a → toggle to 1.3×', 500);

  // Wait 2 seconds
  await wait(2000, 'Speed: 1.3×');

  // End — just a clean last frame
  await show(page, [], '');
  await captureLoop(400);
}

// ──────────────────────────────────────────
// GIF 2: Hold Controls
// Hold Z 5s, release, hold X 5s, release
// ──────────────────────────────────────────
async function recordHoldGif(page, cap, show) {
  const captureLoop = async (ms) => {
    const every = 250;
    let elapsed = 0;
    while (elapsed < ms) {
      await new Promise(r => setTimeout(r, every));
      await cap(page);
      elapsed += every;
    }
  };

  const holdKey = async (key, label, holdMs) => {
    await show(page, [key.toUpperCase()], label);
    await new Promise(r => setTimeout(r, 200));
    await cap(page);
    await page.keyboard.down(key);
    await captureLoop(holdMs);
    await page.keyboard.up(key);
    await show(page, [], 'Released — back to normal');
    await captureLoop(600);
  };

  // Initial: 1×, video playing, progress bar advancing
  await page.evaluate(() => {
    const v = document.querySelector('video');
    if (v) { v.currentTime = 0; v.playbackRate = 1; }
  });
  await show(page, [], 'Speed: 1× — progress bar visible');
  await captureLoop(800);

  // Hold Z — slow motion 5 seconds
  await holdKey('z', 'Hold Z — slow motion 0.4×', 5000);

  // Reset video position for next demo
  await page.evaluate(() => {
    const v = document.querySelector('video');
    if (v) { v.currentTime = 3; v.playbackRate = 1; }
  });
  await show(page, [], 'Speed: 1×');
  await captureLoop(600);

  // Hold X — fast-forward 5 seconds
  await holdKey('x', 'Hold X — fast-forward 2×', 5000);

  // End — clean last frame
  await show(page, [], '');
  await captureLoop(400);
}

(async () => {
  console.log('=== GIF 1: Speed & Toggle (3 fps) ===');
  await recordGif('demo-speed', 3, recordSpeedGif);

  console.log('=== GIF 2: Hold Controls (3 fps) ===');
  await recordGif('demo-hold', 3, recordHoldGif);

  console.log('Done.');
})();