import assert from "node:assert/strict";
import test from "node:test";
import { SCAN_MS, channelNames, flush, openYouTube, read } from "./helpers.js";

const watchFixture = read("test/fixtures/watch-sidebar.html");
const homeFixture = read("test/fixtures/home-grid.html");
const WATCH_PATH = "/watch?v=W6NZfCO5SIk";
const TOAST_MS = 3000;
const LONG_TOAST_MS = 8000;
const NO_CHANNEL = "Right-click a video's thumbnail or title to pick its channel.";
const LIST_FULL = "That list is full. Remove a channel in All settings first.";
// A channel name as the confirmations show it, isolated from the sentence around it.
const isolated = (name) => `\u2068${name}\u2069`;
const NOT_FILTERED = "It applies where Filter recommendations is on and the page is checked under Where to filter.";

async function setup(t, { fixture = watchFixture, path = WATCH_PATH, stored = {} } = {}) {
  const { window, document, chrome, clock } = await openYouTube(t, { fixture, path, stored });

  const { LIST_CHANNEL } = window.BetterYT.protocol;
  const cards = () => [...document.querySelectorAll("yt-lockup-view-model")];
  const titleLink = (index) => cards()[index].querySelector("a.ytLockupMetadataViewModelTitle");
  const isShown = (element) => window.getComputedStyle(element).display !== "none";
  const rightClick = (element) => element.dispatchEvent(new window.MouseEvent("contextmenu", { bubbles: true, composed: true }));
  // Delivers the message the background sends when a menu entry is picked on linkUrl.
  const list = async (name, linkUrl) => {
    chrome.runtime.onMessage.dispatch({ type: LIST_CHANNEL, list: name, linkUrl }, { id: "better-yt" }, () => {});
    await flush();
  };
  const toast = () => document.querySelector(".better-yt-toast");
  // The message shown at the bottom of the page, or null while none is.
  const toastText = () => toast()?.textContent || null;
  // A stored list, copied out of the page's realm so it compares as a plain array.
  const storedList = (key) => structuredClone(chrome.data[key]);

  return { document, chrome, clock, cards, titleLink, isShown, rightClick, list, toastText, storedList };
}

test("Always hide this channel hides the right-clicked video's channel and says so", async (t) => {
  const { clock, cards, titleLink, isShown, rightClick, list, toastText, storedList } = await setup(t);

  rightClick(titleLink(1));
  await list("blockedChannels", titleLink(1).href);

  assert.deepEqual(storedList("blockedChannels"), ["freeCodeCamp.org"]);
  assert.equal(toastText(), `${isolated("freeCodeCamp.org")} will always be hidden.`);
  await clock.tickAsync(SCAN_MS);
  assert.deepEqual(cards().map(isShown), [true, false, true, true]);
});

test("Never hide this channel moves a channel from the block list to the allow list", async (t) => {
  const { clock, cards, titleLink, isShown, rightClick, list, toastText, storedList } = await setup(t, {
    stored: { blockedChannels: ["Fireship", "freeCodeCamp.org"] },
  });
  assert.equal(isShown(cards()[1]), false);

  rightClick(titleLink(1));
  await list("allowedChannels", titleLink(1).href);

  assert.deepEqual(storedList("allowedChannels"), ["freeCodeCamp.org"]);
  assert.deepEqual(storedList("blockedChannels"), ["Fireship"]);
  assert.equal(toastText(), `${isolated("freeCodeCamp.org")} will never be hidden.`);
  await clock.tickAsync(SCAN_MS);
  assert.equal(isShown(cards()[1]), true);
});

test("finds the video from the clicked link when the right-click landed outside its card", async (t) => {
  const { document, titleLink, rightClick, list, storedList } = await setup(t);
  // Stands in for the preview player YouTube shows over a hovered card, outside the card itself.
  // Its link carries parameters, such as the playback time, that the card's own link doesn't.
  const preview = document.createElement("div");
  preview.id = "video-preview";
  const link = document.createElement("a");
  link.href = `${titleLink(1).getAttribute("href")}&t=42s&pp=abc`;
  preview.append(link);
  document.body.append(preview);

  rightClick(link);
  await list("blockedChannels", link.href);

  assert.deepEqual(storedList("blockedChannels"), ["freeCodeCamp.org"]);
});

