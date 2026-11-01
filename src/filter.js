// Hides the videos in the lists it works on that don't match the user's topics, or that are
// closer to a topic to avoid.
// The model answers through the background service worker; until it does, videos stay visible.
// A row above the list counts the hidden videos and shows them on request, and the toolbar
// icon's badge shows the same count.
(() => {
  "use strict";

  const { cards, createHiddenRow, createScheduler, protocol, settings, verdict } = globalThis.BetterYT;

  const SCAN_DELAY_MS = 150; // Lets a burst of list mutations settle into one scan.
  const RETRY_MS = 30_000; // After a failure, so a broken model doesn't get a request storm.
  const MAX_BATCH = 30; // Videos per request, so the first verdicts arrive quickly.
  const REQUEST_TIMEOUT_MS = 60_000; // A request that never settles counts as a failure, so filtering resumes.
  const REVEAL_ATTRIBUTE = "data-better-yt-reveal"; // On the root while the hidden videos are shown.
  // Attributes YouTube changes when it reuses an item for another video.
  const WATCHED = Object.freeze({
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["class", "href", "title"],
  });

  let options = null; // Nothing runs until the settings have loaded.
  let topicLists = { want: [], avoid: [] }; // The parsed topics to see and to avoid.
  let scores = new Map(); // Video id to its { want, avoid } similarities to the current lists.
  let requesting = false;
  let retryAt = -Infinity;
  let warned = false;
  let observer = null;
  let observed = null;
  let surface = cards.surfaceFor(location.pathname);
  let revealed = false; // Whether the hidden videos are shown, until the next page.
  let lastReported = 0; // The count last sent for the badge.
  const row = createHiddenRow({ onToggle: toggleReveal });

  const isActive = () => options !== null && verdict.needsModel(options) && surface?.id === "watch";
  const sameTopics = (a, b) => a.length === b.length && a.every((topic, index) => topic === b[index]);
  const sameLists = (a, b) => sameTopics(a.want, b.want) && sameTopics(a.avoid, b.avoid);

  // Runs scan() after a delay, keeping whichever pending run comes first.
  const scanLater = createScheduler(scan);
  const scheduleScan = (delay = SCAN_DELAY_MS) => {
    if (isActive()) scanLater.schedule(delay);
  };

  // Watches the list of videos, or the whole page until it exists.
  function watch() {
    const target = cards.container(surface) ?? document.documentElement;
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
    cards.unhideAll();
    row.unmount();
    setRevealed(false);
    report(0);
  }

  function setRevealed(value) {
    revealed = value;
    document.documentElement.toggleAttribute(REVEAL_ATTRIBUTE, value);
  }

  function toggleReveal() {
    setRevealed(!revealed);
    showHiddenCount();
  }

  // Sends the badge the count when it changed. The tab may be going away, so errors are ignored.
  function report(count) {
    if (count === lastReported) return;
    lastReported = count;
    chrome.runtime.sendMessage({ type: protocol.HIDDEN_COUNT, count }).catch(() => {});
  }

  // Puts the row before the list, updates it and reports the count for the badge.
  function showHiddenCount() {
    const list = cards.container(surface);
    if (list) row.mount(list);
    const count = cards.hiddenCount(surface);
    row.update(count, revealed);
    report(count);
  }

  // Why an item's video is hidden, or null. Unscored videos stay visible.
  function reasonFor(video) {
    if (!video) return null;
    return verdict.decide(scores.get(video.id) ?? verdict.NO_SCORE, options.threshold);
  }

  function applyVerdict(item, video) {
    const reason = reasonFor(video);
    const hiddenFor = reason ? video.id : null;
    if (cards.hiddenId(item) === hiddenFor && cards.hiddenReason(item) === reason) return;
    if (reason) cards.hide(item, hiddenFor, reason);
    else cards.unhide(item);
  }

  function scan() {
    if (!isActive()) return;
    watch();
    const unknown = new Map();
    for (const item of cards.findItems(surface)) {
      const video = cards.readVideo(item, surface);
      applyVerdict(item, video);
      if (video && !scores.has(video.id)) unknown.set(video.id, video);
    }
    requestVerdicts([...unknown.values()].slice(0, MAX_BATCH));
    showHiddenCount();
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
    ask({ type: protocol.MATCH, topics: topicLists.want, avoidTopics: topicLists.avoid, videos })
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
    // A video the answer leaves out stays visible, and isn't requested again.
    for (const { id } of videos) cache.set(id, answer.scores[id] ?? verdict.NO_SCORE);
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
    const next = verdict.lists(options);
    if (!sameLists(next, topicLists)) {
      // Answers to requests made for the old topics land in the old map and are dropped with it.
      topicLists = next;
      scores = new Map();
      cards.unhideAll();
    }
    update();
  }

  // Every new page starts with its hidden videos collapsed.
  document.addEventListener("yt-navigate-finish", () => {
    surface = cards.surfaceFor(location.pathname);
    setRevealed(false);
    update();
  });

  addEventListener("pagehide", () => report(0));
  // Chrome clears the badge of a page kept in the back/forward cache, and no navigation or
  // mutation follows its return. pagehide has already reported 0, which is what the restored
  // page's badge shows, so a rescan sends any other count again.
  addEventListener("pageshow", (event) => {
    if (event.persisted) update();
  });

  settings.load().then((loaded) => {
    applySettings(loaded);
    settings.subscribe(applySettings);
  });
})();
