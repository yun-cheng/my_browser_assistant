import { KEY_RELAY_MESSAGE } from '../lib/constants.js';

const PANEL_OPTIONS = {
  path: 'sidepanel/sidepanel.html',
  enabled: true
};

const openWindowIds = new Set();

// Rebroadcast a shortcut keypress from the frame that received it (usually the top
// frame, which has focus but no <video>) to every frame in the same tab, so the frame
// that owns the video — e.g. a cross-origin YouTube embed — can act on it.
chrome.runtime.onMessage.addListener((message, sender) => {
  if (!message || message.type !== KEY_RELAY_MESSAGE) {
    return;
  }
  const tabId = sender?.tab?.id;
  if (typeof tabId !== 'number') {
    return;
  }
  chrome.tabs.sendMessage(tabId, message).catch(() => {
    // No receiving frames (e.g. tab closed mid-relay) — safe to ignore.
  });
});

async function configureSidePanel(context) {
  try {
    await chrome.sidePanel.setOptions(PANEL_OPTIONS);
    if (chrome.sidePanel?.setPanelBehavior) {
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
    }
  } catch (error) {
    console.error(`my_browser_assistant: failed to initialize side panel on ${context}`, error);
  }
}

chrome.runtime.onInstalled.addListener(() => configureSidePanel('install'));
chrome.runtime.onStartup.addListener(() => configureSidePanel('startup'));

chrome.action.onClicked.addListener((tab) => {
  if (!tab || typeof tab.windowId !== 'number') {
    return;
  }
  const { windowId } = tab;
  if (openWindowIds.has(windowId)) {
    closePanel(windowId);
    return;
  }

  openPanel(windowId);
});

async function openPanel(windowId) {
  try {
    await chrome.sidePanel.open({ windowId });
    openWindowIds.add(windowId);
  } catch (error) {
    console.error('my_browser_assistant: failed to open side panel', error);
  }
}

async function closePanel(windowId) {
  try {
    await chrome.sidePanel.close({ windowId });
    openWindowIds.delete(windowId);
  } catch (error) {
    console.error('my_browser_assistant: failed to close side panel', error);
  }
}

if (chrome.sidePanel?.onOpen) {
  chrome.sidePanel.onOpen.addListener(({ windowId }) => {
    if (typeof windowId === 'number') {
      openWindowIds.add(windowId);
    }
  });
}

if (chrome.sidePanel?.onClose) {
  chrome.sidePanel.onClose.addListener(({ windowId }) => {
    if (typeof windowId === 'number') {
      openWindowIds.delete(windowId);
    }
  });
}
