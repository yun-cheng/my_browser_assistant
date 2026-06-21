import puppeteer from 'puppeteer';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const EXT_PATH = PROJECT_ROOT;

const HEADLESS = process.env.HEADLESS === 'true';

let passed = 0;
let failed = 0;

function assert(name, condition) {
  if (condition) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.log(`  ❌ ${name}`);
    failed++;
  }
}

// ── Polyfill for chrome.storage.sync ─────────────────────────────────
// We inject this into the page so the side panel JS works without a real extension.
const STORAGE_POLYFILL = `
window.__mba_storage = {};
window.chrome = window.chrome || {};
window.chrome.runtime = window.chrome.runtime || { id: 'test-extension-id' };

// Mock chrome.storage (namespace-level onChanged)
window.chrome.storage = window.chrome.storage || {};
window.chrome.storage._listeners = [];
window.chrome.storage.onChanged = {
  addListener(fn) { window.chrome.storage._listeners.push(fn); },
  removeListener(fn) {
    window.chrome.storage._listeners =
      window.chrome.storage._listeners.filter(l => l !== fn);
  }
};
window.chrome.storage.sync = {
  _data: {},
  get(keys, cb) {
    const result = {};
    if (typeof keys === 'string') {
      result[keys] = this._data[keys] !== undefined ? this._data[keys] : null;
    } else if (Array.isArray(keys)) {
      for (const k of keys) {
        result[k] = this._data[k] !== undefined ? this._data[k] : null;
      }
    } else if (typeof keys === 'object' && keys !== null) {
      for (const [k, def] of Object.entries(keys)) {
        result[k] = this._data[k] !== undefined ? this._data[k] : def;
      }
    }
    if (cb) setTimeout(() => cb(result), 0);
    return Promise.resolve(result);
  },
  set(items, cb) {
    Object.assign(this._data, items);
    const changes = {};
    for (const [key, newValue] of Object.entries(items)) {
      changes[key] = { newValue, oldValue: null };
    }
    for (const listener of window.chrome.storage._listeners) {
      try { listener(changes, 'sync'); } catch (e) { /* ignore */ }
    }
    if (cb) setTimeout(() => cb(), 0);
    return Promise.resolve();
  }
};
`;

// ── Simple HTTP server for side panel files ──────────────────────────
const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json'
};

