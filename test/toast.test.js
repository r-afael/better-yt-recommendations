import assert from "node:assert/strict";
import test from "node:test";
import { openYouTube } from "./helpers.js";

const TOAST_MS = 3000;

// A blank YouTube page with every content script, which the background tells what a keyboard
// shortcut changed.
async function setup(t) {
  const { window, document, chrome, clock } = await openYouTube(t, { fixture: "", path: "/feed/history" });
  const { NOTICE } = window.BetterYT.protocol;
  const send = (message) => chrome.runtime.onMessage.dispatch(message, { id: "better-yt" }, () => {});
  const notify = (notice) => send({ type: NOTICE, ...notice });
  const toasts = () => [...document.querySelectorAll(".better-yt-toast")];
  // The message shown at the bottom of the page, or null while none is.
  const toastText = () => {
    const [toast] = toasts();
    return toast && window.getComputedStyle(toast).display !== "none" ? toast.textContent : null;
  };
  return { clock, send, notify, toasts, toastText };
}

test("a shortcut's notice says the new state", async (t) => {
  const { notify, toastText } = await setup(t);
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
