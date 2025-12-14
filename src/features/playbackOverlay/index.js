import { ensurePlaybackOverlayStyles } from './styles.js';
import { PlaybackController } from './controller.js';
import { saveSettings } from '../../lib/settings.js';

const DEFAULT_REWIND_ADVANCE_STEPS = [2, 5, 10];

export class PlaybackOverlayFeature {
  constructor(settings) {
    this.settings = settings;
    this.controllers = new Map();
    this.overlayVisible = settings.showCurrentSpeed;
    this.preferredSpeed = settings.preferSpeed || 1;
    this.lastCustomSpeed = this.preferredSpeed;
    this.speedStep = Number.isFinite(settings.speedStep) ? settings.speedStep : 0.1;
    this.overlayFontSize = Number.isFinite(settings.overlayFontSize) ? settings.overlayFontSize : 18;
    this.overlayBackgroundAlpha = Number.isFinite(settings.overlayBackgroundAlpha)
      ? settings.overlayBackgroundAlpha
      : 0.5;
    this.overlayPosition = {
      ...(settings.overlayPosition || { x: 0, y: 0, ratioX: 0.01, ratioY: 0.05 })
    };
    this.rewindAdvanceSteps = this.normalizeRewindAdvanceSteps(settings.rewindAdvanceSteps);
    this.rewindAdvanceCurrentStep = this.resolveRewindAdvanceCurrentStep(
      settings.rewindAdvanceCurrentStep
    );
    this.activeVideo = null;
    this.mutationObserver = null;
    this.handleKeydown = this.handleKeydown.bind(this);
  }

  init() {
    ensurePlaybackOverlayStyles();
    this.scanForExistingVideos();
    this.observeDom();
    document.addEventListener('keydown', this.handleKeydown, true);
  }

