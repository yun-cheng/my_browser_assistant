import { PlaybackOverlay } from './overlay.js';

const MIN_SPEED = 0.07;
const MAX_SPEED = 16;
const MIN_VOLUME_MULTIPLIER = 0.05;
const MAX_VOLUME_MULTIPLIER = 4;

let sharedAudioContext = null;
let sharedAudioContextFailed = false;

export class PlaybackController {
  constructor(
    video,
    {
      showOverlay,
      fontSize,
      backgroundAlpha,
      position,
      stepSeconds,
      overlayId,
      onRateChange,
      onPositionChange
    } = {}
  ) {
    this.video = video;
    this.volumeMultiplier = 1;
    this.nativeVolumeLimit = 1;
    this.previousNativeVolume = null;
    this.audioPipeline = null;
    this.audioPipelineFailed = false;
    this.overlay = new PlaybackOverlay(video, {
      visible: showOverlay,
      fontSize,
      backgroundAlpha,
      position,
      onPositionChange
    });
    if (overlayId) {
      this.overlay.element.setAttribute('data-my-browser-assistant-overlay-id', overlayId);
    }
    this.overlay.setVolumePercent(100);
    if (Number.isFinite(stepSeconds)) {
      this.overlay.setStepSeconds(stepSeconds);
    }
    this.onRateChange = onRateChange;
    this.overlay.attach();

    this.handleRateChange = () => {
      const rate = this.video.playbackRate || 1;
      this.overlay.update(rate);
      if (typeof this.onRateChange === 'function') {
        this.onRateChange(rate);
      }
    };

    this.handleVolumeChange = () => {
      if (!this.audioPipeline) {
        this.enforceNativeVolumeLimit();
      }
    };

    this.video.addEventListener('ratechange', this.handleRateChange);
    this.video.addEventListener('volumechange', this.handleVolumeChange);
    this.handleRateChange();
    this.enforceNativeVolumeLimit();
  }

  setOverlayVisibility(visible) {
    this.overlay.setVisible(visible);
  }

  setOverlayAppearance(options) {
    this.overlay.setAppearance(options);
  }

  setOverlayPosition(position) {
    this.overlay.setPosition(position);
  }

  flashOverlay(duration = 1000) {
    this.overlay.showTemporarily(duration);
  }

  setRewindAdvanceStep(stepSeconds) {
    this.overlay.setStepSeconds(stepSeconds);
  }

  setVolumeMultiplier(multiplier) {
    const normalized = clamp(multiplier, MIN_VOLUME_MULTIPLIER, MAX_VOLUME_MULTIPLIER);
    const wantsBoost = normalized > 1.0001;
    const needsPipeline = wantsBoost || Boolean(this.audioPipeline);
    let appliedMultiplier = normalized;
    const pipelineReady = needsPipeline ? this.ensureAudioPipeline() : false;
    if (pipelineReady) {
      this.nativeVolumeLimit = 1;
      this.captureNativeVolumeForBoost();
      this.applyAudioPipelineGain(normalized);
    } else {
      appliedMultiplier = Math.min(normalized, 1);
      this.nativeVolumeLimit = appliedMultiplier;
      this.enforceNativeVolumeLimit();
    }
    this.volumeMultiplier = appliedMultiplier;
    this.overlay.setVolumePercent(appliedMultiplier * 100);
  }

  getVolumeMultiplier() {
    return this.volumeMultiplier;
  }

  setVideoVolume(value) {
    if (!Number.isFinite(value)) {
      return;
    }
    try {
      this.video.volume = Math.min(Math.max(value, 0), 1);
    } catch (_) {
      // Some videos may block programmatic volume changes.
    }
  }

  setSpeed(value) {
    const next = clamp(value, MIN_SPEED, MAX_SPEED);
    const rounded = Math.round(next * 10) / 10;
    this.video.playbackRate = rounded;
    this.overlay.update(rounded);
    return rounded;
  }

  changeSpeed(delta) {
    return this.setSpeed((this.video.playbackRate || 1) + delta);
  }

  rewind(seconds) {
    this.seekBy(-Math.abs(seconds));
    this.flashOverlay();
  }

