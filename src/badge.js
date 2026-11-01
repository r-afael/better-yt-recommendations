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

  globalThis.BetterYT ??= {};
  globalThis.BetterYT.badge = Object.freeze({ show });
})();
