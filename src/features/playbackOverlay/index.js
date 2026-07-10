import { isApproximately, normalizeKey, clamp } from '../../lib/utils.js';
import {
  MAX_VOLUME_MULTIPLIER,
  MIN_FAST_FORWARD_SPEED,
  MAX_FAST_FORWARD_SPEED,
  MIN_SLOW_MOTION_SPEED,
  MAX_SLOW_MOTION_SPEED,
  FAST_FORWARD_HOLD_DELAY,
  OVERLAY_ID_ATTR,
  DEFAULT_REWIND_ADVANCE_STEP_PRESETS,
  KEY_RELAY_MESSAGE
} from '../../lib/constants.js';
import { ensurePlaybackOverlayStyles } from './styles.js';
import { PlaybackController } from './controller.js';
import { saveSettings, DEFAULT_SETTINGS } from '../../lib/settings.js';

export class PlaybackOverlayFeature {
  constructor(settings) {
    this.settings = settings;
    this.controllers = new Map();
    this.overlayVisible = settings.showCurrentSpeed;
    this.preferredSpeed = settings.preferSpeed || 1;
    this.lastCustomSpeed = this.preferredSpeed;
    this.speedAdjustmentStep = Number.isFinite(settings.speedAdjustmentStep)
      ? settings.speedAdjustmentStep
      : 0.1;
    this.overlayFontSize = Number.isFinite(settings.overlayFontSize) ? settings.overlayFontSize : 18;
    this.overlayBackgroundAlpha = Number.isFinite(settings.overlayBackgroundAlpha)
      ? settings.overlayBackgroundAlpha
      : 0.5;
    this.overlayPosition = {
      ...(settings.overlayPosition || { x: 0, y: 0, ratioX: 0.01, ratioY: 0.05 })
    };
    this.rewindAdvanceStepPresets = this.normalizeRewindAdvanceStepPresets(
      settings.rewindAdvanceStepPresets
    );
    this.rewindAdvanceStep = this.resolveRewindAdvanceStep(settings.rewindAdvanceStep);
    this.volumePresetPercents = this.normalizeVolumePresetPercents(
      settings.volumePresetPercents
    );
    this.volumePresetPercent = 1;
    this.fastForwardSpeed = clampFastForwardSpeed(settings.fastForwardSpeed);
    this.slowMotionSpeed = clampSlowMotionSpeed(settings.slowMotionSpeed);
    this.fastForwardState = {
      timerId: null,
      controller: null,
      previousRate: null,
      active: false,
      targetRate: null,
      pendingAdvance: null,
      pendingAdvanceStep: null
    };
    this.slowMotionState = {
      timerId: null,
      controller: null,
      previousRate: null,
      active: false,
      targetRate: null,
      pendingRewind: null,
      pendingRewindStep: null
    };
    this.activeVideo = null;
    this.mutationObserver = null;
    this.overlayIdCounter = 1;
    this.handleKeydown = this.handleKeydown.bind(this);
    this.handleKeyup = this.handleKeyup.bind(this);
    this.handleRuntimeMessage = this.handleRuntimeMessage.bind(this);
  }

  init() {
    ensurePlaybackOverlayStyles();
    this.scanForExistingVideos();
    this.observeDom();
    document.addEventListener('keydown', this.handleKeydown, true);
    document.addEventListener('keyup', this.handleKeyup, true);
    if (chrome?.runtime?.onMessage?.addListener) {
      chrome.runtime.onMessage.addListener(this.handleRuntimeMessage);
    }
  }

