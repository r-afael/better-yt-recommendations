// Wires the service worker's events to the modules that handle them.
// Every listener is registered here, so this file shows what runs on each event.
importScripts("protocol.js", "settings.js", "topics.js", "verdict.js", "model-host.js");

(() => {
  "use strict";

  const { protocol, modelHost } = globalThis.BetterYT;
  const { MATCH, STATUS, IDLE, OFFSCREEN } = protocol;

  function onMessage(message, _sender, sendResponse) {
    if (message?.target === OFFSCREEN) return false;
    switch (message?.type) {
      case MATCH:
        modelHost.match(message).then(sendResponse);
        return true;
      case STATUS:
        modelHost.storeStatus(message.status);
        return false;
      case IDLE:
        modelHost.release();
        return false;
      default:
        return false;
    }
  }

  function onStorageChanged(changes, area) {
    if (area === "sync") modelHost.onSettingsChanged(changes);
  }

  chrome.runtime.onMessage.addListener(onMessage);
  chrome.storage.onChanged.addListener(onStorageChanged);
})();
