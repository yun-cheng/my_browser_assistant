import { clamp } from '../../lib/utils.js';
import { POSITION_FLAG } from '../../lib/constants.js';

export class PlaybackOverlay {
  constructor(
    video,
    {
      visible = true,
      fontSize = 18,
      backgroundAlpha = 0.5,
      position = { x: 0, y: 0, ratioX: 0.01, ratioY: 0.05 },
      onPositionChange
    } = {}
  ) {
    this.video = video;
    this.visible = visible;
    this.tempVisible = false;
    this.tempVisibilityTimer = null;
    this.fontSize = fontSize;
    this.backgroundAlpha = backgroundAlpha;
    this.position = normalizePositionOption(position);
    this.currentSpeed = 1;
    this.stepSeconds = null;
    this.volumePercent = null;
    this.onPositionChange = onPositionChange;
    this.element = document.createElement('div');
    this.element.className = 'my-browser-assistant-overlay';
    this.applyBaseStyles();
    this.parentOriginalPosition = null;
    this.parentElement = null;
    this.shadowHost = null;
    this.attached = false;
    this.standaloneMedia = false;
    this.dragState = null;
    this.resizeObserver = null;
    this.handlePointerDown = this.handlePointerDown.bind(this);
    this.handlePointerMove = this.handlePointerMove.bind(this);
    this.handlePointerUp = this.handlePointerUp.bind(this);
    this.handleViewportChange = this.handleViewportChange.bind(this);
    this.applyAppearance();
    this.applyPosition();
    this.update(video.playbackRate || 1);
    this.updateVisibility();
    this.handleClickCapture = (event) => {
      event.preventDefault();
      event.stopPropagation();
    };
  }

  attach() {
    if (this.attached) {
      return;
    }

    this.parentOriginalPosition = null;
    const { parent, computedStyle } = this.resolveParentElement();
    const style = computedStyle;

    // Chrome's built-in media viewer (opening a bare video/audio file) lays the
    // <video> out as position:absolute sized against the initial containing block
    // (the viewport). Forcing position:relative onto <html>/<body> would move the
    // video's containing block to that zero-height element and collapse it to a few
    // pixels. In that case, pin the overlay to the viewport with position:fixed and
    // leave ancestor positioning untouched.
    this.standaloneMedia = isStandaloneMediaDocument();
    if (this.standaloneMedia) {
      this.element.style.setProperty('position', 'fixed', 'important');
    } else if (style && style.position === 'static') {
      this.parentOriginalPosition = parent.style.position;
      parent.setAttribute(POSITION_FLAG, 'true');
      parent.style.position = 'relative';
    }

    parent.appendChild(this.element);
    this.parentElement = parent;
    this.element.addEventListener('click', this.handleClickCapture, true);
    this.element.addEventListener('pointerdown', this.handlePointerDown);
    window.addEventListener('resize', this.handleViewportChange);
    document.addEventListener('fullscreenchange', this.handleViewportChange);
    // Recompute position now that the element is in the document flow and has real dimensions.
    this.applyPosition();
    this.observeResizeTarget(parent);
    this.attached = true;
  }

  detach() {
    if (!this.attached) {
      return;
    }

    this.stopDragging();
    this.element.removeEventListener('click', this.handleClickCapture, true);
    this.element.removeEventListener('pointerdown', this.handlePointerDown);
    window.removeEventListener('resize', this.handleViewportChange);
    document.removeEventListener('fullscreenchange', this.handleViewportChange);
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    const parent = this.element.parentElement;
    if (parent) {
      parent.removeChild(this.element);
      if (parent.hasAttribute(POSITION_FLAG)) {
        parent.style.position = this.parentOriginalPosition || '';
        parent.removeAttribute(POSITION_FLAG);
      }
    }
    if (this.standaloneMedia) {
      // Restore the base absolute positioning in case this overlay is re-attached
      // to a normal (non-media-document) page later.
      this.element.style.setProperty('position', 'absolute', 'important');
      this.standaloneMedia = false;
    }
    this.parentElement = null;
    this.parentOriginalPosition = null;
    this.attached = false;
  }

  update(speed) {
    this.currentSpeed = Number(speed) || 1;
    this.renderText();
  }

  setVisible(visible) {
    this.visible = visible;
    this.updateVisibility();
  }

  showTemporarily(duration = 1000) {
    this.tempVisible = true;
    this.updateVisibility();
    if (this.tempVisibilityTimer) {
      clearTimeout(this.tempVisibilityTimer);
    }
    this.tempVisibilityTimer = window.setTimeout(() => {
      this.tempVisibilityTimer = null;
      this.tempVisible = false;
      this.updateVisibility();
    }, duration);
  }

