// Turns Filter recommendations or Hide Shorts on or off when its keyboard shortcut is pressed,
// and tells the tab it was pressed in what changed.
(() => {
  "use strict";

  const { modelHost, protocol, settings, verdict } = globalThis.BetterYT;
  const { COMMAND_TOGGLE_FILTER, COMMAND_TOGGLE_SHORTS, NOTICE } = protocol;

  // The setting each shortcut turns on or off.
  const KEYS = Object.freeze({ [COMMAND_TOGGLE_FILTER]: "topicFilter", [COMMAND_TOGGLE_SHORTS]: "hideShorts" });

  let queue = Promise.resolve();

  // Like a save on the options page, turning the filter on with topics set starts loading the
  // model. The tab may have no content script, such as a page that isn't YouTube, so a failed
  // notice is ignored.
  async function toggle(key, tabId) {
    const before = await settings.load();
    const changes = { [key]: !before[key] };
    try {
      await settings.save(changes);
    } catch {
      return; // Nothing changed, so nothing is announced.
    }
    if (verdict.startsNeedingModel(before, { ...before, ...changes })) modelHost.preload();
    if (tabId !== undefined) chrome.tabs.sendMessage(tabId, { type: NOTICE, key, value: changes[key] }).catch(() => {});
  }

  // Presses apply one at a time, so two quick presses read each other's result. toggle handles
  // the failures it expects; the catch only keeps later presses working after an unexpected one.
  function run(command, tab) {
    const key = KEYS[command];
    if (key) queue = queue.then(() => toggle(key, tab?.id)).catch((error) => console.error(error));
    return queue;
  }

  globalThis.BetterYT.shortcuts = Object.freeze({ run });
})();
