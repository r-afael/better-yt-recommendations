// Hides videos in the lists checked under Where to filter: next to the video, Home, Subscriptions
// and search. A video is hidden when its channel is always hidden, or when it matches a topic to
// avoid more than the user's topics or doesn't match them, as verdict.js decides. A channel that
// is never hidden keeps its videos visible. Listed channels need no model; for the others, the
// model answers through the background service worker, and until it does, videos stay visible.
// A row above the list counts the hidden videos and shows them on request, and the toolbar
// icon's badge shows the same count.
(() => {
  "use strict";

  const { cards, channels, createHiddenRow, createScheduler, protocol, settings, verdict } = globalThis.BetterYT;

  const SCAN_DELAY_MS = 150; // Lets a burst of list mutations settle into one scan.
  const RETRY_MS = 30_000; // After a failure, so a broken model doesn't get a request storm.
  const MAX_BATCH = 30; // Videos per request, so the first verdicts arrive quickly.
  const REQUEST_TIMEOUT_MS = 60_000; // A request that never settles counts as a failure, so filtering resumes.
  const REVEAL_ATTRIBUTE = "data-better-yt-reveal"; // On the root while the hidden videos are shown.
  const PAUSE_ATTRIBUTE = "data-better-yt-paused"; // On the root while YouTube's loading of more videos is held.
  const PAUSE_AFTER = 60; // Videos hidden without the user scrolling, about two of YouTube's pages.
  // What a user does to see more of the page; any of them lets YouTube load more videos again.
  const SCROLL_EVENTS = Object.freeze(["wheel", "touchmove", "pointerdown"]);
  const SCROLL_KEYS = new Set(["PageDown", "End", " ", "ArrowDown"]);
  const WATCHED = Object.freeze({
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: cards.WATCHED_ATTRIBUTES,
  });

  let options = null; // Nothing runs until the settings have loaded.
  let topicLists = { want: [], avoid: [] }; // The parsed topics to see and to avoid.
  let channelIndex = channels.createIndex(settings.DEFAULTS); // Says "allow", "block" or null for a channel.
  let scores = new Map(); // Video id to its { want, avoid } similarities to the current lists.
  let requesting = false;
  let retryAt = -Infinity;
  let warned = false;
  let observer = null;
  let observed = null;
  let surface = cards.surfaceFor(location.pathname);
  let revealed = false; // Whether the hidden videos are shown, until the next page.
  let lastReported = 0; // The count last sent for the badge.
  let hiddenSinceScroll = 0; // Videos the filter hid since the user last tried to scroll.
  const row = createHiddenRow({ onToggle: toggleReveal });

  // Whether the topics ask the model about videos, once the filter is on.
  const asksModel = () => verdict.hasTopics(topicLists);
  // Whether anything can hide a video, once the filter is on.
  const hasRules = () => asksModel() || channelIndex.hasBlocked;
  // Whether the filter works on the page shown.
  const isActive = () => cards.filtersOn(options ?? {}, surface) && hasRules();
  const sameTopics = (a, b) => a.length === b.length && a.every((topic, position) => topic === b[position]);
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
    observer ??= new MutationObserver((records) => {
      if (records.some((record) => cards.isRelevant(record))) scheduleScan();
    });
    observer.disconnect();
    observer.observe(target, WATCHED);
    observed = target;
  }

  // Stops watching the page shown and clears the row and the badge. The marks on the cards stay.
  function pause() {
    observer?.disconnect();
    observer = null;
    observed = null;
    scanLater.cancel();
    row.unmount();
    setRevealed(false);
    resumeLoading();
    report(0);
  }

  // YouTube loads more videos once its marker at the end of the list comes into view. When the
  // filter hides nearly every video, nothing pushes the marker away, and YouTube would keep loading
  // pages that are hidden in turn while the tab sits idle. After PAUSE_AFTER hidden videos with no
  // try to scroll, filter.css takes the marker away until the user scrolls or shows the videos.
  function noteHidden() {
    hiddenSinceScroll += 1;
    if (hiddenSinceScroll >= PAUSE_AFTER) document.documentElement.setAttribute(PAUSE_ATTRIBUTE, "");
  }

  function resumeLoading() {
    hiddenSinceScroll = 0;
    document.documentElement.removeAttribute(PAUSE_ATTRIBUTE);
  }

  // Stops filtering and shows every hidden video in the document.
  function stop() {
    pause();
    cards.unhideAll();
  }

  function setRevealed(value) {
    revealed = value;
    document.documentElement.toggleAttribute(REVEAL_ATTRIBUTE, value);
  }

  function toggleReveal() {
    setRevealed(!revealed);
    resumeLoading();
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

  // Why an item's video is hidden, or null. ruling is what the channel lists say about its
  // channel, and comes first; unscored videos stay visible.
  function reasonFor(video, ruling) {
    if (!video || ruling === "allow") return null;
    if (ruling === "block") return "blocked";
    const score = scores.get(video.id);
    return score ? verdict.decide(score, options) : null;
  }

  // Whether to ask the model about a video: it has no score yet and its channel isn't listed.
  const needsScore = (video, ruling) => video !== null && ruling === null && !scores.has(video.id);

  function applyVerdict(item, video, ruling) {
    const reason = reasonFor(video, ruling);
    const hiddenFor = reason ? video.id : null;
    if (cards.hiddenId(item) === hiddenFor && cards.hiddenReason(item) === reason) return;
    if (!reason) {
      cards.unhide(item);
      return;
    }
    if (cards.hiddenId(item) === null) noteHidden();
    cards.hide(item, hiddenFor, reason);
  }

  function scan() {
    if (!isActive()) return;
    watch();
    const asking = asksModel();
    const unknown = new Map();
    for (const item of cards.findItems(surface)) {
      const video = cards.readVideo(item);
      const ruling = video ? channelIndex.lookup(video.channel) : null;
      applyVerdict(item, video, ruling);
      if (asking && needsScore(video, ruling)) unknown.set(video.id, video);
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

  // After a settings change: filters the page shown, or shows every hidden video again. The scan
  // runs at once, so a change that unhid every card never shows a blocked channel's videos.
  function update() {
    if (isActive()) scan();
    else stop();
  }

  // After the page shown changed. YouTube keeps earlier pages in the document, hidden, and their
  // marks stay even when this page isn't filtered, so going back to one doesn't flash its hidden
  // videos. A list whose page was unchecked while another page was shown still has its marks, so
  // arriving at it shows its videos.
  function updatePage() {
    if (isActive()) {
      scheduleScan(0);
      return;
    }
    pause();
    const list = surface && cards.container(surface);
    if (list) cards.unhideAll(list);
  }

  // A new channel list keeps the scores: they don't depend on it.
  function applySettings(changes) {
    options = { ...options, ...changes };
    if (protocol.CHANNEL_LISTS.some((list) => list in changes)) channelIndex = channels.createIndex(options);
    const next = verdict.lists(options);
    if (!sameLists(next, topicLists)) {
      // Answers to requests made for the old topics land in the old map and are dropped with it.
      topicLists = next;
      scores = new Map();
      cards.unhideAll();
    }
    update();
  }

  // A new kind of page takes the row away and re-targets the observer, and its count is always
  // sent for the badge. The next scan mounts the row on the list shown, and every new page starts
  // with its hidden videos collapsed and YouTube free to load more.
  function onNavigate() {
    const next = cards.surfaceFor(location.pathname);
    if (next !== surface) {
      row.unmount();
      lastReported = null;
      observed = null;
      surface = next;
    }
    setRevealed(false);
    resumeLoading();
    updatePage();
  }

  document.addEventListener("yt-navigate-finish", onNavigate);

  // Capturing at the window, so YouTube's own handlers can't keep these from the filter.
  for (const type of SCROLL_EVENTS) addEventListener(type, resumeLoading, { capture: true, passive: true });
  addEventListener("keydown", (event) => {
    if (SCROLL_KEYS.has(event.key)) resumeLoading();
  }, { capture: true, passive: true });

  addEventListener("pagehide", () => report(0));
  // Chrome clears the badge of a page kept in the back/forward cache, and no navigation or
  // mutation follows its return. pagehide has already reported 0, which is what the restored
  // page's badge shows, so a rescan sends any other count again.
  addEventListener("pageshow", (event) => {
    if (event.persisted) updatePage();
  });

  settings.load().then((loaded) => {
    applySettings(loaded);
    settings.subscribe(applySettings);
  });
})();
