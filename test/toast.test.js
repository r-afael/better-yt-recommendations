import assert from "node:assert/strict";
import test from "node:test";
import { fakeChrome, openYouTube } from "./helpers.js";

const TOAST_MS = 3000;

// A blank YouTube page with every content script, which the background tells what a keyboard
// shortcut changed.
async function setup(t, { locale = "en" } = {}) {
  const { window, document, chrome, clock } = await openYouTube(t, {
    fixture: "",
    path: "/feed/history",
    chrome: fakeChrome({ locale }),
  });
  const { NOTICE } = window.BetterYT.protocol;
  const send = (message) => chrome.runtime.onMessage.dispatch(message, { id: "better-yt" }, () => {});
  const notify = (notice) => send({ type: NOTICE, ...notice });
  const toasts = () => [...document.querySelectorAll(".better-yt-toast")];
  // The message shown at the bottom of the page, or null while none is.
  const toastText = () => toasts()[0]?.textContent || null;
  return { document, clock, send, notify, toasts, toastText };
}

test("a shortcut's notice says the new state, where screen readers announce it", async (t) => {
  const { notify, toasts, toastText } = await setup(t);
  const said = [];
  for (const key of ["topicFilter", "hideShorts"]) {
    for (const value of [true, false]) {
      notify({ key, value });
      said.push(toastText());
    }
  }
  assert.deepEqual(said, [
    "Filter recommendations is on",
    "Filter recommendations is off",
    "Hide Shorts is on",
    "Hide Shorts is off",
  ]);
  assert.equal(toasts()[0].getAttribute("role"), "status");
});

test("the message speaks the extension's language and direction, not YouTube's", async (t) => {
  const { document, notify, toasts } = await setup(t, { locale: "ar" });
  document.documentElement.lang = "en";
  document.documentElement.dir = "ltr";
  notify({ key: "hideShorts", value: true });
  const [toast] = toasts();
  assert.deepEqual({ lang: toast.lang, dir: toast.dir }, { lang: "ar", dir: "rtl" });
});

test("a newer message replaces the one on screen", async (t) => {
  const { clock, notify, toasts, toastText } = await setup(t);
  notify({ key: "hideShorts", value: true });
  await clock.tickAsync(TOAST_MS - 1000);

  notify({ key: "hideShorts", value: false });

  assert.equal(toasts().length, 1);
  assert.equal(toastText(), "Hide Shorts is off");
  await clock.tickAsync(TOAST_MS - 1);
  assert.equal(toastText(), "Hide Shorts is off", "the newer message gets its own few seconds");
  await clock.tickAsync(1);
  assert.equal(toastText(), null);
});

test("ignores notices it doesn't know", async (t) => {
  const { send, notify, toastText } = await setup(t);
  notify({ key: "topics", value: true });
  notify({ key: "hideShorts", value: "on" });
  send({ type: "better-yt:other", key: "hideShorts", value: true });
  assert.equal(toastText(), null);
});
