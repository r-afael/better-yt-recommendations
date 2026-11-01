// Hides the recommendations next to the video being watched that don't match the user's topics.
// The model answers through the background service worker; until it does, videos stay visible.
(() => {
  "use strict";

  const { createScheduler, protocol, settings, sidebar, topics: topicList } = globalThis.BetterYT;

  const WATCH_PATH = "/watch";
  const SCAN_DELAY_MS = 150; // Lets a burst of sidebar mutations settle into one scan.
  const RETRY_MS = 30_000; // After a failure, so a broken model doesn't get a request storm.
  const MAX_BATCH = 30; // Videos per request, so the first verdicts arrive quickly.
  const REQUEST_TIMEOUT_MS = 60_000; // A request that never settles counts as a failure, so filtering resumes.
  // Attributes YouTube changes when it reuses an item for another video.
  const WATCHED = Object.freeze({
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["class", "href", "title"],
  });

  let options = null; // Nothing runs until the settings have loaded.
  let topics = [];
  let scores = new Map(); // Video id to its highest similarity to the current topics.
  let requesting = false;
  let retryAt = -Infinity;
  let warned = false;
  let observer = null;
  let observed = null;

  const isActive = () => Boolean(options?.topicFilter) && topics.length > 0 && location.pathname === WATCH_PATH;
  const sameTopics = (a, b) => a.length === b.length && a.every((topic, index) => topic === b[index]);

  // Runs scan() after a delay, keeping whichever pending run comes first.
  const scanLater = createScheduler(scan);
  const scheduleScan = (delay = SCAN_DELAY_MS) => {
    if (isActive()) scanLater.schedule(delay);
  };

  // Watches the recommendations, or the whole page until they exist.
  function watch() {
    const target = sidebar.container() ?? document.documentElement;
    if (observed === target) return;
    observer ??= new MutationObserver(() => scheduleScan());
    observer.disconnect();
    observer.observe(target, WATCHED);
    observed = target;
  }

  function stop() {
    observer?.disconnect();
    observer = null;
    observed = null;
    scanLater.cancel();
    sidebar.unmarkAll();
  }

  // Hides an item only for a video scored below the threshold, so unscored videos stay visible.
  function applyVerdict(item, video) {
    const hiddenFor = video && scores.get(video.id) < options.threshold ? video.id : null;
    if (sidebar.markedId(item) === hiddenFor) return;
    if (hiddenFor) sidebar.markOffTopic(item, hiddenFor);
    else sidebar.unmark(item);
  }

  function scan() {
    if (!isActive()) return;
    watch();
    const unknown = new Map();
    for (const item of sidebar.findItems()) {
      const video = sidebar.readVideo(item);
      applyVerdict(item, video);
      if (video && !scores.has(video.id)) unknown.set(video.id, video);
    }
    requestVerdicts([...unknown.values()].slice(0, MAX_BATCH));
  }

  function requestVerdicts(videos) {
    if (requesting || videos.length === 0) return;
    const wait = retryAt - performance.now();
    if (wait > 0) {
      scheduleScan(wait);
      return;
    }
    requesting = true;
    const cache = scores;
    ask({ type: protocol.MATCH, topics, videos })
      .then((answer) => record(cache, videos, answer), fail)
      .finally(() => {
        requesting = false;
        scheduleScan(0);
      });
  }

  // Sends a message and settles with its answer, or fails when none arrives in time.
  // A late answer is ignored, since the race has already settled.
  function ask(message) {
    let timeout;
    const expired = new Promise((resolve, reject) => {
      timeout = setTimeout(() => reject(new Error("The topic model took too long to answer.")), REQUEST_TIMEOUT_MS);
    });
    return Promise.race([chrome.runtime.sendMessage(message), expired]).finally(() => clearTimeout(timeout));
  }

  function record(cache, videos, answer) {
    if (!answer?.scores) {
      fail(answer?.error ?? "No answer from the topic model.");
      return;
    }
    warned = false;
    // A video the answer leaves out counts as on topic, so it isn't requested again.
    for (const { id } of videos) cache.set(id, answer.scores[id] ?? Infinity);
  }

  function fail(error) {
    retryAt = performance.now() + RETRY_MS;
    if (warned) return;
    warned = true;
    console.warn("Better YT Recommendations: topic filtering failed; will retry shortly.", error);
  }

  function update() {
    if (isActive()) scheduleScan(0);
    else stop();
  }

  function applySettings(changes) {
    options = { ...options, ...changes };
    const next = topicList.parse(options.topics);
    if (!sameTopics(next, topics)) {
      // Answers to requests made for the old topics land in the old map and are dropped with it.
      topics = next;
      scores = new Map();
      sidebar.unmarkAll();
    }
    update();
  }

  document.addEventListener("yt-navigate-finish", update);

  settings.load().then((loaded) => {
    applySettings(loaded);
    settings.subscribe(applySettings);
  });
})();