  updateVisibility() {
    const shouldShow = this.visible || this.tempVisible;
    if (shouldShow) {
      this.element.classList.add('is-visible');
      this.element.classList.remove('is-hidden');
    } else {
      this.element.classList.add('is-hidden');
      this.element.classList.remove('is-visible');
    }
  }

  setAppearance({ fontSize, backgroundAlpha }) {
    if (Number.isFinite(fontSize)) {
      this.fontSize = fontSize;
    }
    if (Number.isFinite(backgroundAlpha)) {
      this.backgroundAlpha = backgroundAlpha;
    }
    this.applyAppearance();
  }

  setStepSeconds(stepSeconds) {
    if (Number.isFinite(stepSeconds)) {
      this.stepSeconds = stepSeconds;
    } else {
      this.stepSeconds = null;
    }
    this.renderText();
  }

  setVolumePercent(percent) {
    if (Number.isFinite(percent)) {
      const clamped = clamp(percent, 1, 400);
      if (Math.abs(clamped - 100) < 0.5) {
        this.volumePercent = null;
      } else {
        this.volumePercent = clamped;
      }
    } else {
      this.volumePercent = null;
    }
    this.renderText();
  }

  setPosition(position) {
    if (!position) {
      return;
    }
    this.position = normalizePositionOption(position);
    this.applyPosition();
  }

  applyAppearance() {
    const size = Number.isFinite(this.fontSize) ? Math.max(this.fontSize, 6) : 14;
    const alpha = Number.isFinite(this.backgroundAlpha)
      ? clamp(this.backgroundAlpha, 0.1, 1)
      : 0.7;
    this.element.style.setProperty('font-size', `${size}px`, 'important');
    this.element.style.setProperty('background-color', `rgba(0, 0, 0, ${alpha})`, 'important');
  }

  applyPosition() {
    const context = this.getPositionContext();
    const { parentRect, videoRect } = context;
    const overlaySize = this.getOverlaySize();
    const videoWidth = videoRect.width || parentRect.width || window.innerWidth;
    const videoHeight = videoRect.height || parentRect.height || window.innerHeight;
    const videoOffsetX = (videoRect.left || 0) - (parentRect.left || 0);
    const videoOffsetY = (videoRect.top || 0) - (parentRect.top || 0);
    let x = this.position.x;
    let y = this.position.y;
    if (Number.isFinite(this.position.ratioX) && videoWidth > 0) {
      x = videoOffsetX + this.position.ratioX * videoWidth;
    }
    if (Number.isFinite(this.position.ratioY) && videoHeight > 0) {
      y = videoOffsetY + this.position.ratioY * videoHeight;
    }
    this.commitPosition({ x, y }, context, overlaySize);
  }

