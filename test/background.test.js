import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { fakeChrome, flush, readJson, runScripts } from "./helpers.js";

const OFFSCREEN_URL = "chrome-extension://better-yt/src/offscreen.html";
const MISSING_RECEIVER = "Could not establish connection. Receiving end does not exist.";
const CHANNEL_CLOSED = "A listener indicated an asynchronous response by returning true, " +
  "but the message channel closed before a response was received";
const VIDEOS = [{ id: "abc123def45", title: "Rust ownership explained", channel: "Code Talks" }];
const MATCHED = { want: 1, avoid: null };
const MATCH_ANSWER = { scores: { abc123def45: MATCHED } };

// Objects made inside the vm have their own prototypes, so compare their data only.
const plain = (value) => JSON.parse(JSON.stringify(value));

// Adds the offscreen and context APIs, backed by one document that is open or not, like Chrome.
function fakeOffscreen(chrome) {
  const state = { open: false, created: [], closed: 0, forwarded: [] };
  chrome.runtime.getContexts = async ({ contextTypes, documentUrls }) => {
    const matches = state.open && contextTypes.includes("OFFSCREEN_DOCUMENT") && documentUrls.includes(OFFSCREEN_URL);
    return matches ? [{ contextType: "OFFSCREEN_DOCUMENT", documentUrl: OFFSCREEN_URL }] : [];
  };
  chrome.offscreen = {
    async createDocument(parameters) {
      if (state.open) throw new Error("Only a single offscreen document may be created.");
      state.created.push(parameters);
      state.open = true;
    },
    async closeDocument() {
      if (!state.open) throw new Error("No current offscreen document.");
      state.open = false;
      state.closed += 1;
    },
  };
  return state;
}

// The offscreen document's usual answer: every video matches a wanted topic perfectly.
function answerMatches(message) {
  return { scores: Object.fromEntries(message.videos.map((video) => [video.id, MATCHED])) };
}

function setup({ stored = { topics: "programming" }, answer = answerMatches } = {}) {
  const chrome = fakeChrome({ stored });
  const offscreen = fakeOffscreen(chrome);
  // Like Chrome, a message sent while no document is open reaches no receiver.
  chrome.runtime.sendMessage = async (message) => {
    if (!offscreen.open) throw new Error(MISSING_RECEIVER);
    offscreen.forwarded.push(plain(message));
    return answer(message, offscreen);
  };
  // settings.save measures values in bytes, and a bare context has no TextEncoder.
  const context = vm.createContext({ chrome, TextEncoder });
  context.importScripts = (...names) => runScripts(context, names.map((name) => `src/${name}`));
  runScripts(context, ["src/background.js"]);
  const { protocol } = context.BetterYT;

  // Delivers a message the way Chrome does and resolves with the answer, if any.
  function send(message, sender = { tab: { id: 1 } }) {
    return new Promise((resolve) => {
      const [keepsChannelOpen] = chrome.runtime.onMessage.dispatch(message, sender, resolve);
      if (!keepsChannelOpen) resolve(undefined);
    });
  }

  // Delivers a message from the offscreen document, such as the model's status.
  const fromModel = (message) => send(message, { url: OFFSCREEN_URL });
  const match = () => send({ type: protocol.MATCH, topics: ["programming"], avoidTopics: [], videos: VIDEOS });
  const status = () => plain(chrome.storage.session.data[protocol.STATUS_KEY]);
  // Delivers a keyboard shortcut the way Chrome does, with the tab it was pressed in, and waits
  // for what it does. Leaving the tab out presses in tab 1; an undefined tab is no tab at all.
  const press = (command, ...tab) => chrome.commands.onCommand.dispatch(command, ...(tab.length > 0 ? tab : [{ id: 1 }]))[0];
  return { chrome, offscreen, protocol, send, fromModel, match, status, press };
}

test("forwards matching requests to the offscreen document and relays its answer", async () => {
  const { offscreen, protocol, match } = setup();

  const answer = await match();

  assert.deepEqual(answer, MATCH_ANSWER);
  assert.deepEqual(offscreen.forwarded, [
    { type: protocol.MATCH, topics: ["programming"], avoidTopics: [], videos: VIDEOS, target: protocol.OFFSCREEN },
  ]);
  assert.deepEqual(plain(offscreen.created), [{
    url: "src/offscreen.html",
    reasons: ["WORKERS"],
    justification: "Runs the topic-matching AI model in a web worker.",
  }]);
});

test("concurrent requests share one offscreen document", async () => {
  const { offscreen, match } = setup();

  const answers = await Promise.all([match(), match(), match()]);

  assert.equal(offscreen.created.length, 1);
  assert.equal(answers.filter((answer) => answer.scores).length, 3);
});

// Chrome's errors when the document closed before the request arrived, and while handling it.
for (const [moment, error] of [["before the request arrived", MISSING_RECEIVER], ["before answering", CHANNEL_CLOSED]]) {
  test(`reopens the document and retries once when it closed ${moment}`, async () => {
    let attempts = 0;
    const { offscreen, match } = setup({
      answer(message, state) {
        attempts += 1;
        if (attempts > 1) return answerMatches(message);
        state.open = false;
        throw new Error(error);
      },
    });

    const answer = await match();

    assert.deepEqual(answer, MATCH_ANSWER);
    assert.equal(offscreen.created.length, 2);
  });
}

// Holds the first answer until the test settles it, so the document can close mid-request.
function pendingFirstAnswer() {
  const first = Promise.withResolvers();
  let attempts = 0;
  const answer = (message) => {
    attempts += 1;
    return attempts === 1 ? first.promise : answerMatches(message);
  };
  return { answer, closeChannel: () => first.reject(new Error(CHANNEL_CLOSED)) };
}

test("a request answered as the model goes idle reopens the document", async () => {
  const pending = pendingFirstAnswer();
  const { offscreen, protocol, fromModel, match } = setup({ answer: pending.answer });
  const answer = match();
  await flush();

  await fromModel({ type: protocol.IDLE });
  await flush();
  pending.closeChannel();

  assert.deepEqual(await answer, MATCH_ANSWER);
  assert.equal(offscreen.open, true);
  assert.equal(offscreen.created.length, 2);
});

test("turning the topic filter off mid-request keeps the model freed", async () => {
  const pending = pendingFirstAnswer();
  const { chrome, offscreen, match, status } = setup({ answer: pending.answer });
  const answer = match();
  await flush();

  await chrome.storage.sync.set({ topicFilter: false });
  await flush();
  pending.closeChannel();

  assert.deepEqual(plain(await answer), { error: CHANNEL_CLOSED });
  await flush();
  assert.equal(offscreen.open, false);
  assert.equal(offscreen.created.length, 1);
  assert.deepEqual(status(), { state: "idle" });
});

test("answers with an error when the retry fails too", async () => {
  const { offscreen, match } = setup({
    answer() {
      throw new Error(MISSING_RECEIVER);
    },
  });

  const answer = await match();

  assert.deepEqual(plain(answer), { error: MISSING_RECEIVER });
  assert.equal(offscreen.forwarded.length, 2);
});

test("answers other forwarding errors without retrying", async () => {
  const { offscreen, match } = setup({
    answer() {
      throw new Error("Message too large.");
    },
  });

  const answer = await match();

  assert.deepEqual(plain(answer), { error: "Message too large." });
  assert.equal(offscreen.forwarded.length, 1);
});

test("answers with an error when the offscreen document sends no answer", async () => {
  const { match } = setup({ answer: () => undefined });

  const answer = await match();

  assert.equal(typeof answer.error, "string");
});

test("stores the model status for the popup while the model's document is open", async () => {
  const { protocol, fromModel, match, status } = setup();
  await match();

  const answer = await fromModel({ type: protocol.STATUS, status: { state: protocol.MODEL_STATES.LOADING, progress: 0.4 } });
  await flush();

  assert.equal(answer, undefined);
  assert.deepEqual(status(), { state: "loading", progress: 0.4 });
});

test("a status that arrives after the model was freed leaves it idle", async () => {
  const { protocol, fromModel, match, status } = setup();
  await match();
  await fromModel({ type: protocol.IDLE });
  await flush();

  await fromModel({ type: protocol.STATUS, status: { state: protocol.MODEL_STATES.LOADING, progress: 0.4 } });
  await flush();

  assert.deepEqual(status(), { state: "idle" });
});

// Holds the next context check, which still sees the document as it was when asked, until the
// returned function lets it answer.
function holdNextCheck(chrome) {
  const { getContexts } = chrome.runtime;
  const held = Promise.withResolvers();
  chrome.runtime.getContexts = async (filter) => {
    chrome.runtime.getContexts = getContexts;
    const contexts = await getContexts(filter);
    await held.promise;
    return contexts;
  };
  return held.resolve;
}

test("a status still being checked as the model is freed leaves it idle", async () => {
  const { chrome, protocol, fromModel, match, status } = setup();
  await match();
  const answerCheck = holdNextCheck(chrome);

  fromModel({ type: protocol.STATUS, status: { state: protocol.MODEL_STATES.LOADING, progress: 0.4 } });
  fromModel({ type: protocol.IDLE });
  await flush();
  answerCheck();
  await flush();

  assert.deepEqual(status(), { state: "idle" });
});

test("ignores a model status or idle report from anywhere but the offscreen document", async () => {
  const { offscreen, protocol, send, fromModel, match, status } = setup();
  await match();
  await fromModel({ type: protocol.STATUS, status: { state: protocol.MODEL_STATES.READY } });
  await flush();

  await send({ type: protocol.STATUS, status: { state: protocol.MODEL_STATES.ERROR } });
  await send({ type: protocol.IDLE });
  await flush();

  assert.deepEqual(status(), { state: "ready" });
  assert.equal(offscreen.open, true);
});

test("Load now opens the document and forwards the preload", async () => {
  const { offscreen, protocol, send } = setup({ answer: () => ({ ok: true }) });

  const answer = await send({ type: protocol.PRELOAD });

  assert.deepEqual(answer, { ok: true });
  assert.equal(offscreen.created.length, 1);
  assert.deepEqual(offscreen.forwarded, [{ type: protocol.PRELOAD, target: protocol.OFFSCREEN }]);
});

// chrome.storage.onChanged also reports changes synced in from the user's other computers.
test("a settings change alone never loads the model", async () => {
  const { chrome, offscreen } = setup({ stored: { topics: "" } });

  await chrome.storage.sync.set({ topics: "chess" });
  await flush();

  assert.equal(offscreen.created.length, 0);
  assert.deepEqual(offscreen.forwarded, []);
});

test("closes the offscreen document when the model goes idle", async () => {
  const { offscreen, protocol, fromModel, match, status } = setup();
  await match();

  await fromModel({ type: protocol.IDLE });
  await flush();

  assert.equal(offscreen.open, false);
  assert.deepEqual(status(), { state: "idle" });
});

test("closing when no document is open is harmless", async () => {
  const { offscreen, protocol, fromModel, status } = setup();

  await fromModel({ type: protocol.IDLE });
  await flush();

  assert.equal(offscreen.closed, 0);
  assert.deepEqual(status(), { state: "idle" });
});

test("turning the topic filter off frees the model", async () => {
  const { chrome, offscreen, match, status } = setup();
  await match();

  await chrome.storage.sync.set({ topicFilter: false });
  await flush();

  assert.equal(offscreen.open, false);
  assert.deepEqual(status(), { state: "idle" });
});

test("clearing the topics frees the model", async () => {
  const { chrome, offscreen, match } = setup();
  await match();

  await chrome.storage.sync.set({ topics: " , ;" });
  await flush();

  assert.equal(offscreen.open, false);
});

test("clearing the topics keeps the model while topics to avoid remain", async () => {
  const { chrome, offscreen, match } = setup({ stored: { topics: "programming", avoidTopics: "gaming" } });
  await match();

  await chrome.storage.sync.set({ topics: "" });
  await flush();

  assert.equal(offscreen.open, true);
});

test("clearing both lists frees the model", async () => {
  const { chrome, offscreen, match, status } = setup({ stored: { topics: "programming", avoidTopics: "gaming" } });
  await match();

  await chrome.storage.sync.set({ topics: "", avoidTopics: " , " });
  await flush();

  assert.equal(offscreen.open, false);
  assert.deepEqual(status(), { state: "idle" });
});

test("a change that also carries a setting this version doesn't know still frees the model", async () => {
  const { chrome, offscreen, match } = setup();
  await match();

  await chrome.storage.sync.set({ topics: "", somethingNewer: 1 });
  await flush();

  assert.equal(offscreen.open, false);
});

test("changing to other topics keeps the model loaded", async () => {
  const { chrome, offscreen, match } = setup();
  await match();

  await chrome.storage.sync.set({ topics: "chess, cooking", topicFilter: true });
  await flush();

  assert.equal(offscreen.open, true);
});

test("ignores messages meant for the offscreen document", async () => {
  const { offscreen, protocol, send } = setup();

  const answer = await send({ type: protocol.MATCH, topics: ["chess"], avoidTopics: [], videos: VIDEOS, target: protocol.OFFSCREEN });

  assert.equal(answer, undefined);
  assert.deepEqual(offscreen.forwarded, []);
  assert.equal(offscreen.created.length, 0);
});

test("shows the hidden count on the badge of the tab that reports it", async () => {
  const { chrome, protocol, send } = setup();

  await send({ type: protocol.HIDDEN_COUNT, count: 7 }, { tab: { id: 1 } });
  await send({ type: protocol.HIDDEN_COUNT, count: 0 }, { tab: { id: 2 } });
  await send({ type: protocol.HIDDEN_COUNT, count: 120 }, { tab: { id: 3 } });
  await flush();

  assert.deepEqual(plain(chrome.badges), {
    1: { text: "7", color: "#606060" },
    2: { text: "", color: "#606060" },
    3: { text: "99+", color: "#606060" },
  });
});

test("ignores hidden counts from pages without a tab", async () => {
  const { chrome, protocol, send } = setup();

  await send({ type: protocol.HIDDEN_COUNT, count: 7 }, {});
  await flush();

  assert.deepEqual(chrome.badges, {});
});

// The menu shows where the content script that answers it runs.
const YOUTUBE_PAGES = readJson("manifest.json").content_scripts.find((entry) => entry.js.includes("src/channel-menu.js")).matches;
const CARD_LINKS = ["https://*.youtube.com/watch*", "https://*.youtube.com/@*", "https://*.youtube.com/channel/*"];
const VIDEO_LINK = "https://www.youtube.com/watch?v=PkZNo7MFNFg";

test("creates both menu entries for video links on YouTube when installed", () => {
  const { chrome, protocol } = setup();

  chrome.runtime.onInstalled.dispatch({ reason: "install" });

  const onVideoLinks = { contexts: ["link"], documentUrlPatterns: YOUTUBE_PAGES, targetUrlPatterns: CARD_LINKS };
  assert.deepEqual(plain([...chrome.menus.values()]), [
    { id: protocol.MENU_ALLOW_CHANNEL, title: "Never hide this channel", ...onVideoLinks },
    { id: protocol.MENU_BLOCK_CHANNEL, title: "Always hide this channel", ...onVideoLinks },
  ]);
});

// Chrome keeps an extension's menu entries when it updates, and creating one again fails.
test("an update replaces the previous version's entries, without unchecked errors", () => {
  const { chrome, protocol } = setup();
  chrome.menus.set(protocol.MENU_ALLOW_CHANNEL, { id: protocol.MENU_ALLOW_CHANNEL, title: "Old title" });
  chrome.menus.set("better-yt:retired-entry", { id: "better-yt:retired-entry", title: "Retired entry" });

  chrome.runtime.onInstalled.dispatch({ reason: "update", previousVersion: "1.3.0" });

  assert.deepEqual(plain([...chrome.menus.values()].map(({ id, title }) => ({ id, title }))), [
    { id: protocol.MENU_ALLOW_CHANNEL, title: "Never hide this channel" },
    { id: protocol.MENU_BLOCK_CHANNEL, title: "Always hide this channel" },
  ]);
  assert.deepEqual(chrome.uncheckedErrors, []);
});

test("a menu click asks the clicked tab and frame to list the channel, with the clicked link", async () => {
  const { chrome, protocol } = setup();

  chrome.contextMenus.onClicked.dispatch({ menuItemId: protocol.MENU_BLOCK_CHANNEL, linkUrl: VIDEO_LINK, frameId: 3 }, { id: 7 });
  chrome.contextMenus.onClicked.dispatch({ menuItemId: protocol.MENU_ALLOW_CHANNEL, linkUrl: VIDEO_LINK }, { id: 8 });
  await flush();

  assert.deepEqual(plain(chrome.tabMessages), [
    { tabId: 7, message: { type: protocol.LIST_CHANNEL, list: "blockedChannels", linkUrl: VIDEO_LINK }, options: { frameId: 3 } },
    { tabId: 8, message: { type: protocol.LIST_CHANNEL, list: "allowedChannels", linkUrl: VIDEO_LINK }, options: { frameId: 0 } },
  ]);
});

test("ignores clicks on other menu entries and clicks without a tab", async () => {
  const { chrome, protocol } = setup();

  chrome.contextMenus.onClicked.dispatch({ menuItemId: "another-extension-entry", linkUrl: VIDEO_LINK, frameId: 0 }, { id: 7 });
  chrome.contextMenus.onClicked.dispatch({ menuItemId: protocol.MENU_BLOCK_CHANNEL, linkUrl: VIDEO_LINK, frameId: 0 });
  await flush();

  assert.deepEqual(chrome.tabMessages, []);
});

// Picking an entry in a tab whose content script hasn't loaded yet can't reach it. node:test fails
// a test that leaves the rejection unhandled.
test("a menu click on a tab without the content script fails quietly", async () => {
  const { chrome, protocol } = setup();
  const tried = [];
  chrome.tabs.sendMessage = async (tabId) => {
    tried.push(tabId);
    throw new Error(MISSING_RECEIVER);
  };

  chrome.contextMenus.onClicked.dispatch({ menuItemId: protocol.MENU_BLOCK_CHANNEL, linkUrl: VIDEO_LINK, frameId: 0 }, { id: 7 });
  await flush();

  assert.deepEqual(tried, [7]);
});

// The notices the background sent each tab, outside the vm's realm.
const notices = (chrome) => plain(chrome.tabMessages);

test("the filter shortcut turns Filter recommendations off and back on", async () => {
  const { chrome, protocol, press } = setup();

  await press(protocol.COMMAND_TOGGLE_FILTER);
  assert.equal(chrome.data.topicFilter, false);

  await press(protocol.COMMAND_TOGGLE_FILTER);
  assert.equal(chrome.data.topicFilter, true);
});

test("the Shorts shortcut turns Hide Shorts on", async () => {
  const { chrome, protocol, press } = setup();

  await press(protocol.COMMAND_TOGGLE_SHORTS);

  assert.equal(chrome.data.hideShorts, true);
});

test("two presses in a row end where they started", async () => {
  const { chrome, protocol, press } = setup();

  await Promise.all([press(protocol.COMMAND_TOGGLE_SHORTS), press(protocol.COMMAND_TOGGLE_SHORTS)]);

  assert.equal(chrome.data.hideShorts, false);
  assert.deepEqual(notices(chrome).map(({ message }) => message.value), [true, false]);
});

test("a shortcut tells the tab it was pressed in what changed", async () => {
  const { chrome, protocol, press } = setup();

  await press(protocol.COMMAND_TOGGLE_SHORTS);
  await press(protocol.COMMAND_TOGGLE_FILTER, { id: 2 });

  assert.deepEqual(notices(chrome), [
    { tabId: 1, message: { type: protocol.NOTICE, key: "hideShorts", value: true } },
    { tabId: 2, message: { type: protocol.NOTICE, key: "topicFilter", value: false } },
  ]);
});

// Chrome passes no tab when no browser window has focus.
test("a shortcut still works without a tab", async () => {
  const { chrome, protocol, press } = setup();

  await press(protocol.COMMAND_TOGGLE_SHORTS, undefined);

  assert.equal(chrome.data.hideShorts, true);
  assert.deepEqual(chrome.tabMessages, []);
});

// Chrome refuses a message to a tab without the content script, such as one that isn't YouTube.
// node:test fails a test that leaves the rejection unhandled.
test("a shortcut pressed on a page that isn't YouTube fails quietly", async () => {
  const { chrome, protocol, press } = setup();
  chrome.tabs.sendMessage = async () => {
    throw new Error(MISSING_RECEIVER);
  };

  await press(protocol.COMMAND_TOGGLE_SHORTS);
  await flush();

  assert.equal(chrome.data.hideShorts, true);
});

test("a shortcut whose save fails tells the tab nothing", async () => {
  const { chrome, protocol, press } = setup();
  chrome.storage.sync.set = async () => {
    throw new Error("MAX_WRITE_OPERATIONS_PER_MINUTE quota exceeded");
  };

  await press(protocol.COMMAND_TOGGLE_SHORTS);

  assert.equal("hideShorts" in chrome.data, false);
  assert.deepEqual(chrome.tabMessages, []);
});

test("turning the filter on by shortcut with topics set loads the model", async () => {
  const { offscreen, protocol, press } = setup({
    stored: { topics: "programming", topicFilter: false },
    answer: () => ({ ok: true }),
  });

  await press(protocol.COMMAND_TOGGLE_FILTER);
  await flush();

  assert.deepEqual(offscreen.forwarded, [{ type: protocol.PRELOAD, target: protocol.OFFSCREEN }]);
});

test("turning the filter on by shortcut without topics doesn't load the model", async () => {
  const { offscreen, protocol, press } = setup({ stored: { topics: "", topicFilter: false } });

  await press(protocol.COMMAND_TOGGLE_FILTER);
  await flush();

  assert.equal(offscreen.created.length, 0);
  assert.deepEqual(offscreen.forwarded, []);
});

test("turning Hide Shorts on by shortcut doesn't load the model", async () => {
  const { offscreen, protocol, press } = setup();

  await press(protocol.COMMAND_TOGGLE_SHORTS);
  await flush();

  assert.equal(offscreen.created.length, 0);
  assert.deepEqual(offscreen.forwarded, []);
});

test("ignores unknown commands", async () => {
  const { chrome, press } = setup();

  await press("another-command");

  assert.equal("topicFilter" in chrome.data, false);
  assert.equal("hideShorts" in chrome.data, false);
  assert.deepEqual(chrome.tabMessages, []);
});

// What the background asked Chrome to do with the Shorts redirect rule, outside the vm's realm.
const rulesetCalls = (chrome) => plain(chrome.rulesetCalls);

test("turning Hide Shorts on enables the redirect, and turning it off disables it", async () => {
  const { chrome, protocol } = setup();

  await chrome.storage.sync.set({ hideShorts: true });
  await flush();
  await chrome.storage.sync.set({ hideShorts: false });
  await flush();

  assert.deepEqual(rulesetCalls(chrome), [
    { enableRulesetIds: [protocol.SHORTS_RULESET] },
    { disableRulesetIds: [protocol.SHORTS_RULESET] },
  ]);
});

// Chrome turns the rule off on every update, and Hide Shorts may have changed on another
// computer while Chrome was closed.
test("matches the redirect to the stored setting when the extension updates and when Chrome starts", async () => {
  const { chrome, protocol } = setup({ stored: { hideShorts: true } });

  chrome.runtime.onInstalled.dispatch({ reason: "update" });
  await flush();
  chrome.data.hideShorts = false;
  chrome.runtime.onStartup.dispatch();
  await flush();

  assert.deepEqual(rulesetCalls(chrome), [
    { enableRulesetIds: [protocol.SHORTS_RULESET] },
    { disableRulesetIds: [protocol.SHORTS_RULESET] },
  ]);
});
