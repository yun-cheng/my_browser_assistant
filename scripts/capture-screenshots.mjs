import puppeteer from 'puppeteer';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SHOTS = join(ROOT, 'screenshots');

const POLYFILL = `
window.chrome=window.chrome||{};window.chrome.runtime=window.chrome.runtime||{id:'test-id'};
window.chrome.storage=window.chrome.storage||{};
window.chrome.storage.onChanged={addListener(){},removeListener(){}};
window.chrome.storage.sync={_data:{},get(k,cb){const r={};if(cb)setTimeout(()=>cb(r),0);return Promise.resolve(r);},set(it,cb){Object.assign(this._data,it);if(cb)setTimeout(()=>cb(),0);return Promise.resolve();}};
`;
const MIME = { '.html':'text/html', '.css':'text/css', '.js':'application/javascript' };
const server = createServer((req, res) => {
  let fp = join(ROOT, req.url === '/' ? 'sidepanel/sidepanel.html' : req.url);
  if (!fp.startsWith(ROOT)) { res.writeHead(403); res.end(''); return; }
  const ext = fp.match(/\.[^.]+$/)?.[0] || '.html';
  if (existsSync(fp)) {
    let c = readFileSync(fp, 'utf-8');
    if (ext==='.html') c = c.replace('</head>', `<script>${POLYFILL}</script>\n</head>`);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
    res.end(c);
  } else { res.writeHead(404); res.end(''); }
});
const PORT = 0;
await new Promise(r => server.listen(PORT, '127.0.0.1', r));
const port = server.address().port;

const browser = await puppeteer.launch({
  headless: false,
  args: [
    `--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`,
    '--no-first-run', `--user-data-dir=/tmp/ppc_${Date.now()}`,
    '--window-size=1400,900', '--no-sandbox', '--disable-setuid-sandbox'
  ]
});

// Side panel
const sp = await browser.newPage();
await sp.setViewport({ width: 400, height: 750 });
await sp.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle0', timeout: 15000 });
await sp.waitForSelector('#settingsForm', { timeout: 5000 });
await new Promise(r => setTimeout(r, 1000));
await sp.screenshot({ path: join(SHOTS, 'sidepanel.png'), fullPage: true });
console.log('✅ sidepanel.png');

// Overlay
const vp = await browser.newPage();
await vp.setViewport({ width: 1400, height: 800 });
await vp.goto(`file://${join(ROOT, 'tests/test-page.html')}`, {
  waitUntil: 'networkidle0', timeout: 15000
});
await new Promise(r => setTimeout(r, 3000));

// Increase speed
for (let i = 0; i < 3; i++) { await vp.keyboard.press('d'); await new Promise(r => setTimeout(r, 400)); }
await vp.screenshot({ path: join(SHOTS, 'overlay-on-video.png') });
console.log('✅ overlay-on-video.png');

// Close-up
const box = await vp.evaluate(() => {
  const el = document.querySelector('.my-browser-assistant-overlay');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
if (box && box.w > 10) {
  await vp.screenshot({
    path: join(SHOTS, 'overlay-closeup.png'),
    clip: { x: Math.max(0, box.x-24), y: Math.max(0, box.y-10), width: box.w+48, height: box.h+20 }
  });
  console.log('✅ overlay-closeup.png');
}

await sp.close(); await vp.close(); await browser.close(); server.close();
console.log('Done.');