  handlePointerDown(event) {
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === 'function') {
      event.stopImmediatePropagation();
    }
    const pointerId = event.pointerId;
    this.dragState = {
      pointerId,
      startPointer: { x: event.clientX, y: event.clientY },
      startPosition: { ...this.position },
      moved: false
    };
    this.element.classList.add('is-dragging');
    if (typeof this.element.setPointerCapture === 'function') {
      this.element.setPointerCapture(pointerId);
    }
    this.element.addEventListener('pointermove', this.handlePointerMove);
    this.element.addEventListener('pointerup', this.handlePointerUp);
    this.element.addEventListener('pointercancel', this.handlePointerUp);
  }

  handlePointerMove(event) {
    if (!this.dragState) {
      return;
    }
    const dx = event.clientX - this.dragState.startPointer.x;
    const dy = event.clientY - this.dragState.startPointer.y;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
      this.dragState.moved = true;
    }
    const metrics = this.getPositionContext();
    const proposed = {
      x: this.dragState.startPosition.x + dx,
      y: this.dragState.startPosition.y + dy
    };
    this.commitPosition(proposed, metrics, this.getOverlaySize());
  }

  handlePointerUp(event) {
    if (!this.dragState) {
      return;
    }
    if (this.dragState.moved) {
      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === 'function') {
        event.stopImmediatePropagation();
      }
    }
    if (typeof this.element.releasePointerCapture === 'function') {
      this.element.releasePointerCapture(this.dragState.pointerId);
    }
    this.element.classList.remove('is-dragging');
    this.element.removeEventListener('pointermove', this.handlePointerMove);
    this.element.removeEventListener('pointerup', this.handlePointerUp);
    this.element.removeEventListener('pointercancel', this.handlePointerUp);
    this.dragState = null;
    if (typeof this.onPositionChange === 'function') {
      this.onPositionChange({ ...this.position });
    }
  }

  stopDragging() {
    if (!this.dragState) {
      return;
    }
    if (typeof this.element.releasePointerCapture === 'function') {
      this.element.releasePointerCapture(this.dragState.pointerId);
    }
    this.element.classList.remove('is-dragging');
    this.element.removeEventListener('pointermove', this.handlePointerMove);
    this.element.removeEventListener('pointerup', this.handlePointerUp);
    this.element.removeEventListener('pointercancel', this.handlePointerUp);
    this.dragState = null;
  }

  commitPosition(target, context, overlaySize) {
    const metrics = context || this.getPositionContext();
    const overlay = overlaySize || this.getOverlaySize();
    const parentRect = metrics.parentRect;
    const videoRect = metrics.videoRect;
    const videoWidth = videoRect.width || parentRect.width || window.innerWidth;
    const videoHeight = videoRect.height || parentRect.height || window.innerHeight;
    const offsetX = (videoRect.left || 0) - (parentRect.left || 0);
    const offsetY = (videoRect.top || 0) - (parentRect.top || 0);
    const minX = offsetX;
    const minY = offsetY;
    const maxX = offsetX + Math.max(videoWidth - overlay.width, 0);
    const maxY = offsetY + Math.max(videoHeight - overlay.height, 0);
    const clampedX = clamp(target.x ?? minX, minX, maxX);
    const clampedY = clamp(target.y ?? minY, minY, maxY);
    const ratioX =
      videoWidth > 0 ? clamp((clampedX - offsetX) / videoWidth, 0, 1) : this.position.ratioX ?? null;
    const ratioY =
      videoHeight > 0 ? clamp((clampedY - offsetY) / videoHeight, 0, 1) : this.position.ratioY ?? null;
    this.position = { ...this.position, x: clampedX, y: clampedY, ratioX, ratioY };
    this.element.style.left = `${clampedX}px`;
    this.element.style.top = `${clampedY}px`;
    this.lastContainerSize = { width: videoWidth, height: videoHeight };
  }

  getOverlaySize() {
    return {
      width: this.element.offsetWidth || 40,
      height: this.element.offsetHeight || 24
    };
  }

  getPositionContext() {
    const parent = this.element.parentElement || this.video.parentElement || this.video;
    const parentRect = parent?.getBoundingClientRect?.() || defaultRect();
    const videoRect = this.video?.getBoundingClientRect?.() || parentRect || defaultRect();
    return {
      parentRect,
      videoRect
    };
  }

  handleViewportChange() {
    this.applyPosition();
  }

  observeResizeTarget(parent) {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    if (typeof ResizeObserver !== 'function') {
      return;
    }
    const target = this.video instanceof Element ? this.video : parent;
    if (!target) {
      return;
    }
    this.resizeObserver = new ResizeObserver(() => this.applyPosition());
    this.resizeObserver.observe(target);
  }

  applyBaseStyles() {
    const style = this.element.style;
    style.setProperty('position', 'absolute', 'important');
    style.setProperty('top', '0px', 'important');
    style.setProperty('left', '0px', 'important');
    style.setProperty('display', 'inline-flex', 'important');
    style.setProperty('align-items', 'center', 'important');
    style.setProperty('justify-content', 'center', 'important');
    style.setProperty('padding', '4px 8px', 'important');
    style.setProperty('color', '#fff', 'important');
    style.setProperty('border-radius', '4px', 'important');
    style.setProperty('font-family', `system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`, 'important');
    style.setProperty('z-index', '2147483647', 'important');
    style.setProperty('pointer-events', 'auto', 'important');
    style.setProperty('cursor', 'grab', 'important');
    style.setProperty('user-select', 'none', 'important');
    style.setProperty('touch-action', 'none', 'important');
    style.setProperty('transition', 'opacity 0.2s ease-in-out', 'important');
    style.setProperty('line-height', '1', 'important');
    style.setProperty('white-space', 'nowrap', 'important');
    style.setProperty('width', 'max-content', 'important');
    style.setProperty('height', 'max-content', 'important');
    style.setProperty('max-width', '100%', 'important');
    // NB: no max-height. Some players (e.g. YouTube Shorts) host the <video> in a
    // zero-height wrapper; capping the badge to the parent height collapses it to the
    // padding-only ~8px. The badge is a single text line, so it never needs a cap.
    style.setProperty('box-sizing', 'border-box', 'important');
  }

  renderText() {
    const parts = [`${this.currentSpeed.toFixed(1)}×`];
    if (Number.isFinite(this.stepSeconds)) {
      const stepText =
        Math.abs(this.stepSeconds - Math.round(this.stepSeconds)) < 0.001
          ? Math.round(this.stepSeconds).toString()
          : this.stepSeconds.toFixed(1);
      parts.push(stepText);
    }
    if (Number.isFinite(this.volumePercent)) {
      parts.push(`${Math.round(this.volumePercent)}%`);
    }
    this.element.textContent = parts.join('/');
  }

  resolveParentElement() {
    let parent = this.video.parentElement || this.video;
    let computedStyle = parent instanceof HTMLElement ? window.getComputedStyle(parent) : null;
    const videoRect = this.video?.getBoundingClientRect?.();
    const videoHasSize = hasRectSize(videoRect);

    const root = parent?.getRootNode?.();
    if (root instanceof ShadowRoot) {
      const host = root.host;
      if (host) {
        parent = host;
        computedStyle = window.getComputedStyle(parent);
      }
    }

    const parentRect = parent?.getBoundingClientRect?.();
    const hasSize = parentRect?.width > 0 && parentRect?.height > 0;
    if (!videoHasSize || isElementHidden(this.video)) {
      return { parent, computedStyle };
    }
    const offsetParent = this.video instanceof HTMLElement ? this.video.offsetParent : null;
    if (offsetParent instanceof HTMLElement) {
      const offsetRect = offsetParent.getBoundingClientRect();
      const offsetStyle = window.getComputedStyle(offsetParent);
      if (hasRectSize(offsetRect) && !hasNonIdentityScale(offsetStyle)) {
        return { parent: offsetParent, computedStyle: offsetStyle };
      }
    }
    if (hasSize && hasNonIdentityScale(computedStyle)) {
      const visibleParent = findVisibleParent(parent);
      if (visibleParent && visibleParent !== parent) {
        parent = visibleParent;
        computedStyle = window.getComputedStyle(parent);
      }
      return { parent, computedStyle };
    }
    if (!hasSize) {
      const visibleParent = findVisibleParent(parent);
      if (visibleParent && visibleParent !== parent) {
        parent = visibleParent;
        computedStyle = window.getComputedStyle(parent);
      }
    }

    return { parent, computedStyle };
  }
}

