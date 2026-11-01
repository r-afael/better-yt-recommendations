import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import FakeTimers from "@sinonjs/fake-timers";
import { JSDOM } from "jsdom";
import { fakeChrome, flush, read, runScripts } from "./helpers.js";

const MATCH = "better-yt:match";
const IDLE_MS = 1_000;
const LOADING = (progress) => ({ state: "loading", progress });
const READY = { state: "ready" };
const ERROR = { state: "error" };

// Values from the scripts' realm are copied so deep comparisons only look at their contents.
const plain = (value) => JSON.parse(JSON.stringify(value));
const request = (topics = ["chess"], videos = [{ id: "a", title: "chess", channel: "" }]) =>
  ({ type: MATCH, topics, videos });

function createContext(globals = {}) {
  const clock = FakeTimers.createClock();
  const context = vm.createContext({ setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, ...globals });
  return { clock, context };
}

// A service whose model loads only when the test calls finishLoading() or failLoading().
function setup() {
  const { clock, context } = createContext();
  runScripts(context, ["src/protocol.js", "src/offscreen.js"]);
  const state = { loads: 0, statuses: [], idles: 0, onProgress: null, loading: null };
  const service = context.BetterYT.offscreen.createService({
    loadModel: ({ onProgress }) => {
      state.loads += 1;
      state.onProgress = onProgress;
      state.loading = Promise.withResolvers();
      return state.loading.promise;
    },
    // Scores 1 the videos whose title is one of the topics, and 0 the others.
    createMatcher: () => ({
      score: async (topics, videos) => Object.fromEntries(videos.map(({ id, title }) => [id, Number(topics.includes(title))])),
    }),
    report: (status) => state.statuses.push(plain(status)),
    onIdle: () => {
      state.idles += 1;
    },
    idleMs: IDLE_MS,
  });
  const handle = async (message) => plain(await service.handle(message));
  const finishLoading = async () => {
    state.loading.resolve(() => []);
    await flush();
  };
  const failLoading = async (error) => {
    state.loading.reject(error);
    await flush();
  };
  return { clock, state, handle, finishLoading, failLoading };
}

test("loads the model once for concurrent requests and answers each of them", async () => {
  const { state, handle, finishLoading } = setup();
  const first = handle(request(["chess"]));
  const second = handle(request(["cooking"]));
  await finishLoading();

  assert.deepEqual(await first, { scores: { a: 1 } });
  assert.deepEqual(await second, { scores: { a: 0 } });
  assert.equal(state.loads, 1);
  assert.deepEqual(state.statuses, [LOADING(0), READY]);
});

test("reports loading progress only when the whole percent changes", async () => {
  const { state, handle, finishLoading } = setup();
  const answer = handle(request());
  for (const fraction of [0.004, 0.011, 0.019, 0.5, 0.505, 1]) state.onProgress(fraction);
  await finishLoading();
  await answer;

  assert.deepEqual(state.statuses, [LOADING(0), LOADING(0.01), LOADING(0.5), LOADING(1), READY]);
});

test("reports a failed load and tries again on the next request", async () => {
  const { state, handle, finishLoading, failLoading } = setup();
  const failed = handle(request());
  await failLoading(new Error("Network error"));
  assert.deepEqual(await failed, { error: "Network error" });

  const retried = handle(request());
  await finishLoading();
  assert.deepEqual(await retried, { scores: { a: 1 } });
  assert.equal(state.loads, 2);
  assert.deepEqual(state.statuses, [LOADING(0), ERROR, LOADING(0), READY]);
});

test("answers with an error when matching fails", async () => {
  const { context } = createContext();
  runScripts(context, ["src/protocol.js", "src/offscreen.js"]);
  const service = context.BetterYT.offscreen.createService({
    loadModel: async () => () => [],
    createMatcher: () => ({ score: () => Promise.reject(new Error("Out of memory")) }),
    report: () => {},
    onIdle: () => {},
  });

  assert.deepEqual(plain(await service.handle(request())), { error: "Out of memory" });
});

