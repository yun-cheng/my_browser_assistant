import puppeteer from 'puppeteer';

const EXT_PATH = '/Users/zeke/Projects/my_ai_assistant';

const HEADLESS = process.env.HEADLESS === 'true';
const args = [
  `--disable-extensions-except=${EXT_PATH}`,
  `--load-extension=${EXT_PATH}`,
  '--no-first-run',
  `--user-data-dir=/tmp/puppeteer_sp_${Date.now()}`
];
if (process.env.CI) args.push('--no-sandbox', '--disable-setuid-sandbox');

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

const browser = await puppeteer.launch({
  headless: HEADLESS,
  args
});

console.log('=== My Browser Assistant — Side Panel Integration Test ===\n');

// ── 0. Discover extension ID ──────────────────────────────────────────

// Navigate to a page to trigger the extension (MV3 service workers are lazy)
const triggerPage = await browser.newPage();
await triggerPage.goto('about:blank', { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 2000));
await triggerPage.close();

// Retry: service worker may take time to register on fresh startup
let bgTarget = null;
for (let i = 0; i < 10; i++) {
  bgTarget = browser.targets().find(t => t.type() === 'service_worker');
  if (bgTarget) break;
  console.log(`  ⏳ Waiting for service worker (attempt ${i + 1})...`);
  await new Promise(r => setTimeout(r, 1000));
}
const extId = bgTarget ? new URL(bgTarget.url()).hostname : null;
console.log(`0. Discovery`);
console.log(`──────────────`);
assert('Extension ID found', !!extId && extId.length > 0);
console.log(`  Extension ID: ${extId}\n`);

// ── 1. Open side panel page ──────────────────────────────────────────

const panelPage = await browser.newPage();
await panelPage.setViewport({ width: 400, height: 900 });
await panelPage.goto(`chrome-extension://${extId}/sidepanel/sidepanel.html`, {
  waitUntil: 'networkidle0', timeout: 15000
});
await new Promise(r => setTimeout(r, 1500)); // let JS init & render

console.log('1. Side Panel Renders');
console.log('─────────────────────────');

assert('Form element exists',
  await panelPage.evaluate(() => !!document.getElementById('settingsForm')));
assert('Restore defaults button exists',
  await panelPage.evaluate(() => !!document.getElementById('restoreDefaults')));

// Verify all key-inputs exist
const keyInputIds = [
  'resetKey', 'decreaseKey', 'increaseKey',
  'rewindKey', 'advanceKey', 'switchRewindAdvanceKey',
  'cycleVolumePresetKey', 'toggleOverlayKey'
];
for (const id of keyInputIds) {
  assert(`Key input #${id} rendered`,
    await panelPage.evaluate((id) => {
      const el = document.getElementById(id);
      return el && el.classList.contains('key-input');
    }, id));
}

