import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { WORK, channelNames, fakeChrome, flush, manyProfiles, runScripts } from "./helpers.js";

// Loads settings.js the way every part of the extension does, over a sync store holding stored.
// settings.save measures values in bytes, and a bare context has no TextEncoder.
function loadSettings(stored = {}) {
  const chrome = fakeChrome({ stored });
  const context = vm.createContext({ chrome, TextEncoder });
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

test("reads each match line as the nearest value its slider can show", async () => {
  for (const [key, stored, expected] of [
    ["threshold", 0.9, 0.4],
    ["threshold", 0.01, 0.1],
    ["threshold", 0.333, 0.33],
    ["avoidThreshold", 0.9, 0.4],
    ["avoidThreshold", 0.287, 0.29],
  ]) {
    const { settings } = loadSettings({ [key]: stored });
    assert.equal((await settings.load())[key], expected, `${key} ${stored}`);
  }
});

test("reads values of the wrong type as their defaults", async () => {
  const { settings } = loadSettings({ threshold: "abc", avoidThreshold: null, topics: 42, hideShorts: "yes" });
  const { threshold, avoidThreshold, topics, hideShorts } = await settings.load();
  assert.deepEqual({ threshold, avoidThreshold, topics, hideShorts }, { threshold: 0.25, avoidThreshold: 0.24, topics: "", hideShorts: false });
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

test("refuses to save a value larger than Chrome sync can hold, and saves nothing", async () => {
  const { settings, chrome } = loadSettings({ topics: "chess" });
  // Each of these characters takes 3 bytes, so 50 names of 100 come to about 15,000 bytes.
  const blockedChannels = Array.from({ length: 50 }, () => "频".repeat(100));
  await assert.rejects(settings.save({ topics: "cooking", blockedChannels }), { code: settings.QUOTA_ERROR, key: "blockedChannels" });
  assert.deepEqual({ ...chrome.data }, { topics: "chess" });
});

test("reads a channel list from another device within bounds", async () => {
  const stored = channelNames(60);
  const { settings } = loadSettings({ allowedChannels: ["y".repeat(120), 42, null, ...stored], blockedChannels: "MrBeast" });
  const values = await settings.load();
  assert.deepEqual(structuredClone(values.allowedChannels), ["y".repeat(100), ...stored.slice(0, 49)]);
  assert.deepEqual(structuredClone(values.blockedChannels), []);
});

test("every read gets its own list", async () => {
  const failing = loadSettings();
  failing.chrome.storage.sync.get = async () => {
    throw new Error("Sync is unavailable.");
  };
  for (const { settings } of [loadSettings(), failing]) {
    (await settings.load()).blockedChannels.push("MrBeast");
    assert.deepEqual(structuredClone((await settings.load()).blockedChannels), []);
  }
});

test("reads profiles from another device within bounds, dropping those without a name", async () => {
  const { settings } = loadSettings({
    profiles: [
      null,
      "Work",
      { name: "  ", topics: "", avoidTopics: "" },
      { name: `${" ".repeat(30)}x`, topics: "", avoidTopics: "" },
      { name: "w".repeat(40), topics: "t".repeat(600), avoidTopics: 42, threshold: 0.9, avoidThreshold: 0.287, extra: true },
      WORK,
      ...manyProfiles(8),
    ],
  });
  const { profiles } = await settings.load();
  assert.equal(profiles.length, 8);
  assert.deepEqual(structuredClone(profiles.slice(0, 2)), [
    { name: "w".repeat(30), topics: "t".repeat(500), avoidTopics: "", threshold: 0.4, avoidThreshold: 0.29 },
    WORK,
  ]);
});

test("forgets a selected profile that no longer exists", async () => {
  const { settings } = loadSettings({ profiles: [WORK], activeProfile: "Evening" });
  assert.equal((await settings.load()).activeProfile, "");
});

test("keeps a selected profile whose name differs only in case or spacing", async () => {
  const { settings } = loadSettings({ profiles: [WORK], activeProfile: "work " });
  assert.equal((await settings.load()).activeProfile, "work ");
});
