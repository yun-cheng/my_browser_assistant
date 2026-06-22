const STYLE_ID = 'my-browser-assistant-playback-overlay-styles';

export function ensurePlaybackOverlayStyles() {
  if (document.getElementById(STYLE_ID)) {
    return;
  }

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .my-browser-assistant-overlay {
      position: absolute;
      top: 0px;
      left: 0px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 4px 8px;
      background: rgba(0, 0, 0, 0.5);
      color: #fff;
      font-size: 18px;
      border-radius: 4px;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      z-index: 2147483647;
      pointer-events: auto;
      cursor: grab;
      user-select: none;
      touch-action: none;
      transition: opacity 0.2s ease-in-out;
      opacity: 0;
      line-height: 1;
      white-space: nowrap;
    }

    .my-browser-assistant-overlay.is-visible {
      opacity: 1;
    }

    .my-browser-assistant-overlay.is-hidden {
      opacity: 0;
    }

    .my-browser-assistant-overlay.is-dragging {
      cursor: grabbing;
    }
  `;

  document.head.appendChild(style);
}