// Verify value inputs exist
const valueInputIds = [
  'preferSpeed', 'speedAdjustmentStep', 'rewindAdvanceStep',
  'slowMotionSpeed', 'fastForwardSpeed',
  'overlayFontSize', 'overlayBackgroundAlpha'
];
for (const id of valueInputIds) {
  assert(`Value input #${id} rendered`,
    await panelPage.evaluate((id) => {
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

// ── 2. Default values match DEFAULT_SETTINGS ──────────────────────────

console.log('\n2. Default Values');
console.log('───────────────────');

// Defaults from DEFAULT_SETTINGS in settings.js
const DEFAULTS = {
  resetKey: 'a', decreaseKey: 's', increaseKey: 'd',
  rewindKey: 'z', advanceKey: 'x', switchRewindAdvanceKey: 'e',
  cycleVolumePresetKey: 'q', toggleOverlayKey: 'v',
  speedAdjustmentStep: 0.1, rewindAdvanceStep: 10,
  preferSpeed: 1.3, fastForwardSpeed: 2, slowMotionSpeed: 0.4,
  overlayFontSize: 18, overlayBackgroundAlpha: 0.5,
  showCurrentSpeed: true,
  overlayPosition: { ratioX: 0.01, ratioY: 0.05 }
};

// Key-inputs display uppercase labels
const keyExpect = {
  resetKey: 'A', decreaseKey: 'S', increaseKey: 'D',
  rewindKey: 'Z', advanceKey: 'X', switchRewindAdvanceKey: 'E',
  cycleVolumePresetKey: 'Q', toggleOverlayKey: 'V'
};

for (const [id, expected] of Object.entries(keyExpect)) {
  const actual = await panelPage.evaluate((id) => {
    const el = document.getElementById(id);
    return el ? el.value : null;
  }, id);
  assert(`#${id} = "${expected}"`, actual === expected);
}

const valueExpect = {
  preferSpeed: '1.3', speedAdjustmentStep: '0.1',
  rewindAdvanceStep: '10', slowMotionSpeed: '0.4',
  fastForwardSpeed: '2', overlayFontSize: '18',
  overlayBackgroundAlpha: '0.5'
};
for (const [id, expected] of Object.entries(valueExpect)) {
  const actual = await panelPage.evaluate((id) => {
    const el = document.getElementById(id);
    return el ? el.value : null;
  }, id);
  assert(`#${id} = ${expected}`, actual === expected || Math.abs(parseFloat(actual) - parseFloat(expected)) < 0.01);
}

// Overlay position: ratioX=0.01 → 1%, ratioY=0.05 → 5%
const posX = await panelPage.evaluate(() => document.getElementById('overlayPosX')?.value);
const posY = await panelPage.evaluate(() => document.getElementById('overlayPosY')?.value);
assert(`overlayPosX = 1 (%${DEFAULTS.overlayPosition.ratioX * 100})`,
  parseInt(posX) === Math.round(DEFAULTS.overlayPosition.ratioX * 100));
assert(`overlayPosY = 5 (%${DEFAULTS.overlayPosition.ratioY * 100})`,
  parseInt(posY) === Math.round(DEFAULTS.overlayPosition.ratioY * 100));

// Checkbox default = checked
const showChecked = await panelPage.evaluate(() => document.getElementById('showCurrentSpeed')?.checked);
assert('showCurrentSpeed checked by default', showChecked === true);

// Comma-separated defaults
const stepPresetsVal = await panelPage.evaluate(() => document.getElementById('rewindAdvanceStepPresets')?.value);
assert(`Step presets = "2, 5, 10" (got "${stepPresetsVal}")`,
  stepPresetsVal.replace(/\s/g, '') === '2,5,10');
const volPresetsVal = await panelPage.evaluate(() => document.getElementById('volumePresetPercents')?.value);
assert(`Volume presets = "100, 50, 25" (got "${volPresetsVal}")`,
  volPresetsVal.replace(/\s/g, '') === '100,50,25');

// ── 3. Key capture ──────────────────────────────────────────────────

console.log('\n3. Key Capture');
console.log('─────────────────');

// Focus the resetKey input, press 'f', verify displayed value updates
await panelPage.evaluate(() => {
  const el = document.getElementById('resetKey');
  el.focus();
  el.select();
});
await new Promise(r => setTimeout(r, 100));
await panelPage.keyboard.press('f');
await new Promise(r => setTimeout(r, 300));

let keyVal = await panelPage.evaluate(() => {
  const el = document.getElementById('resetKey');
  return { value: el.value, dataset: el.dataset.value };
});
assert(`Reset key changed to "F" (display="${keyVal.value}", data="${keyVal.dataset}")`,
  keyVal.value === 'F' && keyVal.dataset === 'f');

// Focus increaseKey, press 'r'
await panelPage.evaluate(() => {
  const el = document.getElementById('increaseKey');
  el.focus();
});
await new Promise(r => setTimeout(r, 100));
await panelPage.keyboard.press('r');
await new Promise(r => setTimeout(r, 300));

keyVal = await panelPage.evaluate(() => {
  const el = document.getElementById('increaseKey');
  return { value: el.value, dataset: el.dataset.value };
});
assert(`Increase key changed to "R" (display="${keyVal.value}", data="${keyVal.dataset}")`,
  keyVal.value === 'R' && keyVal.dataset === 'r');

// Tab should NOT be captured
await panelPage.evaluate(() => {
  document.getElementById('resetKey').focus();
});
await new Promise(r => setTimeout(r, 100));
await panelPage.keyboard.press('Tab');
await new Promise(r => setTimeout(r, 300));

// After Tab, focus should have moved away from resetKey
const resetKeyAfterTab = await panelPage.evaluate(() => {
  const el = document.getElementById('resetKey');
  return el === document.activeElement;
});
assert('Tab key not captured (focus moved)', resetKeyAfterTab === false);

// ── 4. Numeric inputs ──────────────────────────────────────────────

console.log('\n4. Numeric Inputs');
console.log('────────────────────');

// Change preferSpeed from 1.3 → 3.0
await panelPage.evaluate(() => {
  const el = document.getElementById('preferSpeed');
  el.value = '';
  el.value = '3.0';
  el.dispatchEvent(new Event('change', { bubbles: true }));
});
await new Promise(r => setTimeout(r, 400));

let stored = await panelPage.evaluate(() => {
  return new Promise(resolve => {
    chrome.storage.sync.get('my_browser_assistant_settings', result => {
      resolve(result.my_browser_assistant_settings?.preferSpeed);
    });
  });
});
assert(`preferSpeed persisted as 3 (stored=${stored})`, Math.abs(stored - 3) < 0.01);

// Change speedAdjustmentStep from 0.1 → 0.5
await panelPage.evaluate(() => {
  const el = document.getElementById('speedAdjustmentStep');
  el.value = '';
  el.value = '0.5';
  el.dispatchEvent(new Event('change', { bubbles: true }));
});
await new Promise(r => setTimeout(r, 400));

stored = await panelPage.evaluate(() => {
  return new Promise(resolve => {
    chrome.storage.sync.get('my_browser_assistant_settings', result => {
      resolve(result.my_browser_assistant_settings?.speedAdjustmentStep);
    });
  });
});
assert(`speedAdjustmentStep persisted as 0.5 (stored=${stored})`, Math.abs(stored - 0.5) < 0.01);

// ── 5. Checkbox toggle ─────────────────────────────────────────────

console.log('\n5. Checkbox Toggle');
console.log('─────────────────────');

// Uncheck show overlay
await panelPage.evaluate(() => {
  const cb = document.getElementById('showCurrentSpeed');
  cb.checked = false;
  cb.dispatchEvent(new Event('change', { bubbles: true }));
});
await new Promise(r => setTimeout(r, 400));

stored = await panelPage.evaluate(() => {
  return new Promise(resolve => {
    chrome.storage.sync.get('my_browser_assistant_settings', result => {
      resolve(result.my_browser_assistant_settings?.showCurrentSpeed);
    });
  });
});
assert('showCurrentSpeed = false after toggle', stored === false);

// Re-check
await panelPage.evaluate(() => {
  const cb = document.getElementById('showCurrentSpeed');
  cb.checked = true;
  cb.dispatchEvent(new Event('change', { bubbles: true }));
});
await new Promise(r => setTimeout(r, 400));

stored = await panelPage.evaluate(() => {
  return new Promise(resolve => {
    chrome.storage.sync.get('my_browser_assistant_settings', result => {
      resolve(result.my_browser_assistant_settings?.showCurrentSpeed);
    });
  });
});
assert('showCurrentSpeed = true after re-toggle', stored === true);

// ── 6. Position percentage inputs ──────────────────────────────────

console.log('\n6. Position Inputs');
console.log('─────────────────────');

// Change X to 50%, Y to 75%
await panelPage.evaluate(() => {
  const x = document.getElementById('overlayPosX');
  x.value = '50';
  x.dispatchEvent(new Event('input', { bubbles: true }));
  const y = document.getElementById('overlayPosY');
  y.value = '75';
  y.dispatchEvent(new Event('input', { bubbles: true }));
});
await new Promise(r => setTimeout(r, 400));

const pos = await panelPage.evaluate(() => {
  return new Promise(resolve => {
    chrome.storage.sync.get('my_browser_assistant_settings', result => {
      resolve(result.my_browser_assistant_settings?.overlayPosition);
    });
  });
});
assert(`overlayPosition.ratioX = 0.5 (stored=${pos?.ratioX})`,
  pos && Math.abs(pos.ratioX - 0.5) < 0.01);
assert(`overlayPosition.ratioY = 0.75 (stored=${pos?.ratioY})`,
  pos && Math.abs(pos.ratioY - 0.75) < 0.01);

// ── 7. Comma-separated preset lists ────────────────────────────────

console.log('\n7. Preset Lists');
console.log('───────────────────');

// Change step presets to "3, 8, 15"
await panelPage.evaluate(() => {
  const el = document.getElementById('rewindAdvanceStepPresets');
  el.value = '3, 8, 15';
  el.dispatchEvent(new Event('change', { bubbles: true }));
});
await new Promise(r => setTimeout(r, 400));

const stepPresets = await panelPage.evaluate(() => {
  return new Promise(resolve => {
    chrome.storage.sync.get('my_browser_assistant_settings', result => {
      resolve(result.my_browser_assistant_settings?.rewindAdvanceStepPresets);
    });
  });
});
assert(`Step presets = [3, 8, 15] (stored=${JSON.stringify(stepPresets)})`,
  Array.isArray(stepPresets) &&
  stepPresets.length === 3 &&
  stepPresets[0] === 3 && stepPresets[1] === 8 && stepPresets[2] === 15);

// Change volume presets to "150, 75, 30" (% values that get normalized)
await panelPage.evaluate(() => {
  const el = document.getElementById('volumePresetPercents');
  el.value = '150, 75, 30';
  el.dispatchEvent(new Event('change', { bubbles: true }));
});
await new Promise(r => setTimeout(r, 400));

const volPresets = await panelPage.evaluate(() => {
  return new Promise(resolve => {
    chrome.storage.sync.get('my_browser_assistant_settings', result => {
      resolve(result.my_browser_assistant_settings?.volumePresetPercents);
    });
  });
});
// Values > 4 (MAX_VOLUME_MULTIPLIER) get divided by 100
// 150/100 = 1.5, 75/100 = 0.75, 30/100 = 0.3
assert(`Volume presets normalized = [1.5, 0.75, 0.3] (stored=${JSON.stringify(volPresets)})`,
  Array.isArray(volPresets) &&
  volPresets.length === 3 &&
  Math.abs(volPresets[0] - 1.5) < 0.01 &&
  Math.abs(volPresets[1] - 0.75) < 0.01 &&
  Math.abs(volPresets[2] - 0.3) < 0.01);

// ── 8. Restore defaults ────────────────────────────────────────────

console.log('\n8. Restore Defaults');
console.log('──────────────────────');

// First verify current state is non-default (we changed things)
const preRestore = await panelPage.evaluate(() => {
  return new Promise(resolve => {
    chrome.storage.sync.get('my_browser_assistant_settings', result => {
      const s = result.my_browser_assistant_settings || {};
      resolve({
        preferSpeed: s.preferSpeed,
        speedAdjustmentStep: s.speedAdjustmentStep,
        showCurrentSpeed: s.showCurrentSpeed,
        overlayPosition: s.overlayPosition,
        rewindAdvanceStepPresets: s.rewindAdvanceStepPresets,
        volumePresetPercents: s.volumePresetPercents,
        increaseKey: s.increaseKey,
        resetKey: s.resetKey
      });
    });
  });
});
assert('preferredSpeed was changed (pre-restore)',
  Math.abs(preRestore.preferSpeed - 3) < 0.01);
assert('resetKey was changed to "f" (pre-restore)',
  preRestore.resetKey === 'f');

// Click restore defaults
await panelPage.evaluate(() => {
  document.getElementById('restoreDefaults').click();
});
await new Promise(r => setTimeout(r, 800));

// Check form fields re-rendered with defaults
const restoredKey = await panelPage.evaluate(() => {
  const el = document.getElementById('resetKey');
  return { value: el.value, dataset: el.dataset.value };
});
assert(`resetKey restored to "A"/"a" (got "${restoredKey.value}"/"${restoredKey.dataset}")`,
  restoredKey.value === 'A' && restoredKey.dataset === 'a');

// Check increaseKey restored to "D"/"d" (we changed it to 'r' earlier)
const incRestored = await panelPage.evaluate(() => {
  const el = document.getElementById('increaseKey');
  return { value: el.value, dataset: el.dataset.value };
});
assert(`increaseKey restored to "D"/"d" (got "${incRestored.value}"/"${incRestored.dataset}")`,
  incRestored.value === 'D' && incRestored.dataset === 'd');

const restoredPrefSpeed = await panelPage.evaluate(() => document.getElementById('preferSpeed')?.value);
assert(`preferSpeed restored to "1.3" (got "${restoredPrefSpeed}")`,
  Math.abs(parseFloat(restoredPrefSpeed) - 1.3) < 0.01);

const restoredStep = await panelPage.evaluate(() => document.getElementById('speedAdjustmentStep')?.value);
assert(`speedAdjustmentStep restored to "0.1" (got "${restoredStep}")`,
  Math.abs(parseFloat(restoredStep) - 0.1) < 0.01);

const restoredShowCheck = await panelPage.evaluate(() => document.getElementById('showCurrentSpeed')?.checked);
assert('showCurrentSpeed restored to checked', restoredShowCheck === true);

const restoredPosX = await panelPage.evaluate(() => document.getElementById('overlayPosX')?.value);
assert(`overlayPosX restored to "1" (got "${restoredPosX}")`, parseInt(restoredPosX) === 1);
const restoredPosY = await panelPage.evaluate(() => document.getElementById('overlayPosY')?.value);
assert(`overlayPosY restored to "5" (got "${restoredPosY}")`, parseInt(restoredPosY) === 5);

const restoredStepList = await panelPage.evaluate(() => document.getElementById('rewindAdvanceStepPresets')?.value);
assert(`Step presets restored to "2, 5, 10" (got "${restoredStepList}")`,
  restoredStepList.replace(/\s/g, '') === '2,5,10');

const restoredVolList = await panelPage.evaluate(() => document.getElementById('volumePresetPercents')?.value);
assert(`Volume presets restored to "100, 50, 25" (got "${restoredVolList}")`,
  restoredVolList.replace(/\s/g, '') === '100,50,25');

// Verify storage also has defaults
const storedAfterRestore = await panelPage.evaluate(() => {
  return new Promise(resolve => {
    chrome.storage.sync.get('my_browser_assistant_settings', result => {
      const s = result.my_browser_assistant_settings || {};
      resolve({
        resetKey: s.resetKey,
        increaseKey: s.increaseKey,
        preferSpeed: s.preferSpeed,
        showCurrentSpeed: s.showCurrentSpeed,
        rewindAdvanceStepPresets: s.rewindAdvanceStepPresets,
        volumePresetPercents: s.volumePresetPercents
      });
    });
  });
});
assert('Storage: resetKey = "a"', storedAfterRestore.resetKey === 'a');
assert('Storage: increaseKey = "d"', storedAfterRestore.increaseKey === 'd');
assert('Storage: preferSpeed = 1.3', Math.abs(storedAfterRestore.preferSpeed - 1.3) < 0.01);
assert('Storage: showCurrentSpeed = true', storedAfterRestore.showCurrentSpeed === true);
assert('Storage: step presets match default',
  Array.isArray(storedAfterRestore.rewindAdvanceStepPresets) &&
  storedAfterRestore.rewindAdvanceStepPresets[0] === 2 &&
  storedAfterRestore.rewindAdvanceStepPresets[1] === 5 &&
  storedAfterRestore.rewindAdvanceStepPresets[2] === 10);
assert('Storage: volume presets match default',
  Array.isArray(storedAfterRestore.volumePresetPercents) &&
  Math.abs(storedAfterRestore.volumePresetPercents[0] - 1) < 0.01 &&
  Math.abs(storedAfterRestore.volumePresetPercents[1] - 0.5) < 0.01 &&
  Math.abs(storedAfterRestore.volumePresetPercents[2] - 0.25) < 0.01);

// ── 9. Storage Persistence (direct access check) ──────────────────

console.log('\n9. Storage Persistence');
console.log('─────────────────────────');

// Write a custom setting, read it back directly from chrome.storage.sync
await panelPage.evaluate(() => {
  return new Promise(resolve => {
    chrome.storage.sync.set({
      my_browser_assistant_settings: { preferSpeed: 2.5 }
    }, resolve);
  });
});
await new Promise(r => setTimeout(r, 300));

// Read back via chrome.storage.sync.get
const directRead = await panelPage.evaluate(() => {
  return new Promise(resolve => {
    chrome.storage.sync.get('my_browser_assistant_settings', result => {
      resolve(result.my_browser_assistant_settings?.preferSpeed);
    });
  });
});
assert(`Direct storage read: preferSpeed = 2.5 (got=${directRead})`,
  Math.abs(directRead - 2.5) < 0.01);

// Verify panel re-rendered from storage
const pv = await panelPage.evaluate(() => document.getElementById('preferSpeed')?.value);
assert(`Panel re-rendered with preferSpeed = "2.5" (got="${pv}")`,
  parseFloat(pv) === 2.5);

// Change a setting in storage externally, verify panel picks it up
await panelPage.evaluate(() => {
  return new Promise(resolve => {
    chrome.storage.sync.set({
      my_browser_assistant_settings: { overlayFontSize: 24 }
    }, resolve);
  });
});
await new Promise(r => setTimeout(r, 600));

const fontSizeVal = await panelPage.evaluate(() => document.getElementById('overlayFontSize')?.value);
assert(`Panel reacted to external storage change: fontSize = "24" (got="${fontSizeVal}")`,
  parseInt(fontSizeVal) === 24);

// Restore defaults again to prep for sync test
await panelPage.evaluate(() => {
  document.getElementById('restoreDefaults').click();
});
await new Promise(r => setTimeout(r, 800));

// ── 10. Sync: side panel → content script in real-time ──────────────

console.log('\n10. Real-time Sync: Side Panel → Content Script');
console.log('──────────────────────────────────────────────────────');

// Open video page
const videoPage = await browser.newPage();
await videoPage.setViewport({ width: 1280, height: 800 });
await videoPage.goto('https://www.w3schools.com/html/html5_video.asp', {
  waitUntil: 'networkidle2', timeout: 30000
});
await new Promise(r => setTimeout(r, 2500));

// Setup video
await videoPage.evaluate(() => {
  const v = document.querySelector('video');
  if (v) { v.muted = true; v.playbackRate = 1; v.play().catch(() => {}); }
});
await new Promise(r => setTimeout(r, 1500));

const videoReady = await videoPage.evaluate(() => {
  const v = document.querySelector('video');
  return v && !v.paused && v.readyState >= 2;
});
assert('Video page loaded and playing', videoReady);

// Test 10a: Default key bindings work (increaseKey = 'd')
await videoPage.evaluate(() => {
  const v = document.querySelector('video');
  if (v) v.playbackRate = 1;
});
await new Promise(r => setTimeout(r, 200));

await videoPage.keyboard.press('d');
await new Promise(r => setTimeout(r, 400));

let rate = await videoPage.evaluate(() =>
  Math.round(document.querySelector('video')?.playbackRate * 100) / 100 || 0);
console.log(`  Default 'd' pressed: rate = ${rate}x`);
assert('Default "d" increases speed', rate > 1.05);

// Test 10b: Change increaseKey in side panel → verify content script picks it up

// Bring panel to front, change increaseKey from 'd' to 'f'
await panelPage.bringToFront();
await new Promise(r => setTimeout(r, 200));

await panelPage.evaluate(() => {
  const el = document.getElementById('increaseKey');
  el.focus();
});
await new Promise(r => setTimeout(r, 100));
await panelPage.keyboard.press('f');
await new Promise(r => setTimeout(r, 500));

// Verify storage updated
const storedIncKey = await panelPage.evaluate(() => {
  return new Promise(resolve => {
    chrome.storage.sync.get('my_browser_assistant_settings', result => {
      resolve(result.my_browser_assistant_settings?.increaseKey);
    });
  });
});
console.log(`  Panel changed increaseKey → "${storedIncKey}"`);
assert('Side panel: increaseKey stored as "f"', storedIncKey === 'f');

// Bring video page back to front
await videoPage.bringToFront();
await new Promise(r => setTimeout(r, 800)); // Allow storage callback to fire

// Test 10c: New key 'f' should now increase speed
await videoPage.evaluate(() => {
  const v = document.querySelector('video');
  if (v) v.playbackRate = 1;
});
await new Promise(r => setTimeout(r, 300));

await videoPage.keyboard.press('f');
await new Promise(r => setTimeout(r, 400));

rate = await videoPage.evaluate(() =>
  Math.round(document.querySelector('video')?.playbackRate * 100) / 100 || 0);
console.log(`  New 'f' pressed: rate = ${rate}x`);
assert('New key "f" increases speed (sync propagated)', rate > 1.05);

// Test 10d: Old key 'd' should no longer work
await videoPage.evaluate(() => {
  const v = document.querySelector('video');
  if (v) v.playbackRate = 1;
});
await new Promise(r => setTimeout(r, 300));

await videoPage.keyboard.press('d');
await new Promise(r => setTimeout(r, 400));

rate = await videoPage.evaluate(() =>
  Math.round(document.querySelector('video')?.playbackRate * 100) / 100 || 0);
console.log(`  Old 'd' pressed after remap: rate = ${rate}x`);
assert('Old key "d" no longer affects speed', Math.abs(rate - 1) < 0.05);

// ── CLEANUP ────────────────────────────────────────────────────────
await new Promise(r => setTimeout(r, 300));
await panelPage.close();
await videoPage.close();

// ── SUMMARY ────────────────────────────────────────────────────────
const total = passed + failed;
console.log(`\n═══════════════════════════════════════`);
console.log(`  ${passed}/${total} passed, ${failed} failed`);
console.log(`  Side panel — form, key capture, numeric, toggle,`);
console.log(`  position, presets, restore, storage, cross-page sync`);
console.log(`═══════════════════════════════════════`);

await browser.close();
process.exit(failed > 0 ? 1 : 0);