  dispose() {
    document.removeEventListener('keydown', this.handleKeydown, true);
    document.removeEventListener('keyup', this.handleKeyup, true);
    if (chrome?.runtime?.onMessage?.removeListener) {
      chrome.runtime.onMessage.removeListener(this.handleRuntimeMessage);
    }
    this.stopFastForward(false);
    this.stopSlowMotion(false);
    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
    }
    this.controllers.forEach(({ controller, listeners }) => {
      listeners.forEach(({ type, handler, options }) => controller.video.removeEventListener(type, handler, options));
      controller.destroy();
      controller.video.removeAttribute(OVERLAY_ID_ATTR);
    });
    this.controllers.clear();
  }

  updateSettings(nextSettings) {
    this.settings = nextSettings;
    this.overlayVisible = nextSettings.showCurrentSpeed;
    this.speedAdjustmentStep = Number.isFinite(nextSettings.speedAdjustmentStep)
      ? nextSettings.speedAdjustmentStep
      : this.speedAdjustmentStep;
    this.overlayFontSize = Number.isFinite(nextSettings.overlayFontSize)
      ? nextSettings.overlayFontSize
      : this.overlayFontSize;
    this.overlayBackgroundAlpha = Number.isFinite(nextSettings.overlayBackgroundAlpha)
      ? nextSettings.overlayBackgroundAlpha
      : this.overlayBackgroundAlpha;
    this.overlayPosition = {
      ...(nextSettings.overlayPosition || this.overlayPosition)
    };
    this.rewindAdvanceStepPresets = this.normalizeRewindAdvanceStepPresets(
      nextSettings.rewindAdvanceStepPresets
    );
    this.rewindAdvanceStep = this.resolveRewindAdvanceStep(nextSettings.rewindAdvanceStep);
    this.volumePresetPercents = this.normalizeVolumePresetPercents(
      nextSettings.volumePresetPercents
    );
    this.volumePresetPercent = clampVolumePresetValue(this.volumePresetPercent);
    this.fastForwardSpeed = clampFastForwardSpeed(nextSettings.fastForwardSpeed);
    this.slowMotionSpeed = clampSlowMotionSpeed(nextSettings.slowMotionSpeed);

    if (!isApproximately(this.preferredSpeed, nextSettings.preferSpeed)) {
      this.preferredSpeed = nextSettings.preferSpeed;
      this.lastCustomSpeed = nextSettings.preferSpeed;
    }

    const step = this.getRewindAdvanceStep();
    this.controllers.forEach(({ controller }) => {
      controller.setOverlayVisibility(this.overlayVisible);
      controller.setOverlayAppearance({
        fontSize: this.overlayFontSize,
        backgroundAlpha: this.overlayBackgroundAlpha
      });
      controller.setOverlayPosition(this.overlayPosition);
      controller.setRewindAdvanceStep(step);
      this.applyVolumeMultiplier(controller);
    });
  }

  scanForExistingVideos() {
    this.traverseForVideos(document, (video) => this.attachController(video));
  }

  observeDom() {
    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
    }

    this.mutationObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => this.processPotentialVideo(node, (video) => this.attachController(video)));
        mutation.removedNodes.forEach((node) => this.processPotentialVideo(node, (video) => this.detachController(video)));
      }
    });

    this.mutationObserver.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true
    });
  }

  processPotentialVideo(node, callback) {
    this.traverseForVideos(node, callback);
  }

  traverseForVideos(rootNode, callback) {
    if (!rootNode) {
      return;
    }

    const visit = (node) => {
      if (!node) {
        return;
      }

      if (node instanceof HTMLVideoElement) {
        callback(node);
      }

      // Recurse into shadow DOM when present.
      if (node instanceof Element && node.shadowRoot) {
        visit(node.shadowRoot);
      }

      const children = node.childNodes;
      if (children && children.length) {
        for (const child of children) {
          visit(child);
        }
      }
    };

    visit(rootNode);
  }

  attachController(video) {
    if (!(video instanceof HTMLVideoElement) || this.controllers.has(video)) {
      return;
    }

    const existingId = video.getAttribute(OVERLAY_ID_ATTR);
    if (existingId) {
      const existingOverlay = document.querySelector(
        `.my-browser-assistant-overlay[${OVERLAY_ID_ATTR}="${existingId}"]`
      );
      if (existingOverlay) {
        return;
      }
      video.removeAttribute(OVERLAY_ID_ATTR);
    }

    const overlayId = `mba-${this.overlayIdCounter++}`;
    video.setAttribute(OVERLAY_ID_ATTR, overlayId);

    const controller = new PlaybackController(video, {
      showOverlay: this.overlayVisible,
      fontSize: this.overlayFontSize,
      backgroundAlpha: this.overlayBackgroundAlpha,
      position: this.overlayPosition,
      stepSeconds: this.getRewindAdvanceStep(),
      onRateChange: (rate) => this.handleControllerRateChange(rate),
      onPositionChange: (position) => this.handleOverlayPositionChange(position),
      overlayId
    });
    const listeners = this.createActivationListeners(video);
    this.controllers.set(video, { controller, listeners });

    if (!this.activeVideo) {
      this.activeVideo = video;
    }
    this.applyVolumeMultiplier(controller);
  }

  detachController(video) {
    const entry = this.controllers.get(video);
    if (!entry) {
      return;
    }

    entry.listeners.forEach(({ type, handler, options }) => video.removeEventListener(type, handler, options));
    entry.controller.destroy();
    this.controllers.delete(video);
    video.removeAttribute(OVERLAY_ID_ATTR);
    if (this.fastForwardState.controller === entry.controller) {
      this.stopFastForward(false);
    }
    if (this.slowMotionState.controller === entry.controller) {
      this.stopSlowMotion(false);
    }

    if (this.activeVideo === video) {
      this.activeVideo = this.getFallbackVideo();
    }
  }

  createActivationListeners(video) {
    const events = ['click', 'pointerdown', 'play', 'focus', 'mouseenter', 'enterpictureinpicture'];
    const listeners = events.map((type) => {
      const handler = () => this.setActiveVideo(video);
      video.addEventListener(type, handler, true);
      return { type, handler, options: true };
    });

    const leavePiPHandler = () => {
      if (document.pictureInPictureElement === video) {
        this.setActiveVideo(video);
      }
    };
    video.addEventListener('leavepictureinpicture', leavePiPHandler, true);
    listeners.push({ type: 'leavepictureinpicture', handler: leavePiPHandler, options: true });

    return listeners;
  }

  setActiveVideo(video) {
    if (video instanceof HTMLVideoElement && this.controllers.has(video)) {
      this.activeVideo = video;
    }
  }

  getFallbackVideo() {
    for (const [video] of this.controllers.entries()) {
      return video;
    }
    return null;
  }

  getPrimaryController() {
    const active = this.activeVideo;
    if (active && this.controllers.has(active)) {
      return this.controllers.get(active).controller;
    }

    let playingController = null;
    for (const [video, entry] of this.controllers.entries()) {
      if (!video.paused) {
        return entry.controller;
      }
      if (!playingController) {
        playingController = entry.controller;
      }
    }
    return playingController;
  }

  handleKeydown(event) {
    if (event.defaultPrevented || event.repeat) {
      return;
    }

    if (event.altKey || event.metaKey || event.ctrlKey) {
      return;
    }

    if (isTypingTarget(event.target)) {
      return;
    }

    const key = normalizeKey(event.key);
    const settings = this.settings;
    const controller = this.getPrimaryController();

    if (!controller) {
      // No video in this frame. If a child iframe exists, the video is likely in it
      // (e.g. a cross-origin YouTube embed) but never receives this keystroke because
      // it isn't focused — relay it there. We deliberately do NOT preventDefault: on
      // pages with no video the relay finds no taker, and swallowing the key would
      // break unrelated single-key shortcuts on the host page (Gmail, etc.).
      if (this.isShortcutKey(key) && this.hasChildFrames()) {
        this.relayKeyCommand('keydown', event.key);
      }
      return;
    }

    const prevents = () => {
      event.preventDefault();
      event.stopPropagation();
    };

    if (key === settings.resetKey) {
      prevents();
      const currentRate = controller.video?.playbackRate ?? 1;
      if (!isApproximately(currentRate, 1)) {
        this.recordCustomSpeed(currentRate);
        controller.setSpeed(1);
      } else {
        const target = this.getCustomSpeedTarget();
        this.recordCustomSpeed(target);
        controller.setSpeed(target);
      }
      controller.flashOverlay();
      return;
    }

    if (key === settings.decreaseKey) {
      prevents();
      const rate = controller.changeSpeed(-this.speedAdjustmentStep);
      controller.flashOverlay();
      this.recordCustomSpeed(rate);
      return;
    }

    if (key === settings.increaseKey) {
      prevents();
      const rate = controller.changeSpeed(this.speedAdjustmentStep);
      controller.flashOverlay();
      this.recordCustomSpeed(rate);
      return;
    }

    if (key === settings.switchRewindAdvanceKey) {
      prevents();
      this.switchRewindAdvanceStep();
      controller.flashOverlay();
      return;
    }

    if (key === settings.cycleVolumePresetKey) {
      prevents();
      this.cycleVolumePreset(controller);
      return;
    }

    if (key === settings.rewindKey) {
      prevents();
      this.scheduleSlowMotion(controller);
      return;
    }

    if (key === settings.advanceKey) {
      prevents();
      this.scheduleFastForward(controller);
      return;
    }

    if (key === settings.toggleOverlayKey) {
      prevents();
      this.overlayVisible = !this.overlayVisible;
      this.controllers.forEach(({ controller: ctrl }) => ctrl.setOverlayVisibility(this.overlayVisible));
      saveSettings({ showCurrentSpeed: this.overlayVisible });
    }
  }

  handleKeyup(event) {
    if (event.defaultPrevented) {
      return;
    }
    if (event.altKey || event.metaKey || event.ctrlKey) {
      return;
    }
    const key = normalizeKey(event.key);
    // Hold-to-fast-forward / hold-to-slow-mo state lives in the frame that owns the
    // video. If that's a sibling frame, relay the release there (see handleKeydown).
    if (!this.hasLocalControllers()) {
      if (
        (key === this.settings.advanceKey || key === this.settings.rewindKey) &&
        this.hasChildFrames()
      ) {
        this.relayKeyCommand('keyup', event.key);
      }
      return;
    }
    if (key === this.settings.advanceKey) {
      const pendingController = this.fastForwardState.pendingAdvance;
      const pendingStep = this.fastForwardState.pendingAdvanceStep;
      const wasActive = this.fastForwardState.active;
      this.stopFastForward(true);
      if (!wasActive && pendingController && Number.isFinite(pendingStep)) {
        pendingController.advance(pendingStep);
      }
    } else if (key === this.settings.rewindKey) {
      const pendingController = this.slowMotionState.pendingRewind;
      const pendingStep = this.slowMotionState.pendingRewindStep;
      const wasActive = this.slowMotionState.active;
      this.stopSlowMotion(true);
      if (!wasActive && pendingController && Number.isFinite(pendingStep)) {
        pendingController.rewind(pendingStep);
      }
    }
  }

  hasLocalControllers() {
    return this.controllers.size > 0;
  }

  hasChildFrames() {
    return Boolean(document.querySelector('iframe'));
  }

  isShortcutKey(key) {
    const s = this.settings;
    return (
      key === s.resetKey ||
      key === s.decreaseKey ||
      key === s.increaseKey ||
      key === s.rewindKey ||
      key === s.advanceKey ||
      key === s.switchRewindAdvanceKey ||
      key === s.cycleVolumePresetKey ||
      key === s.toggleOverlayKey
    );
  }

  relayKeyCommand(kind, key) {
    try {
      chrome?.runtime?.sendMessage?.({ type: KEY_RELAY_MESSAGE, kind, key });
    } catch (_) {
      // Extension context may be gone (e.g. reload) — nothing we can do.
    }
  }

  handleRuntimeMessage(message) {
    if (!message || message.type !== KEY_RELAY_MESSAGE) {
      return;
    }
    // Only the frame that actually owns a video should act on a relayed key. Every
    // other frame in the tab receives the broadcast too and ignores it here.
    if (!this.hasLocalControllers()) {
      return;
    }
    const syntheticEvent = createSyntheticKeyEvent(message.key);
    if (message.kind === 'keydown') {
      this.handleKeydown(syntheticEvent);
    } else if (message.kind === 'keyup') {
      this.handleKeyup(syntheticEvent);
    }
  }

  handleOverlayPositionChange(position) {
    if (!position) {
      return;
    }
    const next = {
      x: clampPositionValue(position.x),
      y: clampPositionValue(position.y),
      ratioX: clampRatioValue(position.ratioX),
      ratioY: clampRatioValue(position.ratioY)
    };
    if (
      isApproximately(next.x, this.overlayPosition.x, 0.5) &&
      isApproximately(next.y, this.overlayPosition.y, 0.5) &&
      isApproximately(next.ratioX ?? 0, this.overlayPosition.ratioX ?? 0, 0.01) &&
      isApproximately(next.ratioY ?? 0, this.overlayPosition.ratioY ?? 0, 0.01)
    ) {
      return;
    }
    this.overlayPosition = next;
    saveSettings({ overlayPosition: next });
  }

  handleControllerRateChange(rate) {
    if (
      this.fastForwardState.active &&
      Number.isFinite(this.fastForwardState.targetRate) &&
      isApproximately(rate, this.fastForwardState.targetRate, 0.0001)
    ) {
      return;
    }
    if (
      this.slowMotionState.active &&
      Number.isFinite(this.slowMotionState.targetRate) &&
      isApproximately(rate, this.slowMotionState.targetRate, 0.0001)
    ) {
      return;
    }
    if (isApproximately(rate, 1)) {
      return;
    }
    this.recordCustomSpeed(rate);
  }

  recordCustomSpeed(rate) {
    if (!Number.isFinite(rate) || isApproximately(rate, 1)) {
      return;
    }
    this.lastCustomSpeed = rate;
  }

  getCustomSpeedTarget() {
    if (this.lastCustomSpeed && !isApproximately(this.lastCustomSpeed, 1)) {
      return this.lastCustomSpeed;
    }
    if (this.preferredSpeed && !isApproximately(this.preferredSpeed, 1)) {
      return this.preferredSpeed;
    }
    return 1;
  }

  normalizeRewindAdvanceStepPresets(steps) {
    if (Array.isArray(steps) && steps.length) {
      const sanitized = steps
        .map((step) => Number(step))
        .filter((value) => Number.isFinite(value) && value >= 0.1 && value <= 600);
      if (sanitized.length) {
        return sanitized;
      }
    }
    return DEFAULT_REWIND_ADVANCE_STEP_PRESETS.slice();
  }

  resolveRewindAdvanceStep(value) {
    const steps = this.rewindAdvanceStepPresets?.length
      ? this.rewindAdvanceStepPresets
      : DEFAULT_REWIND_ADVANCE_STEP_PRESETS;
    if (Number.isFinite(value)) {
      const match = steps.find((step) => isApproximately(step, value, 0.0001));
      if (match) {
        return match;
      }
    }
    return steps[0];
  }

  getRewindAdvanceStep() {
    if (!this.rewindAdvanceStepPresets || !this.rewindAdvanceStepPresets.length) {
      this.rewindAdvanceStepPresets = DEFAULT_REWIND_ADVANCE_STEP_PRESETS.slice();
    }
    if (!Number.isFinite(this.rewindAdvanceStep)) {
      this.rewindAdvanceStep = this.rewindAdvanceStepPresets[0];
    }
    return this.rewindAdvanceStep;
  }

  switchRewindAdvanceStep() {
    const steps =
      this.rewindAdvanceStepPresets && this.rewindAdvanceStepPresets.length
        ? this.rewindAdvanceStepPresets
        : DEFAULT_REWIND_ADVANCE_STEP_PRESETS;
    const currentIndex = steps.findIndex((step) => isApproximately(step, this.rewindAdvanceStep, 0.0001));
    const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % steps.length;
    this.rewindAdvanceStep = steps[nextIndex];
    saveSettings({ rewindAdvanceStep: this.rewindAdvanceStep });
    this.applyRewindAdvanceStepToControllers();
  }

  applyRewindAdvanceStepToControllers() {
    const step = this.getRewindAdvanceStep();
    this.controllers.forEach(({ controller }) => controller.setRewindAdvanceStep(step));
  }

  cycleVolumePreset(controller) {
    const presets = this.getVolumePresetList();
    if (!presets.length) {
      return;
    }
    const currentMultiplier = clampVolumePresetValue(this.volumePresetPercent ?? 1);
    let index = presets.findIndex((value) => isApproximately(value, currentMultiplier, 0.0001));
    if (index === -1) {
      index = presets.findIndex((value) => isApproximately(value, 1, 0.0001));
    }
    if (index === -1) {
      index = 0;
    }
    const nextVolume = presets[(index + 1) % presets.length];
    this.volumePresetPercent = nextVolume;
    this.applyVolumeMultiplierToControllers();
    if (controller) {
      controller.flashOverlay();
    }
  }

  getVolumePresetList() {
    if (this.volumePresetPercents && this.volumePresetPercents.length) {
      return this.volumePresetPercents;
    }
    return DEFAULT_SETTINGS.volumePresetPercents;
  }

  applyVolumeMultiplier(controller) {
    if (!controller) {
      return;
    }
    controller.setVolumeMultiplier(this.getCurrentVolumeMultiplier());
  }

  applyVolumeMultiplierToControllers() {
    const multiplier = this.getCurrentVolumeMultiplier();
    this.controllers.forEach(({ controller }) => controller.setVolumeMultiplier(multiplier));
  }

  getCurrentVolumeMultiplier() {
    if (!Number.isFinite(this.volumePresetPercent)) {
      return 1;
    }
    return clampVolumePresetValue(this.volumePresetPercent);
  }

  normalizeVolumePresetPercents(list) {
    let source = [];
    if (Array.isArray(list)) {
      source = list;
    } else if (typeof list === 'string') {
      source = list.split(/[\s,]+/);
    }
    if (!source.length) {
      return DEFAULT_SETTINGS.volumePresetPercents;
    }
    const normalized = source
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value))
      .map((value) => (value > MAX_VOLUME_MULTIPLIER + 0.0001 ? value / 100 : value))
      .map((value) => clamp(value, 0.05, MAX_VOLUME_MULTIPLIER))
      .filter(
        (value, index, arr) =>
          index === arr.findIndex((candidate) => Math.abs(candidate - value) < 0.0001)
      );
    return normalized.length ? normalized : DEFAULT_SETTINGS.volumePresetPercents;
  }

  scheduleFastForward(controller) {
    if (!controller) {
      return;
    }
    this.clearFastForwardTimer();
    this.fastForwardState.controller = controller;
    this.fastForwardState.previousRate = controller.video?.playbackRate ?? 1;
    this.fastForwardState.active = false;
    this.fastForwardState.targetRate = null;
    this.fastForwardState.pendingAdvance = controller;
    this.fastForwardState.pendingAdvanceStep = this.getRewindAdvanceStep();
    this.fastForwardState.timerId = window.setTimeout(
      () => this.activateFastForward(),
      FAST_FORWARD_HOLD_DELAY
    );
  }

  activateFastForward() {
    this.fastForwardState.timerId = null;
    const controller = this.fastForwardState.controller;
    if (!controller) {
      return;
    }
    this.fastForwardState.pendingAdvance = null;
    this.fastForwardState.pendingAdvanceStep = null;
    const targetRate = clampFastForwardSpeed(this.fastForwardSpeed);
    this.fastForwardState.active = true;
    this.fastForwardState.targetRate = targetRate;
    controller.setSpeed(targetRate);
    controller.flashOverlay();
  }

  stopFastForward(restoreRate) {
    this.clearFastForwardTimer();
    const wasActive = this.fastForwardState.active;
    const controller = this.fastForwardState.controller;
    const previousRate = this.fastForwardState.previousRate;
    const shouldRestore = Boolean(
      restoreRate && wasActive && controller && Number.isFinite(previousRate)
    );
    this.fastForwardState.active = false;
    this.fastForwardState.controller = null;
    this.fastForwardState.previousRate = null;
    this.fastForwardState.targetRate = null;
    this.fastForwardState.pendingAdvance = null;
    this.fastForwardState.pendingAdvanceStep = null;
    if (shouldRestore) {
      controller.setSpeed(previousRate);
      controller.flashOverlay();
      this.recordCustomSpeed(previousRate);
    }
  }

  clearFastForwardTimer() {
    if (this.fastForwardState.timerId) {
      clearTimeout(this.fastForwardState.timerId);
      this.fastForwardState.timerId = null;
    }
  }

  scheduleSlowMotion(controller) {
    if (!controller) {
      return;
    }
    this.clearSlowMotionTimer();
    this.slowMotionState.controller = controller;
    this.slowMotionState.previousRate = controller.video?.playbackRate ?? 1;
    this.slowMotionState.active = false;
    this.slowMotionState.targetRate = null;
    this.slowMotionState.pendingRewind = controller;
    this.slowMotionState.pendingRewindStep = this.getRewindAdvanceStep();
    this.slowMotionState.timerId = window.setTimeout(
      () => this.activateSlowMotion(),
      FAST_FORWARD_HOLD_DELAY
    );
  }

  activateSlowMotion() {
    this.slowMotionState.timerId = null;
    const controller = this.slowMotionState.controller;
    if (!controller) {
      return;
    }
    this.slowMotionState.pendingRewind = null;
    this.slowMotionState.pendingRewindStep = null;
    const targetRate = clampSlowMotionSpeed(this.slowMotionSpeed);
    this.slowMotionState.active = true;
    this.slowMotionState.targetRate = targetRate;
    controller.setSpeed(targetRate);
    controller.flashOverlay();
  }

  stopSlowMotion(restoreRate) {
    this.clearSlowMotionTimer();
    const wasActive = this.slowMotionState.active;
    const controller = this.slowMotionState.controller;
    const previousRate = this.slowMotionState.previousRate;
    const shouldRestore = Boolean(
      restoreRate && wasActive && controller && Number.isFinite(previousRate)
    );
    this.slowMotionState.active = false;
    this.slowMotionState.controller = null;
    this.slowMotionState.previousRate = null;
    this.slowMotionState.targetRate = null;
    this.slowMotionState.pendingRewind = null;
    this.slowMotionState.pendingRewindStep = null;
    if (shouldRestore) {
      controller.setSpeed(previousRate);
      controller.flashOverlay();
      this.recordCustomSpeed(previousRate);
    }
  }

  clearSlowMotionTimer() {
    if (this.slowMotionState.timerId) {
      clearTimeout(this.slowMotionState.timerId);
      this.slowMotionState.timerId = null;
    }
  }
}

