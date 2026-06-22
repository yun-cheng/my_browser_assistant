import { getSettings, subscribeToSettings } from '../lib/settings.js';
import { VideoSpeedFeature } from '../features/videoSpeed/index.js';

let featureInstance = null;
let unsubscribe = null;
let initialized = false;

async function boot() {
  if (initialized) {
    return;
  }
  initialized = true;
  const settings = await getSettings();
  featureInstance = new VideoSpeedFeature(settings);
  featureInstance.init();
  unsubscribe = subscribeToSettings((next) => featureInstance.updateSettings(next));
}

export function init() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    if (unsubscribe) {
      unsubscribe();
    }
    if (featureInstance) {
      featureInstance.dispose();
    }
  });
}
