import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { fakeChrome, flush, runScripts } from "./helpers.js";

// Loads settings.js the way every part of the extension does, over a sync store holding stored.
function loadSettings(stored = {}) {
  const chrome = fakeChrome({ stored });
  const context = vm.createContext({ chrome });
  runScripts(context, ["src/settings.js"]);
  return { settings: context.BetterYT.settings, chrome };
}

// Records each batch of changes that settings.subscribe delivers.
function subscribed(settings) {
  const received = [];
  settings.subscribe((changes) => received.push({ ...changes }));
  return received;
}

test("reads every default from an empty store", async () => {
  const { settings } = loadSettings();
  assert.deepEqual({ ...(await settings.load()) }, { ...settings.DEFAULTS });
});

test("reads a sensitivity as the nearest value the slider can show", async () => {
  for (const [stored, expected] of [
    [0.9, 0.4],
    [0.01, 0.1],
    [0.333, 0.33],
  ]) {
    const { settings } = loadSettings({ threshold: stored });
    assert.equal((await settings.load()).threshold, expected, `threshold ${stored}`);
  }
});

test("reads values of the wrong type as their defaults", async () => {
  const { settings } = loadSettings({ threshold: "abc", topics: 42, hideShorts: "yes" });
  const values = await settings.load();
  assert.deepEqual(
    { threshold: values.threshold, topics: values.topics, hideShorts: values.hideShorts },
    { threshold: 0.25, topics: "", hideShorts: false },
  );
});

test("reports a change from another device within bounds", async () => {
  const { settings, chrome } = loadSettings({ topics: "chess" });
  const received = subscribed(settings);
  await chrome.storage.sync.set({ threshold: 0.9 });
  await chrome.storage.sync.remove("topics");
  await flush();
  assert.deepEqual(received, [{ threshold: 0.4 }, { topics: "" }]);
});

test("ignores settings this version doesn't know", async () => {
  const { settings, chrome } = loadSettings({ somethingNewer: true });
  assert.equal(Object.hasOwn(await settings.load(), "somethingNewer"), false);
  const received = subscribed(settings);
  await chrome.storage.sync.set({ somethingNewer: false, enforce: true });
  await chrome.storage.sync.set({ somethingNewer: true });
  await flush();
  assert.deepEqual(received, [{ enforce: true }]);
});
