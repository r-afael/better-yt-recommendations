// Messages between the content script, the extension's pages (the popup and the options page),
// the background service worker and the offscreen document that runs the topic model.
globalThis.BetterYT ??= {};
globalThis.BetterYT.protocol = Object.freeze({
  // Content script or options page to background, which forwards it to the offscreen document:
  // { type, topics: string[], avoidTopics: string[], videos: [{ id, title, channel }] }
  // Answered with { scores: { [id]: { want, avoid } } }, each video's highest similarity from -1
  // to 1 to a wanted topic and to a topic to avoid, null when that list is empty,
  // or with { error: string }.
  MATCH: "better-yt:match",
  // The popup or the options page to background, which forwards it to the offscreen document:
  // { type }, to load the model right away. Answered with { ok: true } as soon as loading has
  // started or the model is already loaded, or with { error: string } when the document can't
  // be reached. Progress keeps arriving through STATUS.
  PRELOAD: "better-yt:preload",
  // Offscreen document to background: { type, status: { state, progress? } },
  // where state is one of MODEL_STATES and progress runs from 0 to 1 while loading.
  // The background stores it only while the document is open.
  STATUS: "better-yt:status",
  // Offscreen document to background: nothing has been matched for a while,
  // so the document can close and free the model's memory.
  IDLE: "better-yt:idle",
  // Content script to background: { type, count }, how many videos the filter hides on the
  // tab's current page, 0 when it stops or the page goes away. The background shows it on the
  // tab's badge and ignores it without a tab or a non-negative integer count. No answer.
  HIDDEN_COUNT: "better-yt:hidden-count",
  // Background to the tab and frame where a right-click menu entry was picked:
  // { type, list, linkUrl }, where list is one of CHANNEL_LISTS and linkUrl is the link the menu
  // opened on, if any. The content script saves the channel of the card that link belongs to and
  // says so on the page. No answer.
  LIST_CHANNEL: "better-yt:list-channel",
  // Background to the tab where a keyboard shortcut was pressed, once the setting it turned on or
  // off is saved: { type, key, value }, where key is "topicFilter" or "hideShorts" and value is
  // its new state. The content script says so on the page. No answer.
  NOTICE: "better-yt:notice",
  // The settings that hold the channel lists, the only lists LIST_CHANNEL may name.
  CHANNEL_LISTS: Object.freeze(["allowedChannels", "blockedChannels"]),
  // The ids of the right-click menu entries Never hide this channel and Always hide this channel.
  MENU_ALLOW_CHANNEL: "better-yt:allow-channel",
  MENU_BLOCK_CHANNEL: "better-yt:block-channel",
  // The keyboard shortcuts that turn Filter recommendations and Hide Shorts on or off, as the
  // manifest's commands name them.
  COMMAND_TOGGLE_FILTER: "toggle-topic-filter",
  COMMAND_TOGGLE_SHORTS: "toggle-hide-shorts",
  // The manifest's declarative_net_request ruleset that sends Shorts to the regular player.
  SHORTS_RULESET: "shorts_redirect",
  // The target of messages that only the offscreen document handles.
  OFFSCREEN: "offscreen",
  // The offscreen document's page, the only sender of STATUS and IDLE.
  OFFSCREEN_PATH: "src/offscreen.html",
  // Where the background keeps the latest model status, in chrome.storage.session.
  STATUS_KEY: "modelStatus",
  MODEL_STATES: Object.freeze({
    IDLE: "idle",
    LOADING: "loading",
    READY: "ready",
    ERROR: "error",
  }),
});
