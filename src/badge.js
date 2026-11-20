// Shows on the toolbar icon how many videos the filter hid on a tab's current page.
(() => {
  "use strict";

  const COLOR = "#606060"; // Grey, since the count is information and not an alarm.
  const ignore = () => {};

  function badgeText(count) {
    if (count === 0) return "";
    return count > 99 ? "99+" : String(count);
  }

  // Sets the color with every write, since Chrome rebuilds the icon's global state from the
  // manifest at startup. Errors are ignored: the tab may have closed.
  function show(tabId, count) {
    if (tabId === undefined || !Number.isInteger(count) || count < 0) return;
    chrome.action.setBadgeText({ tabId, text: badgeText(count) }).catch(ignore);
    chrome.action.setBadgeBackgroundColor({ tabId, color: COLOR }).catch(ignore);
  }

  // Clears the badge of every open tab, so the count disappears when the count is turned off.
  // A count arriving later is ignored by the background, and the content script re-sends it when
  // the count is turned back on, so the text comes back then.
  function clear() {
    chrome.tabs.query({}).then((tabs) => {
      for (const { id } of tabs) chrome.action.setBadgeText({ tabId: id, text: "" }).catch(ignore);
    }).catch(ignore);
  }

  globalThis.BetterYT ??= {};
  globalThis.BetterYT.badge = Object.freeze({ show, clear });
})();
