export const SETTINGS_STORAGE_KEY = 'my_browser_assistant_settings';

export const DEFAULT_SETTINGS = {
  resetKey: 'a',
  decreaseKey: 's',
  increaseKey: 'd',
  rewindKey: 'z',
  advanceKey: 'x',
  switchRewindAdvanceKey: 'e',
  toggleOverlayKey: 'v',
  speedAdjustmentStep: 0.1,
  rewindAdvanceStepPresets: [2, 5, 10],
  rewindAdvanceStep: 10,
  preferSpeed: 1.3,
  fastForwardSpeed: 2,
  slowMotionSpeed: 0.4,
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

function isApproximately(value, target, threshold = 0.01) {
  if (!Number.isFinite(value) || !Number.isFinite(target)) {
    return false;
  }
  return Math.abs(value - target) <= threshold;
}

export async function getSettings() {
  const stored = await chrome.storage.sync.get(SETTINGS_STORAGE_KEY);
  return normalizeSettings(stored[SETTINGS_STORAGE_KEY] || {});
}

export async function saveSettings(partial) {
  const current = await getSettings();
  const next = normalizeSettings({ ...current, ...partial });
  await chrome.storage.sync.set({ [SETTINGS_STORAGE_KEY]: next });
  return next;
}

export function subscribeToSettings(callback) {
  const listener = (changes, areaName) => {
    if (areaName !== 'sync' || !changes[SETTINGS_STORAGE_KEY]) {
      return;
    }
    callback(normalizeSettings(changes[SETTINGS_STORAGE_KEY].newValue || {}));
  };

  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