// Builds an event-shaped object so a relayed key command can flow through the same
// handleKeydown/handleKeyup logic as a real DOM event. Relayed keys only ever pass the
// modifier/typing guards on the sending side, so those fields are always benign here;
// preventDefault/stopPropagation are no-ops since there's no real event to cancel.
function createSyntheticKeyEvent(key) {
  return {
    key,
    defaultPrevented: false,
    repeat: false,
    altKey: false,
    metaKey: false,
    ctrlKey: false,
    target: null,
    preventDefault() {},
    stopPropagation() {}
  };
}

function clampFastForwardSpeed(value) {
  if (!Number.isFinite(value)) {
    return DEFAULT_SETTINGS.fastForwardSpeed;
  }
  return clamp(value, MIN_FAST_FORWARD_SPEED, MAX_FAST_FORWARD_SPEED);
}

function clampSlowMotionSpeed(value) {
  if (!Number.isFinite(value)) {
    return DEFAULT_SETTINGS.slowMotionSpeed;
  }
  return clamp(value, MIN_SLOW_MOTION_SPEED, MAX_SLOW_MOTION_SPEED);
}

function clampVolumePresetValue(value) {
  if (!Number.isFinite(value)) {
    return 1;
  }
  let normalized = value;
  if (normalized > 1.0001) {
    normalized /= 100;
  }
  return clamp(normalized, 0.05, MAX_VOLUME_MULTIPLIER);
}

function clampPositionValue(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.round(value * 10) / 10);
}

function clampRatioValue(value) {
  if (!Number.isFinite(value)) {
    return null;
  }
  return clamp(Math.round(value * 1000) / 1000, 0, 1);
}

function isTypingTarget(target) {
  if (!(target instanceof Element)) {
    return false;
  }

  const tagName = target.tagName;
  if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') {
    return true;
  }

  return Boolean(target.isContentEditable);
}