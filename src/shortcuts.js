// Turns Filter recommendations or Hide Shorts on or off when its keyboard shortcut is pressed,
// and tells the tab it was pressed in what changed.
(() => {
  "use strict";

  const { modelHost, protocol, settings, verdict } = globalThis.BetterYT;
  const { COMMAND_TOGGLE_FILTER, COMMAND_TOGGLE_SHORTS, NOTICE } = protocol;

  // The setting each shortcut turns on or off.
  const KEYS = Object.freeze({ [COMMAND_TOGGLE_FILTER]: "topicFilter", [COMMAND_TOGGLE_SHORTS]: "hideShorts" });

  let queue = Promise.resolve();

  const logFailure = (error) => console.error("Better YT Recommendations: a keyboard shortcut failed.", error);

  // Like a save on the options page, turning the filter on with topics set starts loading the
  // model. The tab may have no content script, such as a page that isn't YouTube, so a failed
  // notice is ignored.
  async function toggle(key, tabId) {
    const before = await settings.load();
    const changes = { [key]: !before[key] };
    await settings.save(changes);
    if (verdict.startsNeedingModel(before, { ...before, ...changes })) modelHost.preload();
    if (tabId !== undefined) chrome.tabs.sendMessage(tabId, { type: NOTICE, key, value: changes[key] }).catch(() => {});
  }

  // Presses apply one at a time, so two quick presses read each other's result. A failure, such as
  // a save Chrome refuses, changes nothing and announces nothing; it is logged here, and later
  // presses keep working.
  function run(command, tab) {
    const key = KEYS[command];
    if (key) queue = queue.then(() => toggle(key, tab?.id)).catch(logFailure);
    return queue;
  }

  globalThis.BetterYT.shortcuts = Object.freeze({ run });
})();
