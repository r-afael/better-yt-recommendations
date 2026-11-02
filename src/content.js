// Selects Your custom feed when YouTube Home opens and, in enforcement mode,
// keeps it selected for as long as Home stays open.
(() => {
  "use strict";

  const { CUSTOM_FEED_LABELS, cards, createScheduler, settings } = globalThis.BetterYT;

  // The same Home pages the filter works on.
  const HOME_PATHS = new Set(cards.SURFACES.home.paths);
  const CHIP_BAR = 'ytd-browse[page-subtype="home"] ytd-feed-filter-chip-bar-renderer';
  const CHIP_RENDERER = "yt-chip-cloud-chip-renderer";
  const CHIP = `${CHIP_RENDERER}, [role="tab"]`;
  const WATCHED_ATTRIBUTES = ["hidden", "aria-hidden", "selected", "aria-selected", "disabled", "aria-disabled"];
  const WAIT_MS = 20_000; // How long a visit waits for the tab, and guards it after a Home click.
  const RETRY_MS = 1_000; // YouTube can ignore clicks made before Home is ready.
  const MAX_CLICKS = 3; // Per visit, or unanswered in a row while enforcing.
  const RECHECK_MS = 500; // While waiting, catches layout changes that no mutation reports.
  const THROTTLE_MS = 50;

  const normalize = (text) => (text || "")
    .normalize("NFD")
    .replaceAll(/\p{M}/gu, "")
    .replaceAll(/\s+/g, " ")
    .trim()
    .toLowerCase();
  const LABELS = new Set(Object.values(CUSTOM_FEED_LABELS).flat().map((label) => normalize(label)));

  let options = null; // Nothing runs until the settings have loaded.
  let visit = null;
  let navigating = false;
  let homeRequested = false;
  let clicking = false;
  let cachedTab = null;
  let observer = null;

  const isHome = () => HOME_PATHS.has(location.pathname);
  const enforcing = () => Boolean(options?.enabled && options.enforce);
  const newVisit = (guard = false) => ({ started: performance.now(), lastClick: -Infinity, clicks: 0, guard, done: false });

  function hasLabel(element) {
    return LABELS.has(normalize(element.getAttribute("aria-label"))) || LABELS.has(normalize(element.textContent));
  }

  function isClickable(tab) {
    return tab.checkVisibility({ visibilityProperty: true }) &&
      !tab.closest('[aria-hidden="true"], [disabled], [aria-disabled="true"]');
  }

  function isSelected(tab) {
    const value = tab.getAttribute("aria-selected");
    if (value !== null) return value === "true";
    return tab.hasAttribute("selected") || Boolean(tab.closest(CHIP_RENDERER)?.hasAttribute("selected"));
  }

  // Returns the clickable part of the custom feed chip, preferring a visible one.
  function findTab() {
    if (cachedTab?.isConnected && cachedTab.closest(CHIP_BAR) && hasLabel(cachedTab)) return cachedTab;
    cachedTab = null;

    let hidden = null;
    for (const candidate of document.querySelectorAll(`${CHIP_BAR} :is(${CHIP}, button)`)) {
      if (!hasLabel(candidate)) continue;
      const tab = candidate.matches(CHIP_RENDERER)
        ? candidate.querySelector('[role="tab"], button') || candidate
        : candidate;
      if (isClickable(tab)) {
        cachedTab = tab;
        return tab;
      }
      hidden ??= tab;
    }
    return hidden;
  }

  // Runs update() after a delay, keeping whichever pending run comes first.
  const { schedule, cancel: cancelUpdate } = createScheduler(update);

  function watch() {
    if (observer) return;
    observer = new MutationObserver(() => schedule(THROTTLE_MS));
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: WATCHED_ATTRIBUTES,
    });
  }

  function stopWatching() {
    observer?.disconnect();
    observer = null;
    cancelUpdate();
  }

  // Stops for the rest of this visit to Home.
  function endVisit() {
    if (visit) visit.done = true;
    stopWatching();
  }

  // Forgets the visit, so the next update starts a fresh one.
  function resetVisit() {
    visit = null;
    stopWatching();
  }

  function update() {
    if (navigating || !options?.enabled) return;
    if (!isHome()) {
      resetVisit();
      return;
    }

    visit ??= newVisit();
    if (visit.done) return;
    watch();

    const now = performance.now();
    const age = now - visit.started;
    if (age >= WAIT_MS && !enforcing()) {
      endVisit();
      return;
    }

    const tab = findTab();
    if (tab && isSelected(tab)) {
      holdSelection(age);
    } else if (tab && isClickable(tab)) {
      clickTab(tab, now);
    } else {
      waitForTab(age);
    }
  }

  // The custom feed is selected: decides whether this visit still needs to watch it.
  function holdSelection(age) {
    if (enforcing()) {
      // Keep watching; the observer reports when another tab gets selected.
      visit.clicks = 0;
    } else if (visit.guard) {
      // Home/logo navigation can reset this selection after navigation finishes.
      schedule(WAIT_MS - age);
    } else {
      endVisit();
    }
  }

  // The tab is missing or not clickable yet: checks again while the visit is still waiting.
  function waitForTab(age) {
    cachedTab = null;
    if (age < WAIT_MS) schedule(RECHECK_MS);
  }

  // Clicks the tab, unless the last click is too recent or YouTube has ignored too many.
  function clickTab(tab, now) {
    const sinceClick = now - visit.lastClick;
    if (sinceClick < RETRY_MS) {
      schedule(RETRY_MS - sinceClick);
      return;
    }
    if (visit.clicks >= MAX_CLICKS) {
      endVisit();
      return;
    }

    // The limit holds across YouTube navigation events triggered by this click.
    visit.clicks += 1;
    visit.lastClick = now;
    clicking = true;
    try {
      tab.click();
    } finally {
      clicking = false;
    }
    // Finishes now if the click took effect, otherwise schedules a retry.
    update();
  }

  function isHomeLink(target) {
    const anchor = target.closest("a[href]");
    if (!anchor || anchor.hasAttribute("download") || (anchor.target && anchor.target !== "_self")) return false;
    const url = new URL(anchor.href, location.href);
    return url.origin === location.origin && HOME_PATHS.has(url.pathname);
  }

  const isPlainLeftClick = (event) =>
    event.button === 0 && !(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey);

  function onClick(event) {
    if (clicking || !options?.enabled || !(event.target instanceof Element) || !isPlainLeftClick(event)) return;

    if (isHomeLink(event.target)) {
      requestHome();
    } else if (isHome()) {
      onChipClick(event);
    }
  }

  // Home/logo clicks also count when the URL is already the homepage.
  function requestHome() {
    homeRequested = true;
    stopWatching();
    visit = newVisit(true);
    // Same-page refreshes do not always dispatch navigation events.
    if (isHome()) schedule(0);
  }

  function onChipClick(event) {
    const chip = event.target.closest(`${CHIP_BAR} :is(${CHIP})`);
    if (!chip) return;
    const tab = findTab();
    if (tab && (chip.contains(tab) || tab.contains(chip))) return;

    if (tab && enforcing() && !visit?.done) {
      // Stop the other tab from loading at all; update() covers anything that slips through.
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    // Let an explicit choice win, including while the default tab is loading.
    endVisit();
  }

  function applySettings(next) {
    const previous = options;
    options = next;
    if (!options.enabled || !previous?.enabled || (options.enforce && !previous.enforce)) {
      // Turning a feature on applies it right away, as if Home had just opened.
      resetVisit();
    } else if (previous.enforce && !options.enforce) {
      endVisit();
    }
    update();
  }

  document.addEventListener("yt-navigate-start", () => {
    navigating = true;
    stopWatching();
  });

  document.addEventListener("yt-navigate-finish", () => {
    navigating = false;
    if (homeRequested && !visit) visit = newVisit(true);
    homeRequested = false;
    update();
  });

  document.addEventListener("yt-page-data-updated", update);
  globalThis.addEventListener("popstate", update);
  globalThis.addEventListener("pageshow", (event) => {
    if (event.persisted) {
      navigating = false;
      resetVisit();
    }
    update();
  });
  globalThis.addEventListener("pagehide", stopWatching);
  // Window capture runs before YouTube's own click handlers.
  globalThis.addEventListener("click", onClick, { capture: true });

  settings.load().then((loaded) => {
    applySettings(loaded);
    settings.subscribe((changes) => applySettings({ ...options, ...changes }));
  });
})();
