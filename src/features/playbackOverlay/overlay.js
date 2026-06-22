const POSITION_FLAG = 'data-my-browser-assistant-positioned';

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
    this.onPositionChange = onPositionChange;
    this.element = document.createElement('div');
    this.element.className = 'my-browser-assistant-overlay';
    this.applyBaseStyles();
    this.parentOriginalPosition = null;
    this.parentElement = null;
    this.shadowHost = null;
    this.attached = false;
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

    if (style && style.position === 'static') {
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
      ? clampNumber(this.backgroundAlpha, 0.1, 1)
      : 0.7;
    this.element.style.fontSize = `${size}px`;
    this.element.style.backgroundColor = `rgba(0, 0, 0, ${alpha})`;
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
    const clampedX = clampNumber(target.x ?? minX, minX, maxX);
    const clampedY = clampNumber(target.y ?? minY, minY, maxY);
    const ratioX =
      videoWidth > 0 ? clampNumber((clampedX - offsetX) / videoWidth, 0, 1) : this.position.ratioX ?? null;
    const ratioY =
      videoHeight > 0 ? clampNumber((clampedY - offsetY) / videoHeight, 0, 1) : this.position.ratioY ?? null;
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
    style.position = 'absolute';
    style.top = '0px';
    style.left = '0px';
    style.display = 'inline-flex';
    style.alignItems = 'center';
    style.justifyContent = 'center';
    style.padding = '4px 8px';
    style.color = '#fff';
    style.borderRadius = '4px';
    style.fontFamily = `system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
    style.zIndex = '2147483647';
    style.pointerEvents = 'auto';
    style.cursor = 'grab';
    style.userSelect = 'none';
    style.touchAction = 'none';
    style.transition = 'opacity 0.2s ease-in-out';
    style.lineHeight = '1';
    style.whiteSpace = 'nowrap';
  }

  renderText() {
    const speedText = `${this.currentSpeed.toFixed(1)}×`;
    if (Number.isFinite(this.stepSeconds)) {
      const stepText =
        Math.abs(this.stepSeconds - Math.round(this.stepSeconds)) < 0.001
          ? Math.round(this.stepSeconds).toString()
          : this.stepSeconds.toFixed(1);
      this.element.textContent = `${speedText}/${stepText}`;
    } else {
      this.element.textContent = speedText;
    }
  }

  resolveParentElement() {
    let parent = this.video.parentElement || this.video;
    let computedStyle = parent instanceof HTMLElement ? window.getComputedStyle(parent) : null;

    const root = parent?.getRootNode?.();
    if (root instanceof ShadowRoot) {
      const host = root.host;
      if (host) {
        parent = host;
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
    ratioX: Number.isFinite(ratioX) ? clampNumber(ratioX, 0, 1) : 0.01,
    ratioY: Number.isFinite(ratioY) ? clampNumber(ratioY, 0, 1) : 0.05
  };
}

function clampNumber(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function defaultRect() {
  return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
}