function normalizePositionOption(position) {
  if (!position || typeof position !== 'object') {
    return { x: 0, y: 0, ratioX: 0.01, ratioY: 0.05 };
  }
  const x = Number(position.x);
  const y = Number(position.y);
  const ratioX = Number(position.ratioX);
  const ratioY = Number(position.ratioY);
  return {
    x: Number.isFinite(x) ? x : 0,
    y: Number.isFinite(y) ? y : 0,
    ratioX: Number.isFinite(ratioX) ? clamp(ratioX, 0, 1) : 0.01,
    ratioY: Number.isFinite(ratioY) ? clamp(ratioY, 0, 1) : 0.05
  };
}

function defaultRect() {
  return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
}

// True when the page is Chrome's synthesized viewer for a bare media file (e.g.
// navigating straight to a .mp4). Such documents report the media MIME as their
// contentType and hold a single <video>/<audio> laid out against the viewport.
function isStandaloneMediaDocument() {
  const contentType = (document.contentType || '').toLowerCase();
  if (contentType.startsWith('video/') || contentType.startsWith('audio/')) {
    return true;
  }
  const body = document.body;
  if (body && body.children.length === 1) {
    const only = body.firstElementChild;
    if (only && (only.tagName === 'VIDEO' || only.tagName === 'AUDIO')) {
      return true;
    }
  }
  return false;
}

function hasRectSize(rect) {
  if (!rect) {
    return false;
  }
  return rect.width > 0 && rect.height > 0;
}

function findVisibleParent(start) {
  let current = start;
  let steps = 0;
  while (current && current instanceof HTMLElement && steps < 10) {
    const rect = current.getBoundingClientRect();
    const style = window.getComputedStyle(current);
    const hasSize = rect.width > 0 && rect.height > 0;
    const scaled = hasNonIdentityScale(style);
    if (hasSize && !scaled) {
      return current;
    }
    current = current.parentElement;
    steps += 1;
  }
  return start;
}

function isElementHidden(element) {
  if (!(element instanceof Element)) {
    return false;
  }
  const style = window.getComputedStyle(element);
  if (!style) {
    return false;
  }
  return style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse';
}

function hasNonIdentityScale(style) {
  if (!style) {
    return false;
  }
  const transform = style.transform;
  if (!transform || transform === 'none') {
    return false;
  }
  const [, matrix3dValues = null] = /^matrix3d\((.+)\)$/.exec(transform) || [];
  if (matrix3dValues) {
    const values = matrix3dValues.split(',').map((v) => Number.parseFloat(v.trim()));
    if (values.length >= 16) {
      return Math.abs(values[0] - 1) > 0.01 || Math.abs(values[5] - 1) > 0.01;
    }
    return false;
  }
  const [, matrixValues = null] = /^matrix\((.+)\)$/.exec(transform) || [];
  if (!matrixValues) {
    return false;
  }
  const values = matrixValues.split(',').map((v) => Number.parseFloat(v.trim()));
  if (values.length < 4) {
    return false;
  }
  const [a, b, c, d] = values;
  return Math.abs(Math.sqrt(a * a + b * b) - 1) > 0.01 || Math.abs(Math.sqrt(c * c + d * d) - 1) > 0.01;
}