import { MAX_VOLUME_MULTIPLIER, SETTINGS_STORAGE_KEY } from './constants.js';
import { isApproximately } from './utils.js';

export const DEFAULT_SETTINGS = {
  resetKey: 'a',
  decreaseKey: 's',
  increaseKey: 'd',
  rewindKey: 'z',
  advanceKey: 'x',
  switchRewindAdvanceKey: 'e',
  cycleVolumePresetKey: 'q',
  toggleOverlayKey: 'v',
  speedAdjustmentStep: 0.1,
  rewindAdvanceStepPresets: [2, 5, 10],
  rewindAdvanceStep: 10,
  preferSpeed: 1.3,
  fastForwardSpeed: 2,
  slowMotionSpeed: 0.4,
  volumePresetPercents: [1, 0.5, 0.25],
  overlayFontSize: 18,
  overlayBackgroundAlpha: 0.5,
  overlayPosition: { x: 0, y: 0, ratioX: 0.01, ratioY: 0.05 },
  showCurrentSpeed: true
};

function normalizeSettings(settings) {
  const normalized = { ...DEFAULT_SETTINGS, ...settings };
  const keyFields = [
    'resetKey',
    'decreaseKey',
    'increaseKey',
    'rewindKey',
    'advanceKey',
    'switchRewindAdvanceKey',
    'cycleVolumePresetKey',
    'toggleOverlayKey'
  ];

  keyFields.forEach((field) => {
    const value = normalized[field];
    if (typeof value === 'string' && value.length > 0) {
      normalized[field] = value.toLowerCase();
    } else {
      normalized[field] = DEFAULT_SETTINGS[field];
    }
  });

  normalized.speedAdjustmentStep = sanitizeNumber(
    normalized.speedAdjustmentStep,
    DEFAULT_SETTINGS.speedAdjustmentStep,
    0.1,
    16
  );
  normalized.rewindAdvanceStepPresets = sanitizeStepList(
    normalized.rewindAdvanceStepPresets,
    DEFAULT_SETTINGS.rewindAdvanceStepPresets
  );
  normalized.rewindAdvanceStep = sanitizeNumber(
    normalized.rewindAdvanceStep,
    DEFAULT_SETTINGS.rewindAdvanceStep,
    0.1,
    600
  );
  if (
    !normalized.rewindAdvanceStepPresets.some((step) =>
      isApproximately(step, normalized.rewindAdvanceStep, 0.0001)
    )
  ) {
    normalized.rewindAdvanceStep = normalized.rewindAdvanceStepPresets[0];
  }
  normalized.preferSpeed = sanitizeNumber(normalized.preferSpeed, DEFAULT_SETTINGS.preferSpeed, 0.1, 16);
  normalized.fastForwardSpeed = sanitizeNumber(
    normalized.fastForwardSpeed,
    DEFAULT_SETTINGS.fastForwardSpeed,
    1,
    16
  );
  normalized.slowMotionSpeed = sanitizeNumber(
    normalized.slowMotionSpeed,
    DEFAULT_SETTINGS.slowMotionSpeed,
    0.1,
    1
  );
  normalized.volumePresetPercents = normalizeVolumePresetPercents(
    normalized.volumePresetPercents,
    DEFAULT_SETTINGS.volumePresetPercents
  );
  normalized.overlayFontSize = sanitizeNumber(normalized.overlayFontSize, DEFAULT_SETTINGS.overlayFontSize, 8, 72);
  normalized.overlayBackgroundAlpha = sanitizeNumber(
    normalized.overlayBackgroundAlpha,
    DEFAULT_SETTINGS.overlayBackgroundAlpha,
    0.1,
    1
  );
  normalized.overlayPosition = normalizeOverlayPosition(
    normalized.overlayPosition,
    DEFAULT_SETTINGS.overlayPosition
  );
  normalized.showCurrentSpeed = Boolean(normalized.showCurrentSpeed);
  return normalized;
}

function sanitizeNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (Number.isFinite(parsed)) {
    return Math.min(Math.max(parsed, min), max);
  }
  return fallback;
}

