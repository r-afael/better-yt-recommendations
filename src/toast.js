// Shows a short message at the bottom of YouTube pages, such as the one that confirms a channel
// was added to a list. A new message replaces the one shown.
(() => {
  "use strict";

  const DURATION_MS = 3000;

  let toast = null; // Made on first use.
  let timer;

  function create() {
    const element = document.createElement("div");
    element.className = "better-yt-toast";
    element.setAttribute("role", "status");
    element.setAttribute("aria-live", "polite");
    element.hidden = true;
    document.body.append(element);
    return element;
  }

  // Shows text for a few seconds, counted again from now when another message is showing.
  function show(text) {
    toast ??= create();
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(timer);
    timer = setTimeout(() => {
      toast.hidden = true;
    }, DURATION_MS);
  }

  globalThis.BetterYT ??= {};
  globalThis.BetterYT.toast = Object.freeze({ show });
})();
