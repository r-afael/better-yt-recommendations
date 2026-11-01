// Settings shared by the content scripts, the extension's pages and the background.
(() => {
  "use strict";

  const LIMITS = Object.freeze({
    MAX_TEXT_LENGTH: 500, // The longest list of topics, as the options page lets the user type it.
    MIN_THRESHOLD: 0.1, // The ends of the sensitivity slider, which options.js sets from them.
    MAX_THRESHOLD: 0.4,
  });

  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
  const toSliderStep = (value) => Math.round(value * 100) / 100; // The slider moves in steps of 0.01.
  // Cutting between the two halves of an emoji would leave half of it, so that half goes too.
  const cut = (value, maxLength) => value.slice(0, maxLength).replace(/[\uD800-\uDBFF]$/u, "");

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

  function save(changes) {
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
  globalThis.BetterYT.settings = { DEFAULTS, LIMITS, load, save, subscribe, sanitize };
})();
