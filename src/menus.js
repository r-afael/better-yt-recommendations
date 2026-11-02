// Adds Never hide this channel and Always hide this channel to the right-click menu of video links
// on YouTube, and asks the tab where one was picked to add the video's channel to that list.
(() => {
  "use strict";

  const { CHANNEL_LISTS, LIST_CHANNEL, MENU_ALLOW_CHANNEL, MENU_BLOCK_CHANNEL } = globalThis.BetterYT.protocol;
  const [ALLOWED, BLOCKED] = CHANNEL_LISTS;

  const YOUTUBE_PAGES = Object.freeze(["https://www.youtube.com/*", "https://youtube.com/*"]);
  // A card's thumbnail and title link to its video. On Home and in search results, its channel
  // name and avatar link to the channel. Shorts are left out: their cards can't be read.
  const CARD_LINKS = Object.freeze([
    "https://*.youtube.com/watch*",
    "https://*.youtube.com/@*",
    "https://*.youtube.com/channel/*",
  ]);
  const ITEMS = Object.freeze([
    { id: MENU_ALLOW_CHANNEL, list: ALLOWED, title: "menuAllowChannel" },
    { id: MENU_BLOCK_CHANNEL, list: BLOCKED, title: "menuBlockChannel" },
  ]);

  // Reading the error tells Chrome it was handled, so it isn't logged as unchecked.
  const checkLastError = () => chrome.runtime.lastError;

  function propertiesOf({ id, title }) {
    return {
      id,
      title: chrome.i18n.getMessage(title),
      contexts: ["link"],
      documentUrlPatterns: [...YOUTUBE_PAGES],
      targetUrlPatterns: [...CARD_LINKS],
    };
  }

  // Chrome keeps the entries across updates, so the previous version's go first. The callback
  // forms work on every Chrome version the extension supports.
  function create() {
    chrome.contextMenus.removeAll(() => {
      checkLastError();
      for (const item of ITEMS) chrome.contextMenus.create(propertiesOf(item), checkLastError);
    });
  }

  // The tab may have closed or have no content script yet, so errors are ignored.
  function onClicked(info, tab) {
    const item = ITEMS.find(({ id }) => id === info.menuItemId);
    if (!item || tab?.id === undefined) return;
    const message = { type: LIST_CHANNEL, list: item.list, linkUrl: info.linkUrl };
    chrome.tabs.sendMessage(tab.id, message, { frameId: info.frameId ?? 0 }).catch(() => {});
  }

  globalThis.BetterYT.menus = Object.freeze({ create, onClicked });
})();
