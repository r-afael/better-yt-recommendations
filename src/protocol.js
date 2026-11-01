// Messages between the content script, the background service worker and the
// offscreen document that runs the topic model.
globalThis.BetterYT ??= {};
globalThis.BetterYT.protocol = Object.freeze({
  // Content script to background, which forwards it to the offscreen document:
  // { type, topics: string[], videos: [{ id, title, channel }] }
  // Answered with { scores: { [id]: number } }, each video's highest similarity to a topic
  // from -1 to 1, or with { error: string }.
  MATCH: "better-yt:match",
  // Offscreen document to background: { type, status: { state, progress? } },
  // where state is one of MODEL_STATES and progress runs from 0 to 1 while loading.
  STATUS: "better-yt:status",
  // Offscreen document to background: nothing has been matched for a while,
  // so the document can close and free the model's memory.
  IDLE: "better-yt:idle",
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