test("outside its card, the clicked link picks the video's card over a mix that starts with that video", async (t) => {
  const { document, cards, titleLink, rightClick, list, storedList } = await setup(t);
  const id = new URL(titleLink(1).href).searchParams.get("v");
  const mix = cards()[0];
  for (const link of mix.querySelectorAll("a[href]")) link.setAttribute("href", `/watch?v=${id}&list=RD${id}`);
  const host = mix.querySelector("div.ytLockupViewModelHost");
  host.className = host.className.replace(/content-id-\S+/u, `content-id-RD${id}`);
  const outside = document.createElement("a");
  outside.href = `/watch?v=${id}`;
  document.body.append(outside);

  rightClick(outside);
  await list("blockedChannels", outside.href);

  assert.deepEqual(storedList("blockedChannels"), ["freeCodeCamp.org"]);
});

test("uses the clicked link, not an earlier right-click", async (t) => {
  const { titleLink, rightClick, list, storedList } = await setup(t);

  rightClick(titleLink(0));
  await list("blockedChannels", titleLink(2).href);

  assert.deepEqual(storedList("blockedChannels"), ["Академия нейросетей Сергея Нагорного GORA ACADEMY"]);
});

// A mix lockup and a video card can both link to the same video.
test("the right-clicked card wins when another card links to the same video", async (t) => {
  const { document, cards, titleLink, rightClick, list, storedList } = await setup(t);
  const sameVideo = document.createElement("a");
  sameVideo.href = titleLink(2).getAttribute("href");
  cards()[0].append(sameVideo);

  rightClick(titleLink(2));
  await list("blockedChannels", titleLink(2).href);

  assert.deepEqual(storedList("blockedChannels"), ["Академия нейросетей Сергея Нагорного GORA ACADEMY"]);
});

test("a channel name link on Home lists that channel", async (t) => {
  const { document, rightClick, list, storedList } = await setup(t, { fixture: homeFixture, path: "/" });
  const channelLink = document.querySelector('a[href="/@programmingwithmosh"]');

  rightClick(channelLink);
  await list("blockedChannels", channelLink.href);

  assert.deepEqual(storedList("blockedChannels"), ["Programming with Mosh"]);
});

// The filter leaves shelves and ads as YouTube shows them, but their channels can still be listed
// for the lists the filter does work on.
test("lists the channel of a video in a shelf, and the shelf stays as it is", async (t) => {
  const { document, clock, isShown, rightClick, list, toastText, storedList } = await setup(t, {
    fixture: homeFixture,
    path: "/",
  });
  const shelfCard = document.querySelector("ytd-rich-grid-renderer > #contents > ytd-rich-item-renderer").cloneNode(true);
  const channelLink = shelfCard.querySelector('a[href^="/@"]');
  channelLink.setAttribute("href", "/@shelfchannel");
  channelLink.textContent = "Shelf Channel";
  document.querySelector("ytd-rich-section-renderer #contents").append(shelfCard);

  rightClick(channelLink);
  await list("blockedChannels", channelLink.href);

  assert.deepEqual(storedList("blockedChannels"), ["Shelf Channel"]);
  assert.equal(toastText(), `${isolated("Shelf Channel")} will always be hidden.`);
  await clock.tickAsync(SCAN_MS);
  assert.equal(isShown(shelfCard), true);
});

for (const [name, linkUrl] of [["a link to another page", "https://www.youtube.com/feed/history"], ["no link", undefined]]) {
  test(`${name} saves nothing and explains how to pick a video`, async (t) => {
    const { chrome, titleLink, rightClick, list, toastText } = await setup(t);

    rightClick(titleLink(1));
    await list("blockedChannels", linkUrl);

    assert.equal("blockedChannels" in chrome.data, false);
    assert.equal(toastText(), NO_CHANNEL);
  });
}

