const STYLE_ID = 'my-ai-assistant-video-speed-styles';

export function ensureVideoSpeedStyles() {
  if (document.getElementById(STYLE_ID)) {
    return;
  }

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .my-ai-assistant-overlay {
      position: absolute;
      top: 12px;
      left: 12px;
      padding: 4px 8px;
      background: rgba(0, 0, 0, 0.7);
      color: #fff;
      font-size: 14px;
      border-radius: 4px;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      z-index: 2147483647;
      pointer-events: auto;
      cursor: grab;
      user-select: none;
      touch-action: none;
      transition: opacity 0.2s ease-in-out;
      opacity: 0;
    }

    .my-ai-assistant-overlay.is-visible {
      opacity: 1;
    }

    .my-ai-assistant-overlay.is-hidden {
      opacity: 0;
    }

    .my-ai-assistant-overlay.is-dragging {
      cursor: grabbing;
    }
  `;

  document.head.appendChild(style);
}
