// Settings shared by the content scripts, the popup and the options page.
(() => {
  "use strict";

  const DEFAULTS = Object.freeze({
    enabled: true, // Open Your custom feed when Home opens.
    enforce: false, // Keep Your custom feed selected while on Home.
    hideShorts: false, // Hide Shorts and open Shorts links as regular videos.
    topicFilter: true, // Hide recommendations that don't match the topics. Does nothing until topics are set.
    topics: "", // Topics the user wants to see, as typed on the options page.
    // How close to a topic a video must be to stay visible. 0.25 kept 95% of on-topic
    // and hid 98% of off-topic sidebar videos in testing.
    threshold: 0.25,
  });

  async function load() {
    try {
      return { ...DEFAULTS, ...(await chrome.storage.sync.get(DEFAULTS)) };
    } catch {
      return { ...DEFAULTS };
    }
  }

  function save(changes) {
    return chrome.storage.sync.set(changes);
  }

  // Calls listener with only the settings that changed, such as { enforce: true }.
  function subscribe(listener) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync") return;
      const updated = {};
      for (const key of Object.keys(DEFAULTS)) {
        if (key in changes) updated[key] = changes[key].newValue ?? DEFAULTS[key];
      }
      if (Object.keys(updated).length > 0) listener(updated);
    });
  }

  globalThis.BetterYT ??= {};
  globalThis.BetterYT.settings = { DEFAULTS, load, save, subscribe };
})();