  dispose() {
    document.removeEventListener('keydown', this.handleKeydown, true);
    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
    }
    this.controllers.forEach(({ controller, listeners }) => {
      listeners.forEach(({ type, handler, options }) => controller.video.removeEventListener(type, handler, options));
      controller.destroy();
    });
    this.controllers.clear();
  }

  updateSettings(nextSettings) {
    this.settings = nextSettings;
    this.overlayVisible = nextSettings.showCurrentSpeed;
    this.speedStep = Number.isFinite(nextSettings.speedStep) ? nextSettings.speedStep : this.speedStep;
    this.overlayFontSize = Number.isFinite(nextSettings.overlayFontSize)
      ? nextSettings.overlayFontSize
      : this.overlayFontSize;
    this.overlayBackgroundAlpha = Number.isFinite(nextSettings.overlayBackgroundAlpha)
      ? nextSettings.overlayBackgroundAlpha
      : this.overlayBackgroundAlpha;
    this.overlayPosition = {
      ...(nextSettings.overlayPosition || this.overlayPosition)
    };
    this.rewindAdvanceSteps = this.normalizeRewindAdvanceSteps(nextSettings.rewindAdvanceSteps);
    this.rewindAdvanceCurrentStep = this.resolveRewindAdvanceCurrentStep(
      nextSettings.rewindAdvanceCurrentStep
    );

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

    const controller = new PlaybackController(video, {
      showOverlay: this.overlayVisible,
      fontSize: this.overlayFontSize,
      backgroundAlpha: this.overlayBackgroundAlpha,
      position: this.overlayPosition,
      stepSeconds: this.getRewindAdvanceStep(),
      onRateChange: (rate) => this.handleControllerRateChange(rate),
      onPositionChange: (position) => this.handleOverlayPositionChange(position)
    });
    const listeners = this.createActivationListeners(video);
    this.controllers.set(video, { controller, listeners });

    if (!this.activeVideo) {
      this.activeVideo = video;
    }
  }

  detachController(video) {
    const entry = this.controllers.get(video);
    if (!entry) {
      return;
    }

    entry.listeners.forEach(({ type, handler, options }) => video.removeEventListener(type, handler, options));
    entry.controller.destroy();
    this.controllers.delete(video);

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
      const rate = controller.changeSpeed(-this.speedStep);
      controller.flashOverlay();
      this.recordCustomSpeed(rate);
      return;
    }

    if (key === settings.increaseKey) {
      prevents();
      const rate = controller.changeSpeed(this.speedStep);
      controller.flashOverlay();
      this.recordCustomSpeed(rate);
      return;
    }

    if (key === settings.cycleRewindAdvanceKey) {
      prevents();
      this.cycleRewindAdvanceStep();
      controller.flashOverlay();
      return;
    }

    if (key === settings.rewindKey) {
      prevents();
      controller.rewind(this.getRewindAdvanceStep());
      return;
    }

    if (key === settings.advanceKey) {
      prevents();
      controller.advance(this.getRewindAdvanceStep());
      return;
    }

    if (key === settings.toggleOverlayKey) {
      prevents();
      this.overlayVisible = !this.overlayVisible;
      this.controllers.forEach(({ controller: ctrl }) => ctrl.setOverlayVisibility(this.overlayVisible));
      saveSettings({ showCurrentSpeed: this.overlayVisible });
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

  normalizeRewindAdvanceSteps(steps) {
    if (Array.isArray(steps) && steps.length) {
      const sanitized = steps
        .map((step) => Number(step))
        .filter((value) => Number.isFinite(value) && value >= 0.1 && value <= 600);
      if (sanitized.length) {
        return sanitized;
      }
    }
    return DEFAULT_REWIND_ADVANCE_STEPS.slice();
  }

  resolveRewindAdvanceCurrentStep(value) {
    const steps = this.rewindAdvanceSteps?.length ? this.rewindAdvanceSteps : DEFAULT_REWIND_ADVANCE_STEPS;
    if (Number.isFinite(value)) {
      const match = steps.find((step) => isApproximately(step, value, 0.0001));
      if (match) {
        return match;
      }
    }
    return steps[0];
  }

  getRewindAdvanceStep() {
    if (!this.rewindAdvanceSteps || !this.rewindAdvanceSteps.length) {
      this.rewindAdvanceSteps = DEFAULT_REWIND_ADVANCE_STEPS.slice();
    }
    if (!Number.isFinite(this.rewindAdvanceCurrentStep)) {
      this.rewindAdvanceCurrentStep = this.rewindAdvanceSteps[0];
    }
    return this.rewindAdvanceCurrentStep;
  }

  cycleRewindAdvanceStep() {
    const steps = this.rewindAdvanceSteps && this.rewindAdvanceSteps.length ? this.rewindAdvanceSteps : DEFAULT_REWIND_ADVANCE_STEPS;
    const currentIndex = steps.findIndex((step) => isApproximately(step, this.rewindAdvanceCurrentStep, 0.0001));
    const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % steps.length;
    this.rewindAdvanceCurrentStep = steps[nextIndex];
    saveSettings({ rewindAdvanceCurrentStep: this.rewindAdvanceCurrentStep });
    this.applyRewindAdvanceStepToControllers();
  }

  applyRewindAdvanceStepToControllers() {
    const step = this.getRewindAdvanceStep();
    this.controllers.forEach(({ controller }) => controller.setRewindAdvanceStep(step));
  }
}

function normalizeKey(key) {
  if (typeof key !== 'string') {
    return '';
  }
  return key.length === 1 ? key.toLowerCase() : key.toLowerCase();
}

function isApproximately(value, target, threshold = 0.01) {
  if (!Number.isFinite(value) || !Number.isFinite(target)) {
    return false;
  }
  return Math.abs(value - target) <= threshold;
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
  return Math.min(Math.max(Math.round(value * 1000) / 1000, 0), 1);
}

function isTypingTarget(target) {
  if (!(target instanceof Element)) {
    return false;
  }

  const tagName = target.tagName;
  if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') {
    return true;
  }

  return target.isContentEditable;
}
