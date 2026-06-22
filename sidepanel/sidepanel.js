import {
  DEFAULT_SETTINGS,
  getSettings,
  saveSettings,
  subscribeToSettings
} from '../src/lib/settings.js';

const form = document.getElementById('settingsForm');
const restoreDefaultsButton = document.getElementById('restoreDefaults');
const showCurrentSpeedInput = document.getElementById('showCurrentSpeed');
const keyInputs = Array.from(document.querySelectorAll('.key-input'));
const keyInputMap = new Map(keyInputs.map((input) => [input.dataset.setting, input]));
const valueInputs = Array.from(document.querySelectorAll('[data-value-setting]'));
const valueInputMap = new Map(valueInputs.map((input) => [input.dataset.valueSetting, input]));
const overlayPosXInput = document.getElementById('overlayPosX');
const overlayPosYInput = document.getElementById('overlayPosY');
const rewindAdvanceStepsInput = document.getElementById('rewindAdvanceSteps');

let currentSettings = { ...DEFAULT_SETTINGS };
let unsubscribe = null;

init();

async function init() {
  currentSettings = await getSettings();
  render(currentSettings);
  wireEvents();
  unsubscribe = subscribeToSettings((next) => {
    currentSettings = next;
    render(next);
  });

  window.addEventListener('unload', () => {
    if (unsubscribe) {
      unsubscribe();
    }
  });
}

function wireEvents() {
  form.addEventListener('submit', (event) => event.preventDefault());

  keyInputs.forEach((input) => {
    input.addEventListener('keydown', (event) => handleKeyCapture(event, input));
    input.addEventListener('focus', () => input.select());
  });

  valueInputs.forEach((input) => {
    input.addEventListener('change', persistSettingsFromForm);
  });

  [overlayPosXInput, overlayPosYInput].forEach((input) => {
    input.addEventListener('input', persistSettingsFromForm);
  });

  if (rewindAdvanceStepsInput) {
    rewindAdvanceStepsInput.addEventListener('change', persistSettingsFromForm);
  }
  showCurrentSpeedInput.addEventListener('change', persistSettingsFromForm);

  restoreDefaultsButton.addEventListener('click', async () => {
    await saveSettings({ ...DEFAULT_SETTINGS });
  });
}

function render(settings) {
  keyInputs.forEach((input) => {
    const settingName = input.dataset.setting;
    setKeyInputValue(input, settings[settingName] ?? DEFAULT_SETTINGS[settingName]);
  });

  valueInputMap.forEach((input, settingName) => {
    const fallback = DEFAULT_SETTINGS[settingName];
    input.value = settings[settingName] ?? fallback;
  });
  const position = settings.overlayPosition || DEFAULT_SETTINGS.overlayPosition || { x: 12, y: 12 };
  overlayPosXInput.value = formatPositionValue(position.ratioX);
  overlayPosYInput.value = formatPositionValue(position.ratioY);
  showCurrentSpeedInput.checked = Boolean(settings.showCurrentSpeed);
  if (rewindAdvanceStepsInput) {
    rewindAdvanceStepsInput.value = formatStepList(settings.rewindAdvanceSteps);
  }
}

function handleKeyCapture(event, input) {
  if (event.key === 'Tab') {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  const normalized = normalizeKey(event.key);
  setKeyInputValue(input, normalized, event.key);
  persistSettingsFromForm();
}

function setKeyInputValue(input, value, displayValue) {
  input.dataset.value = value || '';
  const label = formatKeyLabel(displayValue || value || '');
  input.value = label;
  input.title = value || '';
}

function formatKeyLabel(value) {
  if (!value) {
    return '';
  }

  if (value.length === 1) {
    return value.toUpperCase();
  }

  return value.toUpperCase();
}

function normalizeKey(key) {
  if (!key) {
    return '';
  }
  return key.length === 1 ? key.toLowerCase() : key.toLowerCase();
}

function persistSettingsFromForm() {
  const payload = collectFormSettings();
  saveSettings(payload).catch((error) => {
    console.error('my_browser_assistant: failed to save settings', error);
  });
}

function collectFormSettings() {
  const settings = {};

  keyInputMap.forEach((input, settingName) => {
    const value = input.dataset.value || DEFAULT_SETTINGS[settingName];
    settings[settingName] = value;
  });

  valueInputMap.forEach((input, settingName) => {
    settings[settingName] = parseNumber(input.value, DEFAULT_SETTINGS[settingName]);
  });
  settings.overlayPosition = {
    x: currentSettings?.overlayPosition?.x ?? DEFAULT_SETTINGS.overlayPosition.x,
    y: currentSettings?.overlayPosition?.y ?? DEFAULT_SETTINGS.overlayPosition.y,
    ratioX: clampRatio(parseFloat(overlayPosXInput.value) / 100),
    ratioY: clampRatio(parseFloat(overlayPosYInput.value) / 100)
  };
  settings.showCurrentSpeed = showCurrentSpeedInput.checked;
  settings.rewindAdvanceSteps = parseStepListInput(
    rewindAdvanceStepsInput?.value,
    currentSettings?.rewindAdvanceSteps ?? DEFAULT_SETTINGS.rewindAdvanceSteps
  );

  return settings;
}

function parseNumber(value, fallback) {
  const parsed = Number(value);
  if (Number.isFinite(parsed)) {
    return parsed;
  }
  return fallback;
}

function formatPositionValue(value) {
  if (!Number.isFinite(value)) {
    return '';
  }
  return Math.round(value * 100);
}

function clampRatio(value) {
  if (!Number.isFinite(value)) {
    return null;
  }
  return Math.min(Math.max(value, 0), 1);
}

function formatStepList(steps) {
  if (!Array.isArray(steps) || !steps.length) {
    return (DEFAULT_SETTINGS.rewindAdvanceSteps || []).join(', ');
  }
  return steps.join(', ');
}

function parseStepListInput(value, fallback) {
  const fallbackList = Array.isArray(fallback) && fallback.length ? fallback : DEFAULT_SETTINGS.rewindAdvanceSteps;
  if (typeof value !== 'string') {
    return [...fallbackList];
  }
  const parts = value
    .split(/[\s,]+/)
    .map((part) => Number(part))
    .filter((num) => Number.isFinite(num) && num >= 0.1 && num <= 600);
  return parts.length ? parts : [...fallbackList];
}