test("says where the list applies when nothing will be hidden right now", async (t) => {
  const off = await setup(t, { stored: { topicFilter: false } });
  off.rightClick(off.titleLink(1));
  await off.list("blockedChannels", off.titleLink(1).href);
  assert.equal(off.toastText(), `${isolated("freeCodeCamp.org")} will always be hidden. ${NOT_FILTERED}`);

  const pageUnchecked = await setup(t, { stored: { filterWatch: false } });
  pageUnchecked.rightClick(pageUnchecked.titleLink(1));
  await pageUnchecked.list("blockedChannels", pageUnchecked.titleLink(1).href);
  assert.equal(pageUnchecked.toastText(), `${isolated("freeCodeCamp.org")} will always be hidden. ${NOT_FILTERED}`);

  const on = await setup(t);
  on.rightClick(on.titleLink(1));
  await on.list("blockedChannels", on.titleLink(1).href);
  assert.equal(on.toastText(), `${isolated("freeCodeCamp.org")} will always be hidden.`);
});

// Fifty names fill a list. So do long names in a script of 3 bytes a character: these 28 fit in
// one synced setting, 14 bytes short of the budget, which "freeCodeCamp.org" would pass.
const fullLists = {
  "50 names": channelNames(50),
  "names too long to sync with one more": Array.from({ length: 28 }, (_, index) => `${index} ${"频".repeat(93)}`),
};

for (const [name, blockedChannels] of Object.entries(fullLists)) {
  test(`says when the list is full: ${name}`, async (t) => {
    const { titleLink, rightClick, list, toastText, storedList } = await setup(t, { stored: { blockedChannels } });

    rightClick(titleLink(1));
    await list("blockedChannels", titleLink(1).href);

    assert.equal(toastText(), LIST_FULL);
    assert.deepEqual(storedList("blockedChannels"), blockedChannels);
  });
}

test("confirms a channel the full list already holds", async (t) => {
  const blockedChannels = [...channelNames(49), "freeCodeCamp.org"];
  const { titleLink, rightClick, list, toastText, storedList } = await setup(t, { stored: { blockedChannels } });

  rightClick(titleLink(1));
  await list("blockedChannels", titleLink(1).href);

  assert.equal(toastText(), `${isolated("freeCodeCamp.org")} will always be hidden.`);
  assert.deepEqual(storedList("blockedChannels"), blockedChannels);
});

test("says when Chrome couldn't save the channel", async (t) => {
  const { chrome, titleLink, rightClick, list, toastText } = await setup(t);
  chrome.storage.sync.set = async () => {
    throw new Error("MAX_WRITE_OPERATIONS_PER_MINUTE quota exceeded");
  };

  rightClick(titleLink(1));
  await list("blockedChannels", titleLink(1).href);

  assert.equal(toastText(), "Couldn't save your change. Try again in a minute.");
});

test("ignores a list name it doesn't know", async (t) => {
  const { chrome, titleLink, rightClick, list, toastText } = await setup(t);

  rightClick(titleLink(1));
  await list("topics", titleLink(1).href);

  assert.equal("topics" in chrome.data, false);
  assert.equal(toastText(), null);
});

test("the message disappears after a few seconds", async (t) => {
  const { clock, titleLink, rightClick, list, toastText } = await setup(t);
  rightClick(titleLink(1));
  await list("blockedChannels", titleLink(1).href);

  await clock.tickAsync(TOAST_MS - 1);
  assert.notEqual(toastText(), null);
  await clock.tickAsync(1);
  assert.equal(toastText(), null);
});

test("a message that says where the list applies stays up long enough to read", async (t) => {
  const { clock, titleLink, rightClick, list, toastText } = await setup(t, { stored: { topicFilter: false } });
  rightClick(titleLink(1));
  await list("blockedChannels", titleLink(1).href);

  await clock.tickAsync(TOAST_MS);
  assert.equal(toastText(), `${isolated("freeCodeCamp.org")} will always be hidden. ${NOT_FILTERED}`);
  await clock.tickAsync(LONG_TOAST_MS - TOAST_MS);
  assert.equal(toastText(), null);
});