function normalizeOverlayPosition(value, fallback) {
  const fallbackPosition = fallback || { x: 12, y: 12, ratioX: null, ratioY: null };
  const source = typeof value === 'object' && value !== null ? value : {};
  return {
    x: sanitizeNumber(source.x, fallbackPosition.x, 0, 10000),
    y: sanitizeNumber(source.y, fallbackPosition.y, 0, 10000),
    ratioX: sanitizeRatio(source.ratioX, fallbackPosition.ratioX),
    ratioY: sanitizeRatio(source.ratioY, fallbackPosition.ratioY)
  };
}

function sanitizeRatio(value, fallback) {
  if (Number.isFinite(value)) {
    return Math.min(Math.max(value, 0), 1);
  }
  return fallback ?? null;
}

function sanitizeStepList(value, fallback) {
  let source = [];
  if (Array.isArray(value)) {
    source = value;
  } else if (typeof value === 'string') {
    source = value.split(/[\s,]+/);
  }
  const parsed = source
    .map((item) => Number(item))
    .filter((num) => Number.isFinite(num) && num >= 0.1 && num <= 600);
  if (parsed.length) {
    return parsed;
  }
  if (Array.isArray(fallback) && fallback.length) {
    return [...fallback];
  }
  return DEFAULT_SETTINGS.rewindAdvanceStepPresets.slice();
}

export async function getSettings() {
  if (!hasChromeStorage()) {
    return normalizeSettings({});
  }
  const stored = await safeStorageGet(SETTINGS_STORAGE_KEY);
  return normalizeSettings(stored[SETTINGS_STORAGE_KEY] || {});
}

export async function saveSettings(partial) {
  if (!hasChromeStorage()) {
    return normalizeSettings(partial || {});
  }
  const current = await getSettings();
  const next = normalizeSettings({ ...current, ...partial });
  await safeStorageSet({ [SETTINGS_STORAGE_KEY]: next });
  return next;
}

export function subscribeToSettings(callback) {
  if (!hasChromeStorage() || typeof chrome?.storage?.onChanged?.addListener !== 'function') {
    return () => {};
  }
  const listener = (changes, areaName) => {
    if (areaName !== 'sync' || !changes[SETTINGS_STORAGE_KEY]) {
      return;
    }
    callback(normalizeSettings(changes[SETTINGS_STORAGE_KEY].newValue || {}));
  };

  try {
    chrome.storage.onChanged.addListener(listener);
  } catch (error) {
    if (isExtensionContextInvalid(error)) {
      return () => {};
    }
    throw error;
  }
  return () => {
    try {
      chrome?.storage?.onChanged?.removeListener?.(listener);
    } catch (_) {
      // ignore teardown errors in restricted contexts
    }
  };
}

async function safeStorageGet(key) {
  if (!hasChromeStorage()) {
    return {};
  }
  try {
    return await chrome.storage.sync.get(key);
  } catch (error) {
    if (isExtensionContextInvalid(error)) {
      return {};
    }
    throw error;
  }
}

async function safeStorageSet(payload) {
  if (!hasChromeStorage()) {
    return;
  }
  try {
    await chrome.storage.sync.set(payload);
  } catch (error) {
    if (isExtensionContextInvalid(error)) {
      return;
    }
    throw error;
  }
}

function isExtensionContextInvalid(error) {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const message = String(error.message || '');
  return message.includes('Extension context invalidated');
}

function normalizeVolumePresetPercents(list, fallback) {
  let source = [];
  if (Array.isArray(list)) {
    source = list;
  } else if (typeof list === 'string') {
    source = list.split(/[\s,]+/);
  }
  if (!source.length) {
    source = Array.isArray(fallback) && fallback.length ? fallback : DEFAULT_SETTINGS.volumePresetPercents;
  }
  const normalized = source
    .map((item) => Number(item))
    .map((value) => {
      if (!Number.isFinite(value)) {
        return null;
      }
      if (value > MAX_VOLUME_MULTIPLIER + 0.0001) {
        return value / 100;
      }
      return value;
    })
    .filter((value) => Number.isFinite(value))
    .map((value) => Math.min(Math.max(value, 0.05), MAX_VOLUME_MULTIPLIER))
    .filter((value, index, arr) => index === arr.findIndex((candidate) => Math.abs(candidate - value) < 0.0001));

  return normalized.length ? normalized : [1];
}

function hasChromeStorage() {
  return (
    typeof chrome !== 'undefined' &&
    chrome?.storage?.sync &&
    typeof chrome.storage.onChanged?.addListener === 'function'
  );
}
