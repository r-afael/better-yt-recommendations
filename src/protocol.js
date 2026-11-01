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
  // The target of messages that only the offscreen document handles.
  OFFSCREEN: "offscreen",
  // Where the background keeps the latest model status, in chrome.storage.session.
  STATUS_KEY: "modelStatus",
  MODEL_STATES: Object.freeze({
    IDLE: "idle",
    LOADING: "loading",
    READY: "ready",
    ERROR: "error",
  }),
});
