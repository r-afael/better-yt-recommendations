// Settings shared by the content scripts, the extension's pages and the background.
(() => {
  "use strict";

  const LIMITS = Object.freeze({
    MAX_TEXT_LENGTH: 500, // The longest list of topics, as the options page lets the user type it.
    MAX_TITLE_LENGTH: 200, // Characters of a video title sent to the model, about twice YouTube's 100-character limit.
    MIN_THRESHOLD: 0.1, // The ends of both match sliders, which options.js sets from them.
    MAX_THRESHOLD: 0.4,
    MAX_CHANNELS: 50, // Names per channel list.
    MAX_CHANNEL_LENGTH: 100, // Characters per channel name.
    MAX_CHANNEL_TEXT_LENGTH: 2500, // A channel list as typed, which fits in one sync item even at 3 bytes a character.
    MAX_PROFILES: 8, // Saved topic profiles. Long topics fit fewer, since they all share one sync item.
    MAX_PROFILE_NAME_LENGTH: 30, // Characters per profile name.
    ITEM_BUDGET: 8000, // Bytes per synced setting, under Chrome's 8,192 so a save never fails at the edge.
  });

  // What a save rejects with when a value is too large for Chrome sync, as the error's code.
  const QUOTA_ERROR = "better-yt:quota";

  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
  const DECIMALS = 2; // The sliders move in steps of 0.01.
  const STEPS = 10 ** DECIMALS;
  const toSliderStep = (value) => Math.round(value * STEPS) / STEPS;
  // The highest slider step at or below a score, so a score shown as 0.58 meets a line of 0.58
  // and not one of 0.59. Rounding lands on that step or the one above, even where value * 100
  // falls just short of a whole number, as 0.58 * 100 does. With more decimals, the steps are
  // finer, and a score still shows at or below itself.
  function stepReached(value, decimals = DECIMALS) {
    const steps = 10 ** decimals;
    const step = Math.round(value * steps);
    return (step / steps <= value ? step : step - 1) / steps;
  }
  // Cutting between the two halves of an emoji would leave half of it, so that half goes too.
  const cut = (value, maxLength) => value.slice(0, maxLength).replace(/[\uD800-\uDBFF]$/u, "");
  const collapseSpaces = (value) => String(value ?? "").replaceAll(/\s+/gu, " ").trim();
  // Text as shown, with its spacing collapsed and cut to maxLength. Card text and the channel
  // names typed into a list are cut this one way, so the same long name reads the same in both.
  const clip = (value, maxLength) => cut(collapseSpaces(value), maxLength).trim();

  // Each setting's default and how a stored value is read: a value synced from another computer,
  // or edited by hand, reads as the nearest valid value or as the default.
  const flag = (fallback) => ({ fallback, check: (value) => (typeof value === "boolean" ? value : fallback) });
  const text = (fallback = "", maxLength = LIMITS.MAX_TEXT_LENGTH) => ({
    fallback,
    check: (value) => (typeof value === "string" ? cut(value, maxLength) : fallback),
  });
  const range = (fallback, min, max) => ({
    fallback,
    check: (value) => (Number.isFinite(value) ? toSliderStep(clamp(value, min, max)) : fallback),
  });
  // A list of entries that pass isEntry, each read with readEntry. Every read builds a new list,
  // so no two readers share one they could change.
  const list = (maxCount, isEntry, readEntry) => ({
    fallback: Object.freeze([]),
    check: (value) =>
      Array.isArray(value)
        ? value
            .filter((entry) => isEntry(entry))
            .map((entry) => readEntry(entry))
            .slice(0, maxCount)
        : [],
  });
  const channelList = () =>
    list(LIMITS.MAX_CHANNELS, (entry) => typeof entry === "string", (entry) => cut(entry, LIMITS.MAX_CHANNEL_LENGTH));
  // The settings a profile keeps a copy of, and switching to it brings back.
  const PROFILE_SETTINGS = Object.freeze(["topics", "avoidTopics", "threshold", "avoidThreshold"]);
  // Those of them that values holds. Profiles saved before they kept the sliders hold only the
  // topics, and switching to one leaves the sliders as they are.
  const profileCopy = (values) =>
    Object.fromEntries(PROFILE_SETTINGS.filter((key) => Object.hasOwn(values, key)).map((key) => [key, values[key]]));
  // A profile the popup can list: a name to show once cut to its length, and the settings it
  // switches to, each read the way the setting itself is (by sanitize, below).
  const isProfile = (value) =>
    typeof value?.name === "string" && cut(value.name, LIMITS.MAX_PROFILE_NAME_LENGTH).trim() !== "";
  const readProfile = (profile) => ({
    name: cut(profile.name, LIMITS.MAX_PROFILE_NAME_LENGTH),
    ...Object.fromEntries(Object.entries(profileCopy(profile)).map(([key, value]) => [key, sanitize(key, value)])),
  });
  const profileList = () => list(LIMITS.MAX_PROFILES, isProfile, readProfile);

  const SCHEMA = Object.freeze({
    enabled: flag(true), // Open Your custom feed when Home opens.
    enforce: flag(false), // Keep Your custom feed selected while on Home.
    hideShorts: flag(false), // Hide Shorts and open Shorts links as regular videos.
    topicFilter: flag(true), // Hide recommendations that don't match the topics. Does nothing until topics are set.
    topics: text(), // Topics the user wants to see, as typed on the options page.
    avoidTopics: text(), // Topics the user wants hidden, as typed on the options page.
    // How well a video must match a wanted topic to stay visible. 0.25 kept 95% of on-topic
    // and hid 98% of off-topic sidebar videos in testing.
    threshold: range(0.25, LIMITS.MIN_THRESHOLD, LIMITS.MAX_THRESHOLD),
    // How well a video must match a topic to avoid to be hidden. Against gaming, celebrity gossip
    // and true crime, 0.24 hid 16 of 20 titles that clearly belong to them and none of 9 unrelated
    // ones, and spared 5 of 13 near misses, such as chess titles; game programming tutorials
    // still matched gaming above it. Lines from 0.21 to 0.25 did about as well on these 42
    // titles: clear matches (0.12 to 0.46) and near misses (0.11 to 0.47) overlap, so no line
    // separates them well. This was measured with topics to avoid only, where the line alone
    // decides; next to wanted topics, a video is also kept when it matches them at least as much.
    avoidThreshold: range(0.24, LIMITS.MIN_THRESHOLD, LIMITS.MAX_THRESHOLD),
    filterWatch: flag(true), // Filter the recommendations next to or under the video being watched.
    filterHome: flag(true), // Filter Home, which is all recommendations.
    filterSubscriptions: flag(false), // Filter the Subscriptions grid. Off: it shows what the user subscribed to.
    filterSearch: flag(false), // Filter search results. Off: they show what the user asked for.
    allowedChannels: channelList(), // Channels whose videos are never hidden.
    blockedChannels: channelList(), // Channels whose videos are always hidden where the filter works.
    profiles: profileList(), // Named copies of the topics and sliders, which the popup switches between.
    // The selected profile, which edits to the topics and sliders update, or "" for none.
    activeProfile: text("", LIMITS.MAX_PROFILE_NAME_LENGTH),
  });

  const DEFAULTS = Object.freeze(Object.fromEntries(Object.entries(SCHEMA).map(([key, { fallback }]) => [key, fallback])));

  // A missing value reads as the default. A key this version doesn't know reads as undefined.
  const sanitize = (key, value) => (Object.hasOwn(SCHEMA, key) ? SCHEMA[key].check(value) : undefined);

  const readAll = (stored) => Object.fromEntries(Object.keys(SCHEMA).map((key) => [key, sanitize(key, stored[key])]));

  async function readStored() {
    try {
      return readAll(await chrome.storage.sync.get(Object.keys(SCHEMA)));
    } catch {
      return readAll({});
    }
  }

  // Names typed in different ways, such as "Chess  Club" and "chess club", compare as the same.
  const nameKey = (name) => collapseSpaces(String(name ?? "").normalize("NFKC")).toLocaleLowerCase();
  const sameName = (a, b) => nameKey(a) === nameKey(b);

  // A selected profile that another computer deleted reads as no profile.
  async function load() {
    const values = await readStored();
    if (!values.profiles.some((profile) => sameName(profile.name, values.activeProfile))) values.activeProfile = "";
    return values;
  }

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
  globalThis.BetterYT.settings = {
    DEFAULTS,
    LIMITS,
    PROFILE_SETTINGS,
    QUOTA_ERROR,
    DECIMALS,
    load,
    save,
    subscribe,
    nameKey,
    sameName,
    clip,
    stepReached,
    profileCopy,
  };
})();
