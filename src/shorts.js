// Hides YouTube Shorts and opens Shorts links as regular videos. Full page loads of a Short are
// redirected by the declarativeNetRequest rule in src/rules/shorts-redirect.json before the page
// exists; this script covers navigation inside YouTube, which that rule never sees, and a Short
// already open when the setting turns on.
// src/shorts.css lists what to hide; it applies while the page carries HIDE_ATTRIBUTE.
// Runs at document_start, so Shorts don't flash on screen before the settings load.
(() => {
  "use strict";

  const { settings } = globalThis.BetterYT;

  const HIDE_ATTRIBUTE = "data-better-yt-hide-shorts";
  const SHORT_PATH = /^\/shorts\/([\w-]+)/u;

  let options = null; // Nothing runs until the settings have loaded.

  const hiding = () => Boolean(options?.hideShorts);

  // Swaps the Shorts player for the regular one, which doesn't scroll on to the next Short.
  // Replacing the page keeps the Short out of the back button's history.
  function openAsVideo() {
    const id = SHORT_PATH.exec(location.pathname)?.[1];
    if (hiding() && id) location.replace(`/watch?v=${id}`);
  }

  function applySettings(changes) {
    options = { ...options, ...changes };
    document.documentElement.toggleAttribute(HIDE_ATTRIBUTE, hiding());
    openAsVideo();
  }

  document.addEventListener("yt-navigate-finish", openAsVideo);

  settings.load().then((loaded) => {
    applySettings(loaded);
    settings.subscribe(applySettings);
  });
})();
