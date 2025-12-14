import { PlaybackOverlay } from './overlay.js';

const MIN_SPEED = 0.07;
const MAX_SPEED = 16;

export class PlaybackController {
  constructor(
    video,
    {
      showOverlay,
      fontSize,
      backgroundAlpha,
      position,
      stepSeconds,
      onRateChange,
      onPositionChange
    } = {}
  ) {
    this.video = video;
    this.overlay = new PlaybackOverlay(video, {
      visible: showOverlay,
      fontSize,
      backgroundAlpha,
      position,
      onPositionChange
    });
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

    this.video.addEventListener('ratechange', this.handleRateChange);
    this.handleRateChange();
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

  setSpeed(value) {
    const next = clamp(value, MIN_SPEED, MAX_SPEED);
    this.video.playbackRate = next;
    this.overlay.update(next);
    return next;
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
    this.overlay.detach();
  }
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
