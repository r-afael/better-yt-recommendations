// Adds the channel of a right-clicked video to a channel list when Never hide this channel or
// Always hide this channel is picked in the menu, and says so in a message on the page. The
// background sends the link the menu opened on, which decides the video.
(() => {
  "use strict";

  const { cards, channels, protocol, settings, toast } = globalThis.BetterYT;
  const [ALLOWED, BLOCKED] = protocol.CHANNEL_LISTS;

  // For each list: the message that confirms a channel was added, and whether it hides videos.
  const CONFIRMATIONS = Object.freeze({
    [ALLOWED]: Object.freeze({ key: "channelAllowed", hides: false }),
    [BLOCKED]: Object.freeze({ key: "channelBlocked", hides: true }),
  });

  const message = (key, substitutions) => chrome.i18n.getMessage(key, substitutions);
  // A message read at a glance, and one that explains or asks for something, which stays longer.
  const brief = (text) => ({ text });
  const long = (text) => ({ text, durationMs: toast.LONG_MS });

  let last = null; // The card under the last right-click, or null.

  // Listens at the earliest phase of dispatch. If a handler still stops the event before it gets
  // here, itemForLink finds the card from the clicked link.
  function remember(event) {
    last = cards.itemAt(event.composedPath()[0]);
  }

  // The channel of the video a link belongs to, or "" when it belongs to no readable video.
  function channelFor(linkUrl) {
    const item = cards.itemForLink(linkUrl, last);
    const video = item && cards.readVideo(item);
    return video?.channel || "";
  }

  // The message for a channel just saved. When the list hides videos but nothing will be hidden
  // right now, it also says where the list applies. The name is isolated (FSI ... PDI), so a name
  // in another script or starting with digits keeps its place in a right-to-left sentence.
  function confirmation(list, channel, values, surface) {
    const { key, hides } = CONFIRMATIONS[list];
    const saved = message(key, `\u2068${channel}\u2069`);
    if (!hides || cards.filtersOn(values, surface)) return brief(saved);
    return long(`${saved} ${message("channelSavedNotFiltered")}`);
  }

  // Saving moves the name out of the other list, and every YouTube tab's filter follows the change.
  async function save(list, channel, surface) {
    const values = await settings.load();
    const changes = channels.add(values, list, channel);
    if (!changes) return long(message("channelListFull"));
    try {
      await settings.save(changes);
    } catch (error) {
      return long(message(error?.code === settings.QUOTA_ERROR ? "channelListFull" : "saveFailed"));
    }
    return confirmation(list, channel, values, surface);
  }

  async function listChannel(list, linkUrl) {
    const surface = cards.surfaceFor(location.pathname);
    const channel = channelFor(linkUrl);
    const notice = channel ? await save(list, channel, surface) : long(message("noChannelPicked"));
    toast.show(notice.text, notice.durationMs);
  }

  globalThis.addEventListener("contextmenu", remember, { capture: true });

  // Answers nothing, so the message channel is never held open. listChannel handles its storage
  // failures itself: settings.load reads defaults when storage fails, and save says when a save fails.
  chrome.runtime.onMessage.addListener((request) => {
    if (request?.type === protocol.LIST_CHANNEL && Object.hasOwn(CONFIRMATIONS, request.list)) {
      void listChannel(request.list, request.linkUrl);
    }
  });
})();
