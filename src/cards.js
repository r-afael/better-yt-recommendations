// Finds, reads and marks the video cards of every list the filter works on.
// All of YouTube's card markup lives in the selectors below.
(() => {
  "use strict";

  // Sponsored slots, Shorts shelves and other shelves hold cards too, but aren't recommendations.
  const EXCLUDED = [
    "ytd-ad-slot-renderer",
    "ytd-promoted-sparkles-web-renderer",
    "ytd-reel-shelf-renderer",
    "grid-shelf-view-model",
    "ytd-horizontal-card-list-renderer",
    "ytd-rich-section-renderer",
    "ytd-rich-item-renderer:has(ytd-ad-slot-renderer)",
  ].join(", ");

  const SURFACES = Object.freeze({
    watch: Object.freeze({
      id: "watch",
      setting: "filterWatch",
      paths: ["/watch"],
      // YouTube moves the list under the video in narrow windows, so it isn't looked up by column.
      container: "ytd-watch-flexy ytd-watch-next-secondary-results-renderer",
      items: "yt-lockup-view-model, ytd-compact-video-renderer",
    }),
    home: Object.freeze({
      id: "home",
      setting: "filterHome",
      paths: ["/", "/feed/recommended"],
      container: 'ytd-browse[page-subtype="home"] ytd-rich-grid-renderer > #contents',
      items: "ytd-rich-item-renderer",
    }),
    subscriptions: Object.freeze({
      id: "subscriptions",
      setting: "filterSubscriptions",
      paths: ["/feed/subscriptions"],
      container: 'ytd-browse[page-subtype="subscriptions"] ytd-rich-grid-renderer > #contents',
      items: "ytd-rich-item-renderer",
    }),
    search: Object.freeze({
      id: "search",
      setting: "filterSearch",
      paths: ["/results"],
      container: "ytd-search ytd-section-list-renderer > #contents",
      items: "ytd-video-renderer, yt-lockup-view-model",
    }),
  });

  const ID_HOST = "div.ytLockupViewModelHost";
  const ID_CLASS_PREFIX = "content-id-";
  const WATCH_LINK = 'a[href*="/watch?v="]';
  // The readers below are in order of preference, tried one by one.
  // h3[title] comes last because a search result's chapter headings are h3[title] too.
  const TITLE_ATTRIBUTE_HOLDERS = ["a#video-title-link[title]", "#video-title[title]", "h3[title]"];
  // Current, older BEM and legacy markup.
  const TITLE_TEXT = ["a.ytLockupMetadataViewModelTitle", ".yt-lockup-metadata-view-model__title", "#video-title"];
  // textContent reads through the channel link inside #text. This order reads the watch sidebar
  // correctly, so a surface that needs another gives itself a `channel` list instead.
  const CHANNEL_TEXT = [
    ".ytContentMetadataViewModelMetadataText",
    ".yt-content-metadata-view-model__metadata-text",
    "ytd-channel-name #text",
  ];
  const HIDDEN_ATTRIBUTE = "data-better-yt-hidden";
  const REASON_ATTRIBUTE = "data-better-yt-reason";
  const MAX_TITLE_LENGTH = 200;
  const MAX_CHANNEL_LENGTH = 100;

  const clean = (text, maxLength) => (text ?? "").replaceAll(/\s+/gu, " ").trim().slice(0, maxLength).trim();

  // Returns the surface a page shows, such as SURFACES.home for "/", or null for other pages.
  function surfaceFor(pathname) {
    return Object.values(SURFACES).find((surface) => surface.paths.includes(pathname)) ?? null;
  }

  function container(surface, root = document) {
    return root.querySelector(surface.container);
  }

  function findItems(surface, root = document) {
    const list = container(surface, root);
    if (!list) return [];
    // closest() checks the item itself too, so an ad grid cell is left out.
    return [...list.querySelectorAll(surface.items)].filter((item) => !item.closest(EXCLUDED));
  }

  function firstMatch(item, selectors) {
    for (const selector of selectors) {
      const element = item.querySelector(selector);
      if (element) return element;
    }
    return null;
  }

  // The lockup id class, else the v= parameter of the watch link that ytd-video-renderer and older
  // compact cards carry. A playlist or mix lockup's class holds its own id, so it's judged by its
  // title like a video without sharing a score with the first video it links to.
  function readId(item) {
    const host = item.querySelector(ID_HOST);
    const idClass = host && [...host.classList].find((name) => name.startsWith(ID_CLASS_PREFIX));
    if (idClass) return idClass.slice(ID_CLASS_PREFIX.length);
    const link = item.querySelector(WATCH_LINK);
    return link ? new URL(link.href, location.href).searchParams.get("v") : null;
  }

  function readTitle(item) {
    const title = firstMatch(item, TITLE_ATTRIBUTE_HOLDERS)?.getAttribute("title");
    return clean(title || firstMatch(item, TITLE_TEXT)?.textContent, MAX_TITLE_LENGTH);
  }

  // Returns the video a card shows, or null when the card isn't a readable video.
  // A surface with its own channel list reads the channel with it; without a surface, CHANNEL_TEXT does.
  function readVideo(item, surface) {
    const id = readId(item);
    const title = readTitle(item);
    if (!id || !title) return null;
    const channel = clean(firstMatch(item, surface?.channel ?? CHANNEL_TEXT)?.textContent, MAX_CHANNEL_LENGTH);
    return { id, title, channel };
  }

  // The id tells a hidden card apart from the same element recycled for another video.
  function hide(item, id, reason) {
    item.setAttribute(HIDDEN_ATTRIBUTE, id);
    item.setAttribute(REASON_ATTRIBUTE, reason);
  }

  function unhide(item) {
    item.removeAttribute(HIDDEN_ATTRIBUTE);
    item.removeAttribute(REASON_ATTRIBUTE);
  }

  // Returns the id of the video a card was hidden for, or null when it isn't hidden.
  function hiddenId(item) {
    return item.getAttribute(HIDDEN_ATTRIBUTE);
  }

  // Returns why a card was hidden, such as "off-topic", or null when it isn't hidden.
  function hiddenReason(item) {
    return item.getAttribute(REASON_ATTRIBUTE);
  }

  function unhideAll(root = document) {
    for (const item of root.querySelectorAll(`[${HIDDEN_ATTRIBUTE}]`)) unhide(item);
  }

  // Counts the hidden cards in a surface's list, or 0 when the page has no list yet.
  function hiddenCount(surface, root = document) {
    return container(surface, root)?.querySelectorAll(`[${HIDDEN_ATTRIBUTE}]`).length ?? 0;
  }

  globalThis.BetterYT ??= {};
  globalThis.BetterYT.cards = Object.freeze({
    SURFACES,
    EXCLUDED,
    surfaceFor,
    container,
    findItems,
    readVideo,
    hide,
    unhide,
    hiddenId,
    hiddenReason,
    unhideAll,
    hiddenCount,
  });
})();