  advance(seconds) {
    this.seekBy(Math.abs(seconds));
    this.flashOverlay();
  }

  seekBy(seconds) {
    try {
      const duration = Number.isFinite(this.video.duration) ? this.video.duration : null;
      const target = (this.video.currentTime || 0) + seconds;
      if (duration != null) {
        this.video.currentTime = Math.min(Math.max(target, 0), duration);
      } else {
        this.video.currentTime = Math.max(target, 0);
      }
    } catch (_) {
      // Some videos may not allow seeking; ignore errors.
    }
  }

  destroy() {
    this.video.removeEventListener('ratechange', this.handleRateChange);
    this.video.removeEventListener('volumechange', this.handleVolumeChange);
    this.teardownAudioPipeline();
    this.overlay.detach();
  }

  ensureAudioPipeline() {
    if (this.audioPipelineFailed) {
      return false;
    }
    if (this.audioPipeline) {
      const context = this.audioPipeline.context;
      if (context?.state === 'suspended') {
        context.resume().catch(() => {});
      }
      return true;
    }
    const context = getSharedAudioContext();
    if (!context) {
      this.audioPipelineFailed = true;
      return false;
    }
    try {
      const source = context.createMediaElementSource(this.video);
      const gainNode = context.createGain();
      source.connect(gainNode).connect(context.destination);
      this.audioPipeline = { context, source, gainNode };
      return true;
    } catch (error) {
      console.warn('my_browser_assistant: failed to create audio context for volume multiplier', error);
      this.audioPipelineFailed = true;
      this.audioPipeline = null;
      return false;
    }
  }

  applyAudioPipelineGain(multiplier) {
    if (!this.audioPipeline) {
      return;
    }
    this.audioPipeline.gainNode.gain.value = multiplier;
  }

  enforceNativeVolumeLimit() {
    if (!Number.isFinite(this.nativeVolumeLimit) || this.nativeVolumeLimit >= 0.999) {
      this.restoreNativeVolumeIfNeeded();
      return;
    }
    const limit = Math.min(Math.max(this.nativeVolumeLimit, 0), 1);
    const currentVolume = Number.isFinite(this.video.volume) ? this.video.volume : 1;
    if (this.previousNativeVolume == null) {
      this.previousNativeVolume = currentVolume;
    }
    if (currentVolume > limit + 0.0001) {
      this.video.volume = limit;
    }
  }

  teardownAudioPipeline() {
    if (!this.audioPipeline) {
      return;
    }
    try {
      this.audioPipeline.source?.disconnect();
      this.audioPipeline.gainNode?.disconnect();
      this.audioPipeline.context?.close?.();
    } catch (_) {
      // ignore teardown errors
    }
    this.audioPipeline = null;
  }

  restoreNativeVolumeIfNeeded() {
    if (!Number.isFinite(this.previousNativeVolume)) {
      this.previousNativeVolume = null;
      return;
    }
    const target = clamp(this.previousNativeVolume, 0, 1);
    this.previousNativeVolume = null;
    try {
      this.video.volume = target;
    } catch (_) {
      // ignore
    }
  }

  captureNativeVolumeForBoost() {
    const currentVolume = Number.isFinite(this.video.volume) ? this.video.volume : 1;
    if (this.previousNativeVolume == null) {
      this.previousNativeVolume = currentVolume;
    }
    if (Math.abs(currentVolume - 1) > 0.001) {
      try {
        this.video.volume = 1;
      } catch (_) {
        // ignore
      }
    }
  }
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getSharedAudioContext() {
  if (sharedAudioContextFailed) {
    return null;
  }
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) {
    sharedAudioContextFailed = true;
    return null;
  }
  if (!sharedAudioContext || sharedAudioContext.state === 'closed') {
    try {
      sharedAudioContext = new AudioContextCtor();
    } catch (error) {
      sharedAudioContext = null;
      sharedAudioContextFailed = true;
      console.warn('my_browser_assistant: failed to initialize shared audio context', error);
      return null;
    }
  }
  if (sharedAudioContext.state === 'suspended') {
    sharedAudioContext.resume().catch(() => {});
  }
  return sharedAudioContext;
}
