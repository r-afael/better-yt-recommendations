// Reads the channel lists and says whether a channel's videos are always shown or always hidden.
// Pure logic, shared by the content script and the options page. Channels are known by the name
// YouTube shows, compared ignoring case and spacing.
(() => {
  "use strict";

  const { protocol, settings } = globalThis.BetterYT;
  const { LIMITS } = settings;

  // The settings that hold the lists, named in protocol.js.
  const [ALLOWED, BLOCKED] = protocol.CHANNEL_LISTS;

  const key = settings.nameKey;
  // A name with its spacing collapsed, cut the way a card's channel is read.
  const clean = (name) => settings.clip(name, LIMITS.MAX_CHANNEL_LENGTH);
  // Each name moves between the two lists, so a name typed into one leaves the other.
  const otherList = (list) => (list === ALLOWED ? BLOCKED : ALLOWED);
  const without = (list, keys) => list.filter((name) => !keys.has(key(name)));

  // Every name typed, one per line, without blank lines or names typed twice.
  function uniqueNames(text) {
    const unique = new Map();
    for (const name of text.split("\n").map(clean)) {
      const nameKey = key(name);
      if (name !== "" && !unique.has(nameKey)) unique.set(nameKey, name);
    }
    return [...unique.values()];
  }

  // The list a typed text saves: its first names, up to the limit.
  const parse = (text) => uniqueNames(text).slice(0, LIMITS.MAX_CHANNELS);

  // How many names a typed text holds, including the ones past the limit.
  const countNames = (text) => uniqueNames(text).length;

  // Both lists once a channel is added to one of them, or null when that list is full. A name
  // the list already holds keeps the list as it is, so adding it again still succeeds.
  function add(values, list, name) {
    const nameKey = key(name);
    const other = otherList(list);
    const changes = { [other]: without(values[other], new Set([nameKey])) };
    const target = values[list];
    if (target.some((entry) => key(entry) === nameKey)) return { ...changes, [list]: target };
    if (target.length >= LIMITS.MAX_CHANNELS) return null;
    return { ...changes, [list]: [...target, clean(name)] };
  }

  // Both lists once one of them is replaced by the names typed into it.
  function reconcile(values, list, typed) {
    const other = otherList(list);
    return { [list]: typed, [other]: without(values[other], new Set(typed.map(key))) };
  }

  // lookup(channel) says "allow", "block" or null for a channel that is in neither list. A name in
  // both, which only two computers saving at once can cause, is allowed: showing a video the user
  // also blocked does less harm than hiding one they said never to hide.
  function createIndex({ allowedChannels, blockedChannels }) {
    const keysOf = (list) => new Set(list.map(key).filter((channelKey) => channelKey !== ""));
    const allowed = keysOf(allowedChannels);
    const blocked = keysOf(blockedChannels);
    function lookup(channel) {
      const channelKey = key(channel);
      if (allowed.has(channelKey)) return "allow";
      return blocked.has(channelKey) ? "block" : null;
    }
    return Object.freeze({ lookup, hasBlocked: blocked.size > 0 });
  }

  globalThis.BetterYT.channels = Object.freeze({ parse, countNames, add, reconcile, createIndex });
})();