test("rejects malformed requests without loading the model", async () => {
  const { state, handle } = setup();
  const video = { id: "a", title: "chess", channel: "" };
  const malformed = [
    null,
    { ...request(), type: "better-yt:other" },
    { ...request(), topics: "chess" },
    { ...request(), topics: ["chess", 1] },
    { ...request(), videos: undefined },
    { ...request(), videos: [null] },
    { ...request(), videos: [{ ...video, channel: undefined }] },
  ];

  for (const message of malformed) {
    const answer = await handle(message);
    assert.equal(typeof answer.error, "string", JSON.stringify(message));
  }
  assert.equal(state.loads, 0);
});

test("says it is idle once, after no request has arrived for the idle time", async () => {
  const { clock, state, handle, finishLoading } = setup();
  const answer = handle(request());
  await finishLoading();
  await answer;

  clock.tick(IDLE_MS - 1);
  assert.equal(state.idles, 0);
  clock.tick(1);
  assert.equal(state.idles, 1);
  clock.tick(IDLE_MS * 10);
  assert.equal(state.idles, 1);
});

test("restarts the idle time with each request", async () => {
  const { clock, state, handle, finishLoading } = setup();
  const answer = handle(request());
  await finishLoading();
  await answer;

  clock.tick(IDLE_MS - 1);
  await handle(request());
  clock.tick(IDLE_MS - 1);
  assert.equal(state.idles, 0);
  clock.tick(1);
  assert.equal(state.idles, 1);
});

test("never says it is idle while a request is still running", async () => {
  const { clock, state, handle, finishLoading } = setup();
  const slow = handle(request());
  await handle(null);
  clock.tick(IDLE_MS * 10);
  assert.equal(state.idles, 0);

  await finishLoading();
  await slow;
  clock.tick(IDLE_MS);
  assert.equal(state.idles, 1);
});

// Runs the offscreen document's scripts with a model that embeds every text as the same vector.
function setupDocument() {
  const chrome = fakeChrome();
  const sent = [];
  chrome.runtime.sendMessage = async (message) => {
    sent.push(plain(message));
    throw new Error("Could not establish connection. Receiving end does not exist.");
  };
  const model = { load: async () => async (texts) => texts.map(() => [1, 0]) };
  const { clock, context } = createContext({ chrome, BetterYT: { model } });
  runScripts(context, ["src/protocol.js", "src/matcher.js", "src/offscreen.js"]);

  const dispatch = (message) => {
    const responses = [];
    const [handled] = chrome.runtime.onMessage.dispatch(message, {}, (response) => responses.push(plain(response)));
    return { handled, responses };
  };
  return { clock, sent, dispatch };
}

test("answers only the messages addressed to the offscreen document", async () => {
  const { sent, dispatch } = setupDocument();

  const ignored = dispatch(request());
  const answered = dispatch({ ...request(), target: "offscreen" });
  await flush();

  assert.equal(ignored.handled, false);
  assert.deepEqual(ignored.responses, []);
  assert.equal(answered.handled, true);
  assert.deepEqual(answered.responses, [{ scores: { a: 1 } }]);
  assert.deepEqual(sent, [
    { type: "better-yt:status", status: LOADING(0) },
    { type: "better-yt:status", status: READY },
  ]);
});

test("tells the background when it is idle, even if earlier messages were lost", async () => {
  const { clock, sent, dispatch } = setupDocument();
  dispatch({ ...request(), target: "offscreen" });
  await flush();

  clock.tick(5 * 60_000);
  await flush();
  assert.deepEqual(sent.at(-1), { type: "better-yt:idle" });
});

// The page's CSP forbids inline scripts, and each script uses what the ones before it publish.
test("the offscreen page loads its own scripts in dependency order", () => {
  const { document } = new JSDOM(read("src/offscreen.html")).window;
  const scripts = [...document.querySelectorAll("script")];

  assert.deepEqual(scripts.map((script) => script.getAttribute("src")), [
    "protocol.js",
    "matcher.js",
    "model.js",
    "offscreen.js",
  ]);
  assert.ok(scripts.every((script) => script.textContent.trim() === ""));
  for (const script of scripts) assert.ok(read(`src/${script.getAttribute("src")}`));
});
