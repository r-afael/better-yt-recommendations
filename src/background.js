// Wires the service worker's events to the modules that handle them.
// Every listener is registered here, so this file shows what runs on each event.
importScripts(
  "protocol.js", "settings.js", "topics.js", "verdict.js", "model-host.js",
  "badge.js", "menus.js", "shortcuts.js", "shorts-redirect.js",
);

(() => {
  "use strict";

  const { badge, menus, protocol, modelHost, shortcuts, shortsRedirect } = globalThis.BetterYT;
  const { MATCH, PRELOAD, STATUS, IDLE, HIDDEN_COUNT, OFFSCREEN, OFFSCREEN_PATH } = protocol;

  // Only the offscreen document reports the model's status or that it went idle, so a YouTube
  // page can't close the model or write a status.
  const fromOffscreen = (sender) => sender?.url === chrome.runtime.getURL(OFFSCREEN_PATH);

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
        badge.show(sender?.tab?.id, message.count);
        return false;
      default:
        return false;
    }
  }

  function onStorageChanged(changes, area) {
    if (area !== "sync") return;
    modelHost.onSettingsChanged(changes);
    shortsRedirect.onSettingsChanged(changes);
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
