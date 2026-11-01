import assert from "node:assert/strict";
import test from "node:test";
import FakeTimers from "@sinonjs/fake-timers";
import { JSDOM } from "jsdom";
import { fakeChrome, flush, read, readJson, runScripts } from "./helpers.js";

// Loads what the browser loads, in the manifest's order, so a misordered or missing script fails here.
const contentScripts = readJson("manifest.json").content_scripts;
const scripts = contentScripts.flatMap((entry) => entry.js);
const css = contentScripts.flatMap((entry) => entry.css);
const fixture = read("test/fixtures/watch-sidebar.html");
const styles = css.map(read).join("\n");
const FIXTURE_IDS = ["PFmuCDHHpwk", "PkZNo7MFNFg", "RphIVv0uWrM", "C4dGVTl6ry8"];
const SCAN_MS = 150;
const RETRY_MS = 30_000;
const REQUEST_TIMEOUT_MS = 60_000;

// Points an item at another video, the way YouTube reuses sidebar elements.
function showVideo(item, id, title = `Video ${id}`) {
  const host = item.querySelector(".ytLockupViewModelHost");
  host.className = host.className.replace(/content-id-\S+/u, `content-id-${id}`);
  for (const link of item.querySelectorAll("a[href]")) link.setAttribute("href", `/watch?v=${id}`);
  item.querySelector("h3").setAttribute("title", title);
}

async function setup(t, { path = "/watch?v=W6NZfCO5SIk", stored = { topics: "programming" } } = {}) {
  const dom = new JSDOM(`<style>${styles}</style>${fixture}`, {
    url: `https://www.youtube.com${path}`,
    runScripts: "outside-only",
  });
  const { window } = dom;
  const { document } = window;
  const clock = FakeTimers.withGlobal(window).install({
    toFake: ["setTimeout", "clearTimeout", "Date", "performance"],
  });
  const chrome = fakeChrome({ stored });
  // Each request waits until the test answers it.
  const requests = [];
  chrome.runtime.sendMessage = (message) => new Promise((resolve, reject) => {
    requests.push({ message: structuredClone(message), resolve, reject });
  });
  const warnings = [];
  window.console.warn = (...args) => warnings.push(args);

  t.after(() => {
    clock.uninstall();
    window.close();
  });

  window.chrome = chrome;
  runScripts(dom.getInternalVMContext(), scripts);
  await flush();
  await clock.tickAsync(SCAN_MS);

  const items = () => [...document.querySelectorAll("yt-lockup-view-model")];
  const visibleIds = () => items()
    .filter((item) => window.getComputedStyle(item).display !== "none")
    .map((item) => /content-id-(\S+)/u.exec(item.querySelector(".ytLockupViewModelHost").className)[1]);
  const requestedIds = (request = requests.at(-1)) => request.message.videos.map((video) => video.id);
  // Answers the latest request, treating the listed ids as off topic.
  const answer = async (offTopic = [], request = requests.at(-1)) => {
    request.resolve({ matches: Object.fromEntries(requestedIds(request).map((id) => [id, !offTopic.includes(id)])) });
    await clock.tickAsync(SCAN_MS);
  };
  const changeSettings = async (changes) => {
    await chrome.storage.sync.set(changes);
    await flush();
    await clock.tickAsync(SCAN_MS);
  };
  const addVideo = async (id) => {
    const item = items()[0].cloneNode(true);
    item.removeAttribute("data-better-yt-off-topic");
    showVideo(item, id);
    document.querySelector("#related #contents").append(item);
    await clock.tickAsync(SCAN_MS);
  };

  return { window, document, clock, requests, warnings, items, visibleIds, requestedIds, answer, changeSettings, addVideo };
}

test("hides off-topic videos once the model answers", async (t) => {
  const { requests, visibleIds, answer } = await setup(t, { stored: { topics: "programming, javascript" } });
  assert.equal(requests.length, 1);
  const { message } = requests[0];
  assert.equal(message.type, "better-yt:match");
  assert.deepEqual(message.topics, ["programming", "javascript"]);
  assert.deepEqual(message.videos[0], {
    id: "PFmuCDHHpwk",
    title: "Object-oriented Programming in JavaScript: Made Super Simple | Mosh",
    channel: "Programming with Mosh",
  });
  assert.deepEqual(visibleIds(), FIXTURE_IDS);

  await answer(["RphIVv0uWrM", "C4dGVTl6ry8"]);
  assert.deepEqual(visibleIds(), ["PFmuCDHHpwk", "PkZNo7MFNFg"]);
  assert.equal(requests.length, 1);
});

