// Settings shared by the content scripts, the extension's pages and the background.
(() => {
  "use strict";

  const LIMITS = Object.freeze({
    MAX_TEXT_LENGTH: 500, // The longest list of topics, as the options page lets the user type it.
    MIN_THRESHOLD: 0.1, // The ends of the sensitivity slider, which options.js sets from them.
    MAX_THRESHOLD: 0.4,
    MAX_CHANNELS: 50, // Names per channel list.
    MAX_CHANNEL_LENGTH: 100, // Characters per channel name.
    MAX_CHANNEL_TEXT_LENGTH: 2500, // A channel list as typed, which fits in one sync item even at 3 bytes a character.
    ITEM_BUDGET: 8000, // Bytes per synced setting, under Chrome's 8,192 so a save never fails at the edge.
  });

  // What a save rejects with when a value is too large for Chrome sync, as the error's code.
  const QUOTA_ERROR = "better-yt:quota";

  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
  const toSliderStep = (value) => Math.round(value * 100) / 100; // The slider moves in steps of 0.01.
  // Cutting between the two halves of an emoji would leave half of it, so that half goes too.
  const cut = (value, maxLength) => value.slice(0, maxLength).replace(/[\uD800-\uDBFF]$/u, "");
  const collapseSpaces = (value) => String(value ?? "").replaceAll(/\s+/gu, " ").trim();
  // Text as shown, with its spacing collapsed and cut to maxLength. Card text and the channel
  // names typed into a list are cut this one way, so the same long name reads the same in both.
  const clip = (value, maxLength) => cut(collapseSpaces(value), maxLength).trim();

  // Each setting's default and how a stored value is read: a value synced from another computer,
  // or edited by hand, reads as the nearest valid value or as the default.
  const flag = (fallback) => ({ fallback, check: (value) => (typeof value === "boolean" ? value : fallback) });
  const text = (fallback = "") => ({
    fallback,
    check: (value) => (typeof value === "string" ? cut(value, LIMITS.MAX_TEXT_LENGTH) : fallback),
  });
  const range = (fallback, min, max) => ({
    fallback,
    check: (value) => (Number.isFinite(value) ? toSliderStep(clamp(value, min, max)) : fallback),
  });
  // Every read builds a new list, so no two readers share one they could change.
  const strings = (maxCount, maxLength) => ({
    fallback: Object.freeze([]),
    check(value) {
      if (!Array.isArray(value)) return [];
      return value.filter((entry) => typeof entry === "string").map((entry) => cut(entry, maxLength)).slice(0, maxCount);
    },
  });
  const channelList = () => strings(LIMITS.MAX_CHANNELS, LIMITS.MAX_CHANNEL_LENGTH);

  const SCHEMA = Object.freeze({
    enabled: flag(true), // Open Your custom feed when Home opens.
    enforce: flag(false), // Keep Your custom feed selected while on Home.
    hideShorts: flag(false), // Hide Shorts and open Shorts links as regular videos.
    topicFilter: flag(true), // Hide recommendations that don't match the topics. Does nothing until topics are set.
    topics: text(), // Topics the user wants to see, as typed on the options page.
    avoidTopics: text(), // Topics the user wants hidden, as typed on the options page.
    // How close to a topic a video must be to stay visible. 0.25 kept 95% of on-topic
    // and hid 98% of off-topic sidebar videos in testing.
    threshold: range(0.25, LIMITS.MIN_THRESHOLD, LIMITS.MAX_THRESHOLD),
    filterWatch: flag(true), // Filter the recommendations next to or under the video being watched.
    filterHome: flag(true), // Filter Home, which is all recommendations.
    filterSubscriptions: flag(false), // Filter the Subscriptions grid. Off: it shows what the user subscribed to.
    filterSearch: flag(false), // Filter search results. Off: they show what the user asked for.
    allowedChannels: channelList(), // Channels whose videos are never hidden.
    blockedChannels: channelList(), // Channels whose videos are always hidden where the filter works.
  });

  const DEFAULTS = Object.freeze(Object.fromEntries(Object.entries(SCHEMA).map(([key, { fallback }]) => [key, fallback])));

  // A missing value reads as the default. A key this version doesn't know reads as undefined.
  const sanitize = (key, value) => (Object.hasOwn(SCHEMA, key) ? SCHEMA[key].check(value) : undefined);

  const readAll = (stored) => Object.fromEntries(Object.keys(SCHEMA).map((key) => [key, sanitize(key, stored[key])]));

  async function load() {
    try {
      return readAll(await chrome.storage.sync.get(Object.keys(SCHEMA)));
    } catch {
      return readAll({});
    }
  }

  // Names typed in different ways, such as "Chess  Club" and "chess club", compare as the same.
  const nameKey = (name) => collapseSpaces(String(name ?? "").normalize("NFKC")).toLocaleLowerCase();

  // Whether a setting fits in one Chrome sync item, measured the way Chrome measures it.
  const fits = (key, value) => key.length + new TextEncoder().encode(JSON.stringify(value)).length <= LIMITS.ITEM_BUDGET;

  // Writes nothing when any value is too large to sync, so a change never half applies.
  async function save(changes) {
    const key = Object.keys(changes).find((name) => !fits(name, changes[name]));
    if (key) throw Object.assign(new Error(`${key} is too large to sync.`), { code: QUOTA_ERROR, key });
    return chrome.storage.sync.set(changes);
  }

  // Calls listener with only the settings that changed, such as { enforce: true }.
  function subscribe(listener) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync") return;
      const updated = {};
      for (const key of Object.keys(SCHEMA)) {
        if (key in changes) updated[key] = sanitize(key, changes[key].newValue);
      }
      if (Object.keys(updated).length > 0) listener(updated);
    });
  }

  globalThis.BetterYT ??= {};
  globalThis.BetterYT.settings = { DEFAULTS, LIMITS, QUOTA_ERROR, load, save, subscribe, sanitize, fits, nameKey, clip };
})();