const server = createServer((req, res) => {
  let filePath = join(PROJECT_ROOT, req.url === '/' ? 'sidepanel/sidepanel.html' : req.url);
  // Security: ensure filePath stays inside PROJECT_ROOT
  if (!filePath.startsWith(PROJECT_ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  const ext = filePath.match(/\.[^.]+$/)?.[0] || '.html';
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  if (existsSync(filePath)) {
    let content = readFileSync(filePath, 'utf-8');
    // Inject the storage polyfill into the HTML page
    if (ext === '.html') {
      content = content.replace(
        '</head>',
        `<script>${STORAGE_POLYFILL}</script>\n</head>`
      );
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

const PORT = 0; // OS-assigned port
await new Promise(resolve => server.listen(PORT, '127.0.0.1', resolve));
const port = server.address().port;
console.log(`  ℹ️  Test server on http://127.0.0.1:${port}\n`);

// ── Launch browser ───────────────────────────────────────────────────
const browser = await puppeteer.launch({
  headless: HEADLESS,
  args: [
    `--disable-extensions-except=${EXT_PATH}`,
    `--load-extension=${EXT_PATH}`,
    '--no-first-run',
    `--user-data-dir=/tmp/puppeteer_sp_${Date.now()}`
  ].concat(process.env.CI ? ['--no-sandbox', '--disable-setuid-sandbox'] : [])
});

console.log('=== My Browser Assistant — Side Panel Integration Test ===\n');

// ── Open side panel page via local server (polyfilled chrome.storage) ─
const panelPage = await browser.newPage();
await panelPage.setViewport({ width: 400, height: 900 });
panelPage.on('pageerror', e => console.log(`  💥 ${e.message}`));
await panelPage.goto(`http://127.0.0.1:${port}/sidepanel/sidepanel.html`, {
  waitUntil: 'networkidle0', timeout: 15000
});
await new Promise(r => setTimeout(r, 1500));

console.log('1. Side Panel Renders');
console.log('─────────────────────────');

assert('Form element exists',
  await panelPage.evaluate(() => !!document.getElementById('settingsForm')));
assert('Restore defaults button exists',
  await panelPage.evaluate(() => !!document.getElementById('restoreDefaults')));

const keyInputIds = [
  'resetKey', 'decreaseKey', 'increaseKey',
  'rewindKey', 'advanceKey', 'switchRewindAdvanceKey',
  'cycleVolumePresetKey', 'toggleOverlayKey'
];
for (const id of keyInputIds) {
  assert(`Key input #${id} rendered`,
    await panelPage.evaluate(id => {
      const el = document.getElementById(id);
      return el && el.classList.contains('key-input');
    }, id));
}

const valueInputIds = [
  'preferSpeed', 'speedAdjustmentStep', 'rewindAdvanceStep',
  'slowMotionSpeed', 'fastForwardSpeed',
  'overlayFontSize', 'overlayBackgroundAlpha'
];
for (const id of valueInputIds) {
  assert(`Value input #${id} rendered`,
    await panelPage.evaluate(id => {
      const el = document.getElementById(id);
      return el && el.classList.contains('value-input');
    }, id));
}

assert('Show overlay checkbox exists',
  await panelPage.evaluate(() => !!document.getElementById('showCurrentSpeed')));
assert('Overlay X input exists',
  await panelPage.evaluate(() => !!document.getElementById('overlayPosX')));
assert('Overlay Y input exists',
  await panelPage.evaluate(() => !!document.getElementById('overlayPosY')));
assert('Step presets input exists',
  await panelPage.evaluate(() => !!document.getElementById('rewindAdvanceStepPresets')));
assert('Volume preset input exists',
  await panelPage.evaluate(() => !!document.getElementById('volumePresetPercents')));

// ── 2. Default values ───────────────────────────────────────────────
console.log('\n2. Default Values');
console.log('───────────────────');

const keyExpect = {
  resetKey: 'A', decreaseKey: 'S', increaseKey: 'D',
  rewindKey: 'Z', advanceKey: 'X', switchRewindAdvanceKey: 'E',
  cycleVolumePresetKey: 'Q', toggleOverlayKey: 'V'
};
for (const [id, expected] of Object.entries(keyExpect)) {
  const actual = await panelPage.evaluate(id => document.getElementById(id)?.value, id);
  assert(`#${id} = "${expected}"`, actual === expected);
}

const valueExpect = {
  preferSpeed: '1.3', speedAdjustmentStep: '0.1',
  rewindAdvanceStep: '10', slowMotionSpeed: '0.4',
  fastForwardSpeed: '2', overlayFontSize: '18',
  overlayBackgroundAlpha: '0.5'
};
for (const [id, expected] of Object.entries(valueExpect)) {
  const actual = await panelPage.evaluate(id => document.getElementById(id)?.value, id);
  assert(`#${id} = ${expected}`, actual === expected || Math.abs(parseFloat(actual) - parseFloat(expected)) < 0.01);
}

const posX = await panelPage.evaluate(() => document.getElementById('overlayPosX')?.value);
const posY = await panelPage.evaluate(() => document.getElementById('overlayPosY')?.value);
assert('overlayPosX = 1%', parseInt(posX) === 1);
assert('overlayPosY = 5%', parseInt(posY) === 5);

const showChecked = await panelPage.evaluate(() => document.getElementById('showCurrentSpeed')?.checked);
assert('showCurrentSpeed checked by default', showChecked === true);

const stepPresetsVal = await panelPage.evaluate(() => document.getElementById('rewindAdvanceStepPresets')?.value);
assert(`Step presets = "2, 5, 10"`, stepPresetsVal.replace(/\s/g, '') === '2,5,10');
const volPresetsVal = await panelPage.evaluate(() => document.getElementById('volumePresetPercents')?.value);
assert(`Volume presets = "100, 50, 25"`, volPresetsVal.replace(/\s/g, '') === '100,50,25');

// ── 3. Key capture ──────────────────────────────────────────────────
console.log('\n3. Key Capture');
console.log('─────────────────');

await panelPage.evaluate(() => {
  document.getElementById('resetKey').focus();
});
await new Promise(r => setTimeout(r, 100));
await panelPage.keyboard.press('f');
await new Promise(r => setTimeout(r, 300));

let keyVal = await panelPage.evaluate(() => {
  const el = document.getElementById('resetKey');
  return { value: el.value, dataset: el.dataset.value };
});
assert(`Reset key → "F"/"f" (display="${keyVal.value}", data="${keyVal.dataset}")`,
  keyVal.value === 'F' && keyVal.dataset === 'f');

await panelPage.evaluate(() => {
  document.getElementById('increaseKey').focus();
});
await new Promise(r => setTimeout(r, 100));
await panelPage.keyboard.press('g');
await new Promise(r => setTimeout(r, 300));

keyVal = await panelPage.evaluate(() => {
  const el = document.getElementById('increaseKey');
  return { value: el.value, dataset: el.dataset.value };
});
assert(`Increase key → "G"/"g"`, keyVal.value === 'G' && keyVal.dataset === 'g');

// Tab should NOT be captured
await panelPage.evaluate(() => {
  document.getElementById('resetKey').focus();
});
await new Promise(r => setTimeout(r, 100));
await panelPage.keyboard.press('Tab');
await new Promise(r => setTimeout(r, 300));

const resetKeyAfterTab = await panelPage.evaluate(() => {
  const el = document.getElementById('resetKey');
  return el === document.activeElement;
});
assert('Tab key not captured (focus moved)', resetKeyAfterTab === false);

// ── 4. Numeric inputs ──────────────────────────────────────────────
console.log('\n4. Numeric Inputs');
console.log('────────────────────');

await panelPage.evaluate(() => {
  const el = document.getElementById('preferSpeed');
  el.value = '';
  el.value = '3.0';
  el.dispatchEvent(new Event('change', { bubbles: true }));
});
await new Promise(r => setTimeout(r, 400));

let stored = await panelPage.evaluate(() => {
  return new Promise(resolve => {
    window.chrome.storage.sync.get('my_browser_assistant_settings', result => {
      resolve(result.my_browser_assistant_settings?.preferSpeed);
    });
  });
});
assert(`preferSpeed = 3 (stored=${stored})`, Math.abs(stored - 3) < 0.01);

// ── 5. Checkbox toggle ─────────────────────────────────────────────
console.log('\n5. Checkbox Toggle');
console.log('─────────────────────');

await panelPage.evaluate(() => {
  const cb = document.getElementById('showCurrentSpeed');
  cb.checked = false;
  cb.dispatchEvent(new Event('change', { bubbles: true }));
});
await new Promise(r => setTimeout(r, 400));

stored = await panelPage.evaluate(() => {
  return new Promise(resolve => {
    window.chrome.storage.sync.get('my_browser_assistant_settings', result => {
      resolve(result.my_browser_assistant_settings?.showCurrentSpeed);
    });
  });
});
assert('showCurrentSpeed = false', stored === false);

// ── 6. Position inputs ────────────────────────────────────────────
console.log('\n6. Position Inputs');
console.log('─────────────────────');

await panelPage.evaluate(() => {
  document.getElementById('overlayPosX').value = '50';
  document.getElementById('overlayPosX').dispatchEvent(new Event('input', { bubbles: true }));
  document.getElementById('overlayPosY').value = '75';
  document.getElementById('overlayPosY').dispatchEvent(new Event('input', { bubbles: true }));
});
await new Promise(r => setTimeout(r, 400));

let pos = await panelPage.evaluate(() => {
  return new Promise(resolve => {
    window.chrome.storage.sync.get('my_browser_assistant_settings', result => {
      resolve(result.my_browser_assistant_settings?.overlayPosition);
    });
  });
});
assert(`overlayPosition.ratioX = 0.5`, pos && Math.abs(pos.ratioX - 0.5) < 0.01);
assert(`overlayPosition.ratioY = 0.75`, pos && Math.abs(pos.ratioY - 0.75) < 0.01);

// ── 7. Preset lists ──────────────────────────────────────────────
console.log('\n7. Preset Lists');
console.log('───────────────────');

await panelPage.evaluate(() => {
  const el = document.getElementById('rewindAdvanceStepPresets');
  el.value = '3, 8, 15';
  el.dispatchEvent(new Event('change', { bubbles: true }));
});
await new Promise(r => setTimeout(r, 400));

let stepPresets = await panelPage.evaluate(() => {
  return new Promise(resolve => {
    window.chrome.storage.sync.get('my_browser_assistant_settings', result => {
      resolve(result.my_browser_assistant_settings?.rewindAdvanceStepPresets);
    });
  });
});
assert(`Step presets = [3, 8, 15]`, stepPresets?.[0] === 3 && stepPresets?.[1] === 8 && stepPresets?.[2] === 15);

await panelPage.evaluate(() => {
  const el = document.getElementById('volumePresetPercents');
  el.value = '200, 75, 30';
  el.dispatchEvent(new Event('change', { bubbles: true }));
});
await new Promise(r => setTimeout(r, 400));

let volPresets = await panelPage.evaluate(() => {
  return new Promise(resolve => {
    window.chrome.storage.sync.get('my_browser_assistant_settings', result => {
      resolve(result.my_browser_assistant_settings?.volumePresetPercents);
    });
  });
});
// 200 → 2.0 (÷100), 75 → 0.75, 30 → 0.3
assert(`Volume presets = [2.0, 0.75, 0.3]`,
  volPresets && volPresets.length === 3 &&
  Math.abs(volPresets[0] - 2) < 0.01 &&
  Math.abs(volPresets[1] - 0.75) < 0.01 &&
  Math.abs(volPresets[2] - 0.3) < 0.01);

// ── 8. Restore defaults ────────────────────────────────────────────
console.log('\n8. Restore Defaults');
console.log('──────────────────────');

// Verify non-default state first
const preRestore = await panelPage.evaluate(() => {
  return new Promise(resolve => {
    window.chrome.storage.sync.get('my_browser_assistant_settings', result => {
      resolve({ preferSpeed: result.my_browser_assistant_settings?.preferSpeed });
    });
  });
});
assert('preferSpeed was 3 pre-restore', Math.abs(preRestore.preferSpeed - 3) < 0.01);

await panelPage.evaluate(() => {
  document.getElementById('restoreDefaults').click();
});
await new Promise(r => setTimeout(r, 800));

const restoredKey = await panelPage.evaluate(() => {
  const el = document.getElementById('resetKey');
  return { value: el.value, dataset: el.dataset.value };
});
assert(`resetKey restored to "A"/"a"`, restoredKey.value === 'A' && restoredKey.dataset === 'a');

const restoredPrefSpeed = await panelPage.evaluate(() => document.getElementById('preferSpeed')?.value);
assert(`preferSpeed restored to 1.3 (got "${restoredPrefSpeed}")`,
  Math.abs(parseFloat(restoredPrefSpeed) - 1.3) < 0.01);

const restoredShowCheck = await panelPage.evaluate(() => document.getElementById('showCurrentSpeed')?.checked);
assert('showCurrentSpeed restored to checked', restoredShowCheck === true);

const restoredPosX = await panelPage.evaluate(() => document.getElementById('overlayPosX')?.value);
assert(`overlayPosX restored to "1"`, parseInt(restoredPosX) === 1);
const restoredPosY = await panelPage.evaluate(() => document.getElementById('overlayPosY')?.value);
assert(`overlayPosY restored to "5"`, parseInt(restoredPosY) === 5);

const restoredStepList = await panelPage.evaluate(() => document.getElementById('rewindAdvanceStepPresets')?.value);
assert(`Step presets restored to "2, 5, 10"`, restoredStepList.replace(/\s/g, '') === '2,5,10');

const restoredVolList = await panelPage.evaluate(() => document.getElementById('volumePresetPercents')?.value);
assert(`Volume presets restored to "100, 50, 25"`, restoredVolList.replace(/\s/g, '') === '100,50,25');

// Verify storage also matches defaults
const storedAfterRestore = await panelPage.evaluate(() => {
  return new Promise(resolve => {
    window.chrome.storage.sync.get('my_browser_assistant_settings', result => {
      resolve(result.my_browser_assistant_settings);
    });
  });
});
assert('Storage: resetKey = "a"', storedAfterRestore.resetKey === 'a');
assert('Storage: preferSpeed = 1.3', Math.abs(storedAfterRestore.preferSpeed - 1.3) < 0.01);
assert('Storage: showCurrentSpeed = true', storedAfterRestore.showCurrentSpeed === true);
assert('Storage: step presets match default',
  storedAfterRestore.rewindAdvanceStepPresets?.[0] === 2 &&
  storedAfterRestore.rewindAdvanceStepPresets?.[1] === 5 &&
  storedAfterRestore.rewindAdvanceStepPresets?.[2] === 10);

// ── 9. Storage persistence (direct write ↔ panel re-render) ─────
console.log('\n9. Storage Persistence');
console.log('─────────────────────────');

// External storage write → panel re-renders via subscribeToSettings
await panelPage.evaluate(() => {
  return new Promise(resolve => {
    window.chrome.storage.sync.set({
      my_browser_assistant_settings: { overlayFontSize: 28 }
    }, resolve);
  });
});
await new Promise(r => setTimeout(r, 500));

const fontSizeVal = await panelPage.evaluate(() => document.getElementById('overlayFontSize')?.value);
assert(`Panel reacts to storage change: fontSize = ${fontSizeVal}`, parseInt(fontSizeVal) === 28);

// ── Clean up ────────────────────────────────────────────────────
await panelPage.close();
await browser.close();
server.close();

// ── Summary ─────────────────────────────────────────────────────
const total = passed + failed;
console.log(`\n═══════════════════════════════════════`);
console.log(`  ${passed}/${total} passed, ${failed} failed`);
console.log(`  Side panel — local HTTP server with chrome.storage polyfill`);
console.log(`═══════════════════════════════════════`);

process.exit(failed > 0 ? 1 : 0);