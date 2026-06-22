import puppeteer from 'puppeteer';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SHOTS = join(ROOT, 'screenshots');

const browser = await puppeteer.launch({
  headless: false,
  args: [
    `--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`,
    '--no-first-run', `--user-data-dir=/tmp/pps_${Date.now()}`,
    '--window-size=1400,800', '--no-sandbox', '--disable-setuid-sandbox',
    '--disable-features=ChromeWhatsNewUI'
  ]
});

// Get extension ID from a background/extension page target
const targets = browser.targets();
let extId = null;
for (const t of targets) {
  const url = t.url();
  // Background service worker URL looks like:
  // chrome-extension://<id>/src/background/serviceWorker.html
  if (url.startsWith('chrome-extension://')) {
    extId = url.split('/')[2];
    break;
  }
}

if (extId) {
  console.log(`Extension ID: ${extId}`);
  const spPage = await browser.newPage();
  await spPage.setViewport({ width: 380, height: 800 });
  await spPage.goto(`chrome-extension://${extId}/sidepanel/sidepanel.html`, {
    waitUntil: 'networkidle0', timeout: 15000
  });
  await new Promise(r => setTimeout(r, 2000));
  await spPage.screenshot({ path: join(SHOTS, 'sidepanel.png'), fullPage: true });
  console.log('✅ sidepanel.png');
  await spPage.close();
} else {
  console.log('Extension ID not found from targets');
  // Try navigating to a page with the extension to trigger it
  const p = await browser.newPage();
  await p.goto('https://www.w3schools.com/html/html5_video.asp', {
    waitUntil: 'networkidle2', timeout: 30000
  });
  await new Promise(r => setTimeout(r, 2000));
  // Check targets again
  for (const t of browser.targets()) {
    const url = t.url();
    if (url.startsWith('chrome-extension://')) {
      extId = url.split('/')[2];
      break;
    }
  }
  console.log(`After navigation, extension ID: ${extId}`);
  await p.close();

  if (extId) {
    const spPage = await browser.newPage();
    await spPage.setViewport({ width: 380, height: 800 });
    await spPage.goto(`chrome-extension://${extId}/sidepanel/sidepanel.html`, {
      waitUntil: 'networkidle0', timeout: 15000
    });
    await new Promise(r => setTimeout(r, 2000));
    await spPage.screenshot({ path: join(SHOTS, 'sidepanel.png'), fullPage: true });
    console.log('✅ sidepanel.png');
    await spPage.close();
  }
}

await browser.close();