test("keeps videos the answer leaves out visible without asking again", async (t) => {
  const { requests, visibleIds, clock } = await setup(t);
  requests[0].resolve({ matches: { C4dGVTl6ry8: false } });
  await clock.tickAsync(RETRY_MS);
  assert.deepEqual(visibleIds(), FIXTURE_IDS.slice(0, 3));
  assert.equal(requests.length, 1);
});

const failures = {
  "an error answer": (request) => request.resolve({ error: "The model failed to load." }),
  "a rejected message": (request) => request.reject(new Error("Receiving end does not exist.")),
  "no answer": (request) => request.resolve(),
  // The request's timeout is the only timer left.
  "a request that never settles": (request, clock) => clock.nextAsync(),
};

for (const [name, failWith] of Object.entries(failures)) {
  test(`keeps videos visible after ${name} and waits 30 seconds before retrying`, async (t) => {
    const { requests, warnings, visibleIds, clock, addVideo } = await setup(t);
    await failWith(requests[0], clock);
    await clock.tickAsync(SCAN_MS);
    assert.deepEqual(visibleIds(), FIXTURE_IDS);
    assert.equal(warnings.length, 1);

    // New videos during the back-off don't trigger requests.
    await addVideo("added00001A");
    await clock.tickAsync(RETRY_MS - 2 * SCAN_MS - 1);
    assert.equal(requests.length, 1);

    await clock.tickAsync(1);
    assert.equal(requests.length, 2);
    await failWith(requests[1], clock);
    await clock.tickAsync(SCAN_MS);
    assert.equal(warnings.length, 1, "warns once per outage");
  });
}

test("ignores a late answer to a request that timed out", async (t) => {
  const { requests, warnings, visibleIds, answer, clock } = await setup(t);
  // The request went out when the settings loaded, SCAN_MS before setup returned.
  await clock.tickAsync(REQUEST_TIMEOUT_MS - SCAN_MS - 1);
  assert.equal(warnings.length, 0);
  await clock.tickAsync(1);
  assert.equal(warnings.length, 1);
  await clock.tickAsync(RETRY_MS);
  assert.equal(requests.length, 2);

  await answer(["C4dGVTl6ry8"], requests[0]);
  assert.deepEqual(visibleIds(), FIXTURE_IDS);
  await answer(["RphIVv0uWrM"]);
  assert.deepEqual(visibleIds(), ["PFmuCDHHpwk", "PkZNo7MFNFg", "C4dGVTl6ry8"]);
});

test("sends nothing without topics", async (t) => {
  const { requests, clock, addVideo } = await setup(t, { stored: { topics: " , " } });
  await addVideo("added00001A");
  await clock.tickAsync(RETRY_MS);
  assert.equal(requests.length, 0);
});

test("sends nothing while the toggle is off", async (t) => {
  const { requests, clock, addVideo } = await setup(t, { stored: { topics: "programming", topicFilter: false } });
  await addVideo("added00001A");
  await clock.tickAsync(RETRY_MS);
  assert.equal(requests.length, 0);
});

for (const [name, changes] of Object.entries({
  "turning the toggle off": { topicFilter: false },
  "clearing the topics": { topics: "" },
})) {
  test(`${name} shows every video and stops filtering`, async (t) => {
    const { requests, visibleIds, answer, changeSettings, addVideo, clock } = await setup(t);
    await answer(["RphIVv0uWrM"]);
    await changeSettings(changes);
    assert.deepEqual(visibleIds(), FIXTURE_IDS);

    await addVideo("added00001A");
    assert.equal(requests.length, 1);
    assert.equal(clock.countTimers(), 0);
  });
}

test("turning the toggle back on reuses the verdicts for the same topics", async (t) => {
  const { requests, visibleIds, answer, changeSettings } = await setup(t);
  await answer(["RphIVv0uWrM"]);
  await changeSettings({ topicFilter: false });
  await changeSettings({ topicFilter: true });
  assert.deepEqual(visibleIds(), ["PFmuCDHHpwk", "PkZNo7MFNFg", "C4dGVTl6ry8"]);
  assert.equal(requests.length, 1);
});

test("new topics clear the verdicts and ignore a late answer for the old topics", async (t) => {
  const { requests, visibleIds, requestedIds, answer, changeSettings } = await setup(t);
  await changeSettings({ topics: "music" });
  assert.equal(requests.length, 1, "waits for the request in flight");

  await answer(["C4dGVTl6ry8"], requests[0]);
  assert.deepEqual(visibleIds(), FIXTURE_IDS, "the old answer is ignored");
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1].message.topics, ["music"]);
  assert.deepEqual(requestedIds(), FIXTURE_IDS);

  await answer(["PFmuCDHHpwk", "PkZNo7MFNFg", "RphIVv0uWrM"]);
  assert.deepEqual(visibleIds(), ["C4dGVTl6ry8"]);

  await changeSettings({ topics: "chess" });
  assert.deepEqual(visibleIds(), FIXTURE_IDS, "shows everything until the new topics are matched");
});

