(async () => {
  try {
    const moduleUrl = chrome.runtime.getURL('src/content/main.js');
    const module = await import(moduleUrl);
    if (typeof module.init === 'function') {
      module.init();
    }
  } catch (error) {
    console.error('my_browser_assistant: failed to initialize content module', error);
  }
})();
