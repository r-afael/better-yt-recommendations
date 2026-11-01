// Finds, reads and marks the video cards of every list the filter works on.
// All of YouTube's card markup lives in the selectors below.
(() => {
  "use strict";

  const { clip, LIMITS } = globalThis.BetterYT.settings;

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

  // Every surface's items, for finding the card under a right-click on any page.
  const ALL_ITEMS = Object.values(SURFACES).map((surface) => surface.items).join(", ");

  const ID_HOST = "div.ytLockupViewModelHost";
  const ID_CLASS_PREFIX = "content-id-";
  const WATCH_LINK = 'a[href*="/watch?v="]';
  // The readers below are in order of preference, tried one by one.
  // h3[title] comes last because a search result's chapter headings are h3[title] too.
  const TITLE_ATTRIBUTE_HOLDERS = ["a#video-title-link[title]", "#video-title[title]", "h3[title]"];
  // Current, older BEM and legacy markup.
  const TITLE_TEXT = ["a.ytLockupMetadataViewModelTitle", ".yt-lockup-metadata-view-model__title", "#video-title"];
  // textContent reads through the channel link inside #text. This order reads the watch sidebar correctly.
  const CHANNEL_TEXT = [
    ".ytContentMetadataViewModelMetadataText",
    ".yt-content-metadata-view-model__metadata-text",
    "ytd-channel-name #text",
  ];
  // Attribute changes that can mean a card shows another video.
  const CARD_ATTRIBUTES = new Set(["href", "title"]);
  // Attributes YouTube changes when it reuses an item for another video, for a list's observer.
  const WATCHED_ATTRIBUTES = Object.freeze(["class", ...CARD_ATTRIBUTES]);
  const HIDDEN_ATTRIBUTE = "data-better-yt-hidden";
  const REASON_ATTRIBUTE = "data-better-yt-reason";

  // Returns the surface a page shows, such as SURFACES.home for "/", or null for other pages.
  function surfaceFor(pathname) {
    return Object.values(SURFACES).find((surface) => surface.paths.includes(pathname)) ?? null;
  }

  // Whether the filter is switched on for a surface's page in the given settings.
  const filtersOn = (values, surface) => Boolean(values.topicFilter && surface && values[surface.setting]);

  function container(surface, root = document) {
    return root.querySelector(surface.container);
  }

  function findItems(surface, root = document) {
    const list = container(surface, root);
    if (!list) return [];
    // closest() checks the item itself too, so an ad grid cell is left out.
    return [...list.querySelectorAll(surface.items)].filter((item) => !item.closest(EXCLUDED));
  }

  // Whether a mutation record can change what a list's cards show, so the list needs a rescan.
  function isRelevant({ type, attributeName, target }) {
    if (type !== "attributes" || CARD_ATTRIBUTES.has(attributeName)) return true;
    // YouTube writes a recycled card's id into the lockup host's class; other class changes are
    // hovering, image loads and overlays.
    return attributeName === "class" && target.matches(ID_HOST);
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
    return clip(title || firstMatch(item, TITLE_TEXT)?.textContent, LIMITS.MAX_TITLE_LENGTH);
  }

  // Returns the video a card shows, or null when the card isn't a readable video.
  function readVideo(item) {
    const id = readId(item);
    const title = readTitle(item);
    if (!id || !title) return null;
    const channel = clip(firstMatch(item, CHANNEL_TEXT)?.textContent, LIMITS.MAX_CHANNEL_LENGTH);
    return { id, title, channel };
  }

  // Returns the card an element is in, on any page, or null. A card in a sponsored slot or a shelf
  // is still a card, so an ad's channel can be listed too.
  function itemAt(target) {
    return target?.closest?.(ALL_ITEMS) ?? null;
  }

  // Where a link goes: "/watch?v=<id>" for a video link, ignoring its other parameters, and the
  // path for other links, such as "/@freecodecamp". Null for a missing or unreadable link.
  function destinationOf(href) {
    let url;
    try {
      url = new URL(href);
    } catch {
      return null;
    }
    if (url.pathname !== "/watch") return url.pathname;
    const id = url.searchParams.get("v");
    return id ? `/watch?v=${id}` : null;
  }

  // Whether any link in a card goes to a destination, such as the same video or channel.
  function linksTo(item, destination) {
    return [...item.querySelectorAll("a[href]")].some((link) => destinationOf(link.href) === destination);
  }

  // Returns the card a right-clicked link belongs to, or null. The card under the last right-click
  // wins when it holds that link. Otherwise, such as when the click landed on Home's preview
  // player outside the card, the card showing that video wins over a mix or playlist that starts
  // with it, and any other link goes to the first card that holds it.
  function itemForLink(linkUrl, last) {
    const destination = destinationOf(linkUrl);
    if (destination === null) return null;
    if (last?.isConnected && linksTo(last, destination)) return last;
    const linking = [...document.querySelectorAll(ALL_ITEMS)].filter((item) => linksTo(item, destination));
    return linking.find((item) => destination === `/watch?v=${readId(item)}`) ?? linking[0] ?? null;
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
    WATCHED_ATTRIBUTES,
    surfaceFor,
    filtersOn,
    container,
    findItems,
    isRelevant,
    itemAt,
    itemForLink,
    readVideo,
    hide,
    unhide,
    hiddenId,
    hiddenReason,
    unhideAll,
    hiddenCount,
  });
})();