test("re-evaluates an item that YouTube reuses for another video", async (t) => {
  const { requests, items, visibleIds, requestedIds, answer, clock } = await setup(t);
  await answer(["RphIVv0uWrM"]);
  const [first, , hidden] = items();

  showVideo(hidden, "recycled01A");
  await clock.tickAsync(SCAN_MS);
  assert.ok(visibleIds().includes("recycled01A"), "stays visible until matched");
  assert.deepEqual(requestedIds(), ["recycled01A"]);

  await answer(["recycled01A"]);
  assert.ok(!visibleIds().includes("recycled01A"));

  // A known off-topic video is hidden again without asking.
  showVideo(first, "RphIVv0uWrM");
  await clock.tickAsync(SCAN_MS);
  assert.deepEqual(visibleIds(), ["PkZNo7MFNFg", "C4dGVTl6ry8"]);
  assert.equal(requests.length, 2);
});

test("keeps filtering when a narrow window moves the recommendations under the video", async (t) => {
  const { document, visibleIds, answer, items, clock } = await setup(t);
  await answer(["RphIVv0uWrM"]);
  document.querySelector("#primary").append(document.querySelector("#related"));
  await clock.tickAsync(SCAN_MS);
  assert.deepEqual(visibleIds(), ["PFmuCDHHpwk", "PkZNo7MFNFg", "C4dGVTl6ry8"]);

  // The next video reuses the hidden item for a video known to be on topic.
  showVideo(items()[2], "PFmuCDHHpwk");
  await clock.tickAsync(SCAN_MS);
  assert.deepEqual(visibleIds(), ["PFmuCDHHpwk", "PkZNo7MFNFg", "PFmuCDHHpwk", "C4dGVTl6ry8"]);
});

test("asks only about videos added after the first answer", async (t) => {
  const { requestedIds, visibleIds, answer, addVideo } = await setup(t);
  await answer();
  await addVideo("added00001A");
  assert.deepEqual(requestedIds(), ["added00001A"]);
  await answer(["added00001A"]);
  assert.deepEqual(visibleIds(), FIXTURE_IDS);
});

test("sends at most 30 distinct videos per request, one request at a time", async (t) => {
  const { document, requests, requestedIds, items, answer, clock } = await setup(t);
  const contents = document.querySelector("#related #contents");
  for (let index = 0; index < 40; index += 1) {
    const item = items()[0].cloneNode(true);
    showVideo(item, `batch${String(index).padStart(6, "0")}`);
    contents.append(item);
  }
  // A duplicate of a video already listed.
  contents.append(items()[1].cloneNode(true));
  await clock.tickAsync(SCAN_MS);
  assert.equal(requests.length, 1, "waits for the request in flight");

  await answer();
  assert.equal(requests.length, 2);
  assert.equal(requestedIds().length, 30);
  await answer();
  assert.equal(requests.length, 3);
  assert.equal(requestedIds().length, 10);
  await answer();
  assert.equal(requests.length, 3);
});

test("leaves pages other than watch pages alone", async (t) => {
  const { requests, clock, addVideo } = await setup(t, { path: "/results?search_query=chess" });
  await addVideo("added00001A");
  await clock.tickAsync(RETRY_MS);
  assert.equal(requests.length, 0);
});

test("shows every video after navigating away from the watch page", async (t) => {
  const { window, document, requests, visibleIds, answer, addVideo } = await setup(t);
  await answer(["RphIVv0uWrM"]);
  window.history.pushState({}, "", "/feed/subscriptions");
  document.dispatchEvent(new window.Event("yt-navigate-finish"));
  assert.deepEqual(visibleIds(), FIXTURE_IDS);

  await addVideo("added00001A");
  assert.equal(requests.length, 1);
});

test("waits for the sidebar when a watch page renders it late", async (t) => {
  const { window, document, requests, clock } = await setup(t, { path: "/feed/subscriptions" });
  const sidebar = document.querySelector("ytd-watch-flexy");
  sidebar.remove();
  window.history.pushState({}, "", "/watch?v=W6NZfCO5SIk");
  document.dispatchEvent(new window.Event("yt-navigate-finish"));
  await clock.tickAsync(SCAN_MS);
  assert.equal(requests.length, 0);

  document.querySelector("ytd-page-manager").append(sidebar);
  await clock.tickAsync(SCAN_MS);
  assert.equal(requests.length, 1);
});
