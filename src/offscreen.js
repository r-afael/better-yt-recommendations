// Runs in the offscreen document: answers MATCH requests with the topic model's scores,
// reports the model's status, and says when it has been idle long enough to close.
(() => {
  "use strict";

  const { MATCH, STATUS, IDLE, OFFSCREEN, MODEL_STATES } = globalThis.BetterYT.protocol;

  const IDLE_MS = 5 * 60_000; // Closing the document frees about 600 MB once matching stops.

  const isString = (value) => typeof value === "string";
  const isVideo = (video) => typeof video === "object" && video !== null &&
    isString(video.id) && isString(video.title) && isString(video.channel);
  const errorMessage = (error) => String(error?.message ?? error);

  // Returns why message is not a valid MATCH request, or null when it is.
  function validate(message) {
    if (message?.type !== MATCH) return "Unsupported message type.";
    if (!Array.isArray(message.topics) || !message.topics.every(isString)) {
      return "topics must be an array of strings.";
    }
    if (!Array.isArray(message.videos) || !message.videos.every(isVideo)) {
      return "videos must be an array of { id, title, channel } strings.";
    }
    return null;
  }

  function createService({ loadModel, createMatcher, report, onIdle, idleMs = IDLE_MS }) {
    let loading = null;
    let reportedPercent = null;
    let running = 0;
    let idleTimer = null;

    // Progress events arrive many times per second, so only whole-percent changes are reported.
    function reportProgress(fraction) {
      const percent = Math.floor(fraction * 100);
      if (percent === reportedPercent) return;
      reportedPercent = percent;
      report({ state: MODEL_STATES.LOADING, progress: percent / 100 });
    }

    async function startLoading() {
      reportedPercent = null;
      reportProgress(0);
      try {
        const embed = await loadModel({ onProgress: reportProgress });
        report({ state: MODEL_STATES.READY });
        return createMatcher({ embed });
      } catch (error) {
        report({ state: MODEL_STATES.ERROR });
        throw error;
      }
    }

    // Concurrent requests share one load. A failed load is forgotten so the next request retries.
    function getMatcher() {
      if (!loading) {
        loading = startLoading();
        loading.catch(() => {
          loading = null;
        });
      }
      return loading;
    }

    function requestStarted() {
      running += 1;
      clearTimeout(idleTimer);
      idleTimer = null;
    }

    function requestFinished() {
      running -= 1;
      if (running > 0) return;
      idleTimer = setTimeout(() => {
        idleTimer = null;
        onIdle();
      }, idleMs);
    }

    async function answer(message) {
      const problem = validate(message);
      if (problem) return { error: problem };
      try {
        const matcher = await getMatcher();
        return { scores: await matcher.score(message.topics, message.videos) };
      } catch (error) {
        return { error: errorMessage(error) };
      }
    }

    // Resolves to { scores } or { error }; never rejects.
    async function handle(message) {
      requestStarted();
      try {
        return await answer(message);
      } finally {
        requestFinished();
      }
    }

    return Object.freeze({ handle });
  }

  // The background may be restarting, and a lost status update is replaced by the next one.
  function send(message) {
    chrome.runtime.sendMessage(message).catch(() => {});
  }

  function start() {
    const { matcher, model } = globalThis.BetterYT;
    const service = createService({
      loadModel: (options) => model.load(options),
      createMatcher: (options) => matcher.createMatcher(options),
      report: (status) => send({ type: STATUS, status }),
      onIdle: () => send({ type: IDLE }),
    });
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.target !== OFFSCREEN) return false;
      service.handle(message).then(sendResponse);
      return true;
    });
  }

  globalThis.BetterYT.offscreen = Object.freeze({ createService });
  if (globalThis.chrome?.runtime?.onMessage) start();
})();
