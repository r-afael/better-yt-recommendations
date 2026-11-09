// Wires the service worker's events to the modules that handle them.
// Every listener is registered here, so this file shows what runs on each event.
importScripts(
  "protocol.js", "settings.js", "topics.js", "verdict.js", "model-host.js",
  "badge.js", "menus.js", "shortcuts.js", "shorts-redirect.js",
);

(() => {
  "use strict";

  const { badge, menus, protocol, modelHost, shortcuts, shortsRedirect, settings } = globalThis.BetterYT;
  const { MATCH, PRELOAD, STATUS, IDLE, HIDDEN_COUNT, OFFSCREEN, OFFSCREEN_PATH } = protocol;

  // Only the offscreen document reports the model's status or that it went idle, so a YouTube
  // page can't close the model or write a status.
  const fromOffscreen = (sender) => sender?.url === chrome.runtime.getURL(OFFSCREEN_PATH);

  // The count is only shown on the badge while the setting is on; re-read when the sync area
  // changes it, so a switch on the options page applies on the next count.
  let showBadge = settings.DEFAULTS.showBadge;
  settings.load().then(({ showBadge: stored }) => { showBadge = stored; });

  function onMessage(message, sender, sendResponse) {
    if (message?.target === OFFSCREEN) return false;
    switch (message?.type) {
      case MATCH:
        modelHost.match(message).then(sendResponse);
        return true;
      case PRELOAD:
        modelHost.preload().then(sendResponse);
        return true;
      case STATUS:
        if (fromOffscreen(sender)) modelHost.onStatus(message.status);
        return false;
      case IDLE:
        if (fromOffscreen(sender)) modelHost.release();
        return false;
      case HIDDEN_COUNT:
        if (showBadge) badge.show(sender?.tab?.id, message.count);
        return false;
      default:
        return false;
    }
  }

  function onStorageChanged(changes, area) {
    if (area !== "sync") return;
    modelHost.onSettingsChanged(changes);
    shortsRedirect.onSettingsChanged(changes);
    if ("showBadge" in changes) {
      showBadge = settings.sanitize("showBadge", changes.showBadge.newValue);
      // The badge sticks on tabs until their next count, so it is cleared here, not in the
      // content script, which may not have one.
      if (!showBadge) badge.clear();
    }
  }

  chrome.runtime.onMessage.addListener(onMessage);
  chrome.storage.onChanged.addListener(onStorageChanged);
  chrome.runtime.onInstalled.addListener(() => {
    menus.create();
    shortsRedirect.reconcile();
  });
  chrome.runtime.onStartup.addListener(shortsRedirect.reconcile);
  chrome.contextMenus.onClicked.addListener(menus.onClicked);
  chrome.commands.onCommand.addListener(shortcuts.run);
})();
