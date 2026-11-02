// Shows a short message at the bottom of YouTube pages, such as the one that confirms a channel
// was added to a list or what a keyboard shortcut turned on or off. A new message replaces the
// one shown.
(() => {
  "use strict";

  const { NOTICE } = globalThis.BetterYT.protocol;

  const DURATION_MS = 3000;
  // The messages for each setting a shortcut changes, when it is off and when it is on.
  const NOTICES = Object.freeze({
    topicFilter: ["topicFilterOff", "topicFilterOn"],
    hideShorts: ["hideShortsOff", "hideShortsOn"],
  });

  let timer;

  // The message is in the extension's language, which can differ from YouTube's. The region is
  // on the page, empty, from the start: a screen reader may not announce a live region that
  // appears, or comes back from display:none, together with its text.
  function create() {
    const element = document.createElement("div");
    element.className = "better-yt-toast";
    element.lang = chrome.i18n.getMessage("lang");
    element.dir = chrome.i18n.getMessage("@@bidi_dir");
    element.setAttribute("role", "status");
    element.setAttribute("aria-live", "polite");
    document.body.append(element);
    return element;
  }

  const toast = create();

  // Shows text for a few seconds, counted again from now when another message is showing.
  function show(text) {
    toast.textContent = text;
    clearTimeout(timer);
    timer = setTimeout(() => {
      toast.textContent = "";
    }, DURATION_MS);
  }

  const isNotice = (message) =>
    message?.type === NOTICE && Object.hasOwn(NOTICES, message.key) && typeof message.value === "boolean";

  // Answers nothing, so the message channel is never held open.
  chrome.runtime.onMessage.addListener((message) => {
    if (isNotice(message)) show(chrome.i18n.getMessage(NOTICES[message.key][Number(message.value)]));
  });

  globalThis.BetterYT.toast = Object.freeze({ show });
})();
