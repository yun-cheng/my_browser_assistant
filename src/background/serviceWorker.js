const PANEL_OPTIONS = {
  path: 'sidepanel/sidepanel.html',
  enabled: true
};

const openWindowIds = new Set();

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
