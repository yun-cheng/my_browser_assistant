// ── Playback speed limits ──
export const MIN_PLAYBACK_SPEED = 0.07;
export const MAX_PLAYBACK_SPEED = 16;

// ── Fast-forward limits ──
export const MIN_FAST_FORWARD_SPEED = 1;
export const MAX_FAST_FORWARD_SPEED = 16;

// ── Slow-motion limits ──
export const MIN_SLOW_MOTION_SPEED = 0.1;
export const MAX_SLOW_MOTION_SPEED = 1;

// ── Volume boosting ──
export const MIN_VOLUME_MULTIPLIER = 0.05;
export const MAX_VOLUME_MULTIPLIER = 4;

// ── Hold-to-seek / hold-to-fast-forward timer ──
export const FAST_FORWARD_HOLD_DELAY = 250;

// ── DOM attributes used across modules ──
export const OVERLAY_ID_ATTR = 'data-my-browser-assistant-overlay-id';
export const POSITION_FLAG = 'data-my-browser-assistant-positioned';
export const SETTINGS_STORAGE_KEY = 'my_browser_assistant_settings';
export const OVERLAY_STYLE_ID = 'my-browser-assistant-playback-overlay-styles';

// ── Default rewind/advance step presets ──
export const DEFAULT_REWIND_ADVANCE_STEP_PRESETS = [2, 5, 10];
