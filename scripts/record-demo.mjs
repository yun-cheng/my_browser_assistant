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

async function recordGif(name, fn) {
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

    // Start video from beginning
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
  const cmd = `ffmpeg -y -framerate 4 -i ${FRAMES}/%03d.png ` +
    `-vf "fps=4,scale=700:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=64[p];[s1][p]paletteuse=dither=floyd_steinberg" ` +
    `-loop 0 ${output} 2>&1 | tail -3`;
  execSync(cmd).toString();
  console.log(`  ✅ ${name}.gif (${(statSync(output).size/1024).toFixed(0)} KB)`);

  rmSync(FRAMES, { recursive: true });
  return output;
}

// ──────────────────────────────────────────
// GIF 1: Speed Controls
// ──────────────────────────────────────────
async function recordSpeedGif(page, cap, show) {
  // Helper: press key, wait, continue capturing
  const doKey = async (key, label, waitMs = 700) => {
    await show(page, [key], label);
    await new Promise(r => setTimeout(r, 200));
    await page.keyboard.press(key);
    // Capture multiple frames during wait
    const interval = 200;
    let elapsed = 0;
    while (elapsed < waitMs) {
      await new Promise(r => setTimeout(r, interval));
      await cap(page);
      elapsed += interval;
    }
  };

  const wait = async (ms, label = '') => {
    if (label) await show(page, [], label);
    const interval = 200;
    let elapsed = 0;
    while (elapsed < ms) {
      await new Promise(r => setTimeout(r, interval));
      await cap(page);
      elapsed += interval;
    }
  };

  // Start: show 1× speed
  await show(page, [], 'Speed: 1×');
  await wait(600);

  // Speed up ×3
  await doKey('d', 'd → +0.1', 600);
  await doKey('d', 'd → +0.1', 600);
  await doKey('d', 'd → speed 1.3×', 800);
  await wait(800, 'Speed: 1.3×');

  // Toggle to 1×
  await doKey('a', 'a → toggle', 700);
  await wait(600, 'Speed: 1×');

  // Toggle back to 1.3×
  await doKey('a', 'a → toggle again', 700);
  await wait(800, 'Speed: 1.3×');

  // Final
  await show(page, [], 'Customizable in side panel');
  await wait(800);
}

// ──────────────────────────────────────────
// GIF 2: Hold Controls (slow-mo & fast-forward)
// ──────────────────────────────────────────
async function recordHoldGif(page, cap, show) {
  const wait = async (ms, label = '') => {
    if (label) await show(page, [], label);
    const interval = 200;
    let elapsed = 0;
    while (elapsed < ms) {
      await new Promise(r => setTimeout(r, interval));
      await cap(page);
      elapsed += interval;
    }
  };

  const holdKey = async (key, label, holdMs = 3000) => {
    await show(page, [key.toUpperCase()], label);
    await new Promise(r => setTimeout(r, 200));
    await cap(page);
    await page.keyboard.down(key);
    const interval = 200;
    let elapsed = 0;
    while (elapsed < holdMs) {
      await new Promise(r => setTimeout(r, interval));
      await cap(page);
      elapsed += interval;
    }
    await page.keyboard.up(key);
    await show(page, [], 'Released — back to normal');
    await new Promise(r => setTimeout(r, 300));
    await cap(page);
  };

  // Start: 1× speed
  await show(page, [], 'Speed: 1×');
  await wait(600);

  // Hold Z — slow motion for 3s
  await holdKey('z', 'Hold Z — slow motion 0.4×', 3000);
  await wait(800, 'Back to 1×');

  // Seek back to where the video has more content
  await page.evaluate(() => {
    const v = document.querySelector('video');
    if (v) { v.playbackRate = 1; v.currentTime = 2; }
  });
  await wait(400);

  // Hold X — fast-forward for 3s
  await holdKey('x', 'Hold X — fast-forward 2×', 3000);
  await wait(600, 'Back to 1×');

  await show(page, [], 'All keys customizable in side panel');
  await wait(600);
}

(async () => {
  console.log('=== GIF 1: Speed & Toggle ===');
  await recordGif('demo-speed', recordSpeedGif);

  console.log('=== GIF 2: Hold Controls ===');
  await recordGif('demo-hold', recordHoldGif);

  console.log('Done.');
})();