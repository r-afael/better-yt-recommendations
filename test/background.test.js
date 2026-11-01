import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { fakeChrome, flush, runScripts } from "./helpers.js";

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
  const context = vm.createContext({ chrome });
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

  const match = () => send({ type: protocol.MATCH, topics: ["programming"], avoidTopics: [], videos: VIDEOS });
  const status = () => plain(chrome.storage.session.data[protocol.STATUS_KEY]);
  return { chrome, offscreen, protocol, send, match, status };
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
  const { offscreen, protocol, send, match } = setup({ answer: pending.answer });
  const answer = match();
  await flush();

  await send({ type: protocol.IDLE });
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
  const { protocol, send, match, status } = setup();
  await match();

  const answer = await send({ type: protocol.STATUS, status: { state: protocol.MODEL_STATES.LOADING, progress: 0.4 } });
  await flush();

  assert.equal(answer, undefined);
  assert.deepEqual(status(), { state: "loading", progress: 0.4 });
});

test("a status that arrives after the model was freed leaves it idle", async () => {
  const { protocol, send, match, status } = setup();
  await match();
  await send({ type: protocol.IDLE });
  await flush();

  await send({ type: protocol.STATUS, status: { state: protocol.MODEL_STATES.LOADING, progress: 0.4 } });
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
  const { chrome, protocol, send, match, status } = setup();
  await match();
  const answerCheck = holdNextCheck(chrome);

  send({ type: protocol.STATUS, status: { state: protocol.MODEL_STATES.LOADING, progress: 0.4 } });
  send({ type: protocol.IDLE });
  await flush();
  answerCheck();
  await flush();

  assert.deepEqual(status(), { state: "idle" });
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
  const { offscreen, protocol, send, match, status } = setup();
  await match();

  await send({ type: protocol.IDLE });
  await flush();

  assert.equal(offscreen.open, false);
  assert.deepEqual(status(), { state: "idle" });
});

test("closing when no document is open is harmless", async () => {
  const { offscreen, protocol, send, status } = setup();

  await send({ type: protocol.IDLE });
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
