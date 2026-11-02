import assert from "node:assert/strict";
import test from "node:test";
import { HIDDEN_COUNT, MATCH, SCAN_MS, fakeChrome, flush, holdMessages, openYouTube, read, readJson, score } from "./helpers.js";

const watchFixture = read("test/fixtures/watch-sidebar.html");
const homeFixture = read("test/fixtures/home-grid.html");
// The Subscriptions grid has the same markup as Home's.
const subscriptionsFixture = homeFixture.replaceAll('page-subtype="home"', 'page-subtype="subscriptions"');
const searchFixture = read("test/fixtures/search-results.html");
const FIXTURE_IDS = ["PFmuCDHHpwk", "PkZNo7MFNFg", "RphIVv0uWrM", "C4dGVTl6ry8"];
const ON_TOPIC_IDS = FIXTURE_IDS.filter((id) => id !== "RphIVv0uWrM"); // Once RphIVv0uWrM is hidden.
const HOME_IDS = ["rfscVS0vtbw", "W6NZfCO5SIk", "dQw4w9WgXcQ", "jNQXAC9IVRw"];
const HOME_OFF_TOPIC = ["dQw4w9WgXcQ", "jNQXAC9IVRw"];
const HOME_ON_TOPIC = HOME_IDS.filter((id) => !HOME_OFF_TOPIC.includes(id));
const SEARCH_IDS = ["soTfFFIQQ8U", "C842vFY5kRo", "PLWKjhJtqVAbnqBxcdjVGgT3uVR10bzTEB"];
const HOME_PATH = "/";
const WATCH_PATH = "/watch?v=W6NZfCO5SIk";
const SEARCH_PATH = "/results?search_query=freecodecamp";
const COLLAPSED = { text: "Show them", expanded: "false" };
const REVEALED = { text: "Hide them again", expanded: "true" };
const RETRY_MS = 30_000;
const REQUEST_TIMEOUT_MS = 60_000;

// Points an item at another video, the way YouTube reuses sidebar elements.
function showVideo(item, id, title = `Video ${id}`) {
  const host = item.querySelector(".ytLockupViewModelHost");
  host.className = host.className.replace(/content-id-\S+/u, `content-id-${id}`);
  for (const link of item.querySelectorAll("a[href]")) link.setAttribute("href", `/watch?v=${id}`);
  item.querySelector("h3").setAttribute("title", title);
}

async function setup(t, { fixture = watchFixture, path = WATCH_PATH, stored = { topics: "programming" }, locale = "en" } = {}) {
  const chrome = fakeChrome({ stored, locale });
  // MATCH requests wait for the test to answer them; the hidden counts sent for the badge are recorded.
  const reports = [];
  const requests = holdMessages(chrome, (message) => message.type !== HIDDEN_COUNT, async (message) => {
    reports.push(message.count);
  });
  const { window, document, clock } = await openYouTube(t, { fixture, path, chrome });
  const warnings = [];
  window.console.warn = (...args) => warnings.push(args);

  const items = () => [...document.querySelectorAll("yt-lockup-view-model")];
  // Hiding a grid cell hides the card inside it, so every ancestor counts.
  const isShown = (element) => {
    for (let node = element; node; node = node.parentElement) {
      if (window.getComputedStyle(node).display === "none") return false;
    }
    return true;
  };
  const idHosts = (root) => [...root.querySelectorAll('.ytLockupViewModelHost[class*="content-id-"]')];
  // The ids of the cards shown in the page, or in a part of it such as Home's grid.
  const visibleIds = (root = document) => idHosts(root)
    .filter(isShown)
    .map((host) => /content-id-(\S+)/u.exec(host.className)[1]);
  const hiddenRow = () => document.querySelector(".better-yt-hidden-row");
  const rowShown = () => {
    const row = hiddenRow();
    return Boolean(row) && window.getComputedStyle(row).display !== "none";
  };
  const rowText = () => hiddenRow().querySelector(".better-yt-hidden-row__text").textContent;
  const toggle = () => hiddenRow().querySelector("button");
  const toggleState = () => ({ text: toggle().textContent, expanded: toggle().getAttribute("aria-expanded") });
  const list = () => document.querySelector("ytd-watch-next-secondary-results-renderer");
  const requestedIds = (request = requests.at(-1)) => request.message.videos.map((video) => video.id);
  // Answers the latest request, scoring the listed ids 0 and the others 1.
  const answer = async (offTopic = [], request = requests.at(-1)) => {
    request.resolve({ scores: Object.fromEntries(requestedIds(request).map((id) => [id, score(Number(!offTopic.includes(id)))])) });
    await clock.tickAsync(SCAN_MS);
  };
  // Goes to another page in the same document, the way YouTube navigates.
  const navigate = (url) => {
    window.history.pushState({}, "", url);
    document.dispatchEvent(new window.Event("yt-navigate-finish"));
  };
  const changeSettings = async (changes) => {
    await chrome.storage.sync.set(changes);
    await flush();
    await clock.tickAsync(SCAN_MS);
  };
  const addVideo = async (id) => {
    const item = items()[0].cloneNode(true);
    item.removeAttribute("data-better-yt-hidden");
    showVideo(item, id);
    document.querySelector("#related #contents").append(item);
    await clock.tickAsync(SCAN_MS);
  };

  return {
    window, document, clock, requests, reports, warnings, items, isShown, visibleIds, requestedIds, answer, navigate,
    changeSettings, addVideo, hiddenRow, rowShown, rowText, toggle, toggleState, list,
  };
}

test("hides off-topic videos once the model answers", async (t) => {
  const { requests, visibleIds, answer } = await setup(t, { stored: { topics: "programming, javascript" } });
  assert.equal(requests.length, 1);
  const { message } = requests[0];
  assert.equal(message.type, MATCH);
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
  requests[0].resolve({ scores: { C4dGVTl6ry8: score(0) } });
  await clock.tickAsync(RETRY_MS);
  assert.deepEqual(visibleIds(), FIXTURE_IDS.slice(0, 3));
  assert.equal(requests.length, 1);
});

test("hides videos that match the topics less than the match needed, and re-filters without asking when it changes", async (t) => {
  const { requests, visibleIds, clock, changeSettings } = await setup(t);
  requests[0].resolve({ scores: { PFmuCDHHpwk: score(0.4), PkZNo7MFNFg: score(0.25), RphIVv0uWrM: score(0.2), C4dGVTl6ry8: score(0.1) } });
  await clock.tickAsync(SCAN_MS);
  assert.deepEqual(visibleIds(), ["PFmuCDHHpwk", "PkZNo7MFNFg"], "the default keeps scores of 0.25 and up");

  await changeSettings({ threshold: 0.35 });
  assert.deepEqual(visibleIds(), ["PFmuCDHHpwk"]);
  await changeSettings({ threshold: 0.1 });
  assert.deepEqual(visibleIds(), FIXTURE_IDS);
  assert.equal(requests.length, 1);
});

test("uses the stored match needed", async (t) => {
  const { requests, visibleIds, clock } = await setup(t, { stored: { topics: "programming", threshold: 0.15 } });
  requests[0].resolve({ scores: { PFmuCDHHpwk: score(0.4), PkZNo7MFNFg: score(0.25), RphIVv0uWrM: score(0.2), C4dGVTl6ry8: score(0.1) } });
  await clock.tickAsync(SCAN_MS);
  assert.deepEqual(visibleIds(), ["PFmuCDHHpwk", "PkZNo7MFNFg", "RphIVv0uWrM"]);
});

test("sends both topic lists", async (t) => {
  const { requests } = await setup(t, { stored: { topics: "programming", avoidTopics: "gaming, gossip" } });
  assert.deepEqual(requests[0].message.topics, ["programming"]);
  assert.deepEqual(requests[0].message.avoidTopics, ["gaming", "gossip"]);
});

test("with both lists, hides a video for a topic to avoid only when it matches that more than the topics", async (t) => {
  const { requests, visibleIds, clock } = await setup(t, {
    stored: { topics: "programming", avoidTopics: "gaming", avoidThreshold: 0.24 },
  });
  requests[0].resolve({ scores: {
    PFmuCDHHpwk: score(0.9, 0.24),
    PkZNo7MFNFg: score(0.31, 0.23),
    RphIVv0uWrM: score(0.2, 0.1),
    C4dGVTl6ry8: score(0.3, 0.35),
  } });
  await clock.tickAsync(SCAN_MS);
  assert.deepEqual(visibleIds(), ["PFmuCDHHpwk", "PkZNo7MFNFg"]);
});

test("with only topics to avoid, hides videos from the match that hides, and decides again when it moves without asking", async (t) => {
  const { requests, visibleIds, clock, changeSettings } = await setup(t, { stored: { topics: "", avoidTopics: "gaming" } });
  assert.deepEqual(requests[0].message.topics, []);
  requests[0].resolve({ scores: {
    PFmuCDHHpwk: score(null, 0.4),
    PkZNo7MFNFg: score(null, 0.3),
    RphIVv0uWrM: score(null, 0.2),
    C4dGVTl6ry8: score(null, 0.1),
  } });
  await clock.tickAsync(SCAN_MS);
  assert.deepEqual(visibleIds(), ["RphIVv0uWrM", "C4dGVTl6ry8"]);

  await changeSettings({ avoidThreshold: 0.35 });
  assert.deepEqual(visibleIds(), ["PkZNo7MFNFg", "RphIVv0uWrM", "C4dGVTl6ry8"], "a higher line hides fewer");
  await changeSettings({ avoidThreshold: 0.1 });
  assert.deepEqual(visibleIds(), []);
  assert.equal(requests.length, 1);
});

test("changing the topics to avoid clears the verdicts", async (t) => {
  const { requests, visibleIds, requestedIds, answer, changeSettings } = await setup(t, { stored: { topics: "programming", avoidTopics: "gaming" } });
  await answer(["RphIVv0uWrM"]);
  assert.deepEqual(visibleIds(), ON_TOPIC_IDS);

  await changeSettings({ avoidTopics: "gossip" });
  assert.deepEqual(visibleIds(), FIXTURE_IDS);
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1].message.avoidTopics, ["gossip"]);
  assert.deepEqual(requestedIds(), FIXTURE_IDS);
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
  assert.deepEqual(visibleIds(), ON_TOPIC_IDS);
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
  "unchecking Next to the video you're watching": { filterWatch: false },
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
  assert.deepEqual(visibleIds(), ON_TOPIC_IDS);
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
  assert.deepEqual(visibleIds(), ON_TOPIC_IDS);

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

test("leaves pages that aren't lists of recommendations alone", async (t) => {
  const { requests, clock, addVideo } = await setup(t, { path: "/feed/history" });
  await addVideo("added00001A");
  await clock.tickAsync(RETRY_MS);
  assert.equal(requests.length, 0);
});

test("returning from a page that isn't filtered keeps the hidden videos hidden", async (t) => {
  const { document, clock, requests, visibleIds, reports, answer, navigate } = await setup(t, {
    fixture: homeFixture + searchFixture,
    path: HOME_PATH,
  });
  const home = document.querySelector("ytd-browse");
  await answer(HOME_OFF_TOPIC);

  navigate(SEARCH_PATH);
  await clock.tickAsync(SCAN_MS);
  assert.equal(requests.length, 1, "search results aren't filtered by default");
  assert.deepEqual(reports, [2, 0]);

  navigate(HOME_PATH);
  assert.deepEqual(visibleIds(home), HOME_ON_TOPIC, "Home's hidden videos don't flash back");
  await clock.tickAsync(SCAN_MS);
  assert.deepEqual(reports, [2, 0, 2]);
});

test("unchecking a page while another one is shown shows its videos when you return", async (t) => {
  const { document, clock, visibleIds, answer, navigate, changeSettings } = await setup(t, {
    fixture: homeFixture + watchFixture,
    path: HOME_PATH,
  });
  const home = document.querySelector("ytd-browse");
  await answer(HOME_OFF_TOPIC);
  navigate(WATCH_PATH);
  await clock.tickAsync(SCAN_MS);
  await changeSettings({ filterHome: false });

  navigate(HOME_PATH);
  assert.deepEqual(visibleIds(home), HOME_IDS);
});

test("waits for the sidebar when a watch page renders it late", async (t) => {
  const { document, requests, clock, navigate } = await setup(t, { path: "/feed/history" });
  const sidebar = document.querySelector("ytd-watch-flexy");
  sidebar.remove();
  navigate(WATCH_PATH);
  await clock.tickAsync(SCAN_MS);
  assert.equal(requests.length, 0);

  document.querySelector("ytd-page-manager").append(sidebar);
  await clock.tickAsync(SCAN_MS);
  assert.equal(requests.length, 1);
});

test("starts the list with a row that counts the hidden videos", async (t) => {
  const { document, hiddenRow, rowShown, rowText, toggle, list, answer } = await setup(t);
  assert.equal(rowShown(), false, "no row while nothing is hidden");

  await answer(["RphIVv0uWrM", "C4dGVTl6ry8"]);
  assert.equal(rowShown(), true);
  assert.equal(rowText(), "2 videos hidden");
  assert.equal(hiddenRow().nextElementSibling, list());
  const description = document.getElementById(toggle().getAttribute("aria-describedby"));
  assert.equal(description.textContent, "2 videos hidden", "screen readers hear the count with the button");
});

test("says 1 video hidden for a single one", async (t) => {
  const { rowText, answer } = await setup(t);
  await answer(["RphIVv0uWrM"]);
  assert.equal(rowText(), "1 video hidden");
});

test("counts the hidden videos in the browser's language, with its digits", async (t) => {
  const { rowText, answer } = await setup(t, { locale: "bn" });
  await answer(["RphIVv0uWrM", "C4dGVTl6ry8"]);
  const { hiddenRowMany } = readJson("_locales/bn/messages.json");
  assert.equal(rowText(), hiddenRowMany.message.replace("$COUNT$", (2).toLocaleString("bn")));
});

test("the row speaks the extension's language and direction, not YouTube's", async (t) => {
  const { document, hiddenRow, answer } = await setup(t, { locale: "ar" });
  document.documentElement.lang = "en";
  document.documentElement.dir = "ltr";
  await answer(["RphIVv0uWrM"]);
  assert.deepEqual({ lang: hiddenRow().lang, dir: hiddenRow().dir }, { lang: "ar", dir: "rtl" });
});

test("Show them shows the hidden videos until Hide them again", async (t) => {
  const { visibleIds, toggle, toggleState, answer } = await setup(t);
  await answer(["RphIVv0uWrM"]);
  assert.deepEqual(toggleState(), COLLAPSED);

  toggle().click();
  assert.deepEqual(visibleIds(), FIXTURE_IDS);
  assert.deepEqual(toggleState(), REVEALED);

  toggle().click();
  assert.deepEqual(visibleIds(), ON_TOPIC_IDS);
  assert.deepEqual(toggleState(), COLLAPSED);
});

test("every new page starts with the hidden videos collapsed", async (t) => {
  const { clock, visibleIds, toggle, toggleState, answer, navigate } = await setup(t);
  await answer(["RphIVv0uWrM"]);
  toggle().click();

  navigate("/watch?v=PFmuCDHHpwk");
  await clock.tickAsync(SCAN_MS);
  assert.deepEqual(visibleIds(), ON_TOPIC_IDS);
  assert.deepEqual(toggleState(), COLLAPSED);
});

test("turning the filter off takes the row away, and turning it back on starts collapsed", async (t) => {
  const { requests, visibleIds, rowShown, toggle, toggleState, answer, changeSettings } = await setup(t);
  await answer(["RphIVv0uWrM"]);
  toggle().click();

  await changeSettings({ topicFilter: false });
  assert.equal(rowShown(), false);

  await changeSettings({ topicFilter: true });
  assert.equal(requests.length, 1, "the verdicts are reused");
  assert.deepEqual(visibleIds(), ON_TOPIC_IDS);
  assert.equal(rowShown(), true);
  assert.deepEqual(toggleState(), COLLAPSED);
});

test("puts the row back when YouTube re-renders the list", async (t) => {
  const { hiddenRow, list, answer, addVideo } = await setup(t);
  await answer(["RphIVv0uWrM"]);
  const row = hiddenRow();
  row.remove();

  await addVideo("added00001A");
  assert.equal(list().previousElementSibling, row);
});

test("reports the hidden count when it changes, and 0 when filtering stops", async (t) => {
  const { reports, answer, addVideo, changeSettings } = await setup(t);
  assert.deepEqual(reports, [], "a new page's badge is already empty");

  await answer(["RphIVv0uWrM", "C4dGVTl6ry8"]);
  assert.deepEqual(reports, [2]);
  await addVideo("added00001A");
  assert.deepEqual(reports, [2], "a rescan with the same count sends nothing");

  await changeSettings({ topicFilter: false });
  assert.deepEqual(reports, [2, 0]);
});

test("reports the hidden count again when the page returns from the back/forward cache", async (t) => {
  const { window, clock, reports, answer } = await setup(t);
  await answer(["RphIVv0uWrM", "C4dGVTl6ry8"]);

  window.dispatchEvent(new window.PageTransitionEvent("pagehide", { persisted: true }));
  assert.deepEqual(reports, [2, 0]);
  window.dispatchEvent(new window.PageTransitionEvent("pageshow", { persisted: true }));
  await clock.tickAsync(SCAN_MS);
  assert.deepEqual(reports, [2, 0, 2]);
});

// content.js watches `hidden` across the whole page in enforcement mode, so an unchanged row
// must not wake it after every scan.
test("a rescan with the same count leaves the row untouched", async (t) => {
  const { window, requests, hiddenRow, rowText, answer, addVideo } = await setup(t);
  await answer(["RphIVv0uWrM"]);
  const records = [];
  const observer = new window.MutationObserver((changes) => records.push(...changes));
  observer.observe(hiddenRow(), { subtree: true, childList: true, attributes: true, characterData: true });
  // Moving the row is a change to its parent's children.
  observer.observe(hiddenRow().parentElement, { childList: true });

  await addVideo("added00001A");
  await flush();
  assert.equal(requests.length, 2, "rescanned");
  assert.equal(rowText(), "1 video hidden");
  assert.deepEqual([...records, ...observer.takeRecords()], []);
  observer.disconnect();
});

test("filters Home by default", async (t) => {
  const { document, requestedIds, visibleIds, rowText, hiddenRow, reports, answer } = await setup(t, { fixture: homeFixture, path: HOME_PATH });
  assert.deepEqual(requestedIds(), HOME_IDS);

  await answer(HOME_OFF_TOPIC);
  assert.deepEqual(visibleIds(), HOME_ON_TOPIC);
  assert.equal(rowText(), "2 videos hidden");
  assert.equal(hiddenRow().nextElementSibling, document.querySelector("ytd-rich-grid-renderer > #contents"));
  assert.deepEqual(reports, [2]);
});

test("leaves Home alone when its setting is off", async (t) => {
  const { requests, clock } = await setup(t, { fixture: homeFixture, path: HOME_PATH, stored: { topics: "programming", filterHome: false } });
  await clock.tickAsync(RETRY_MS);
  assert.equal(requests.length, 0);
});

test("leaves search results alone until their setting is on, then filters them", async (t) => {
  const { document, requests, requestedIds, isShown, rowText, answer, changeSettings } = await setup(t, {
    fixture: searchFixture,
    path: SEARCH_PATH,
  });
  assert.equal(requests.length, 0);

  await changeSettings({ filterSearch: true });
  assert.deepEqual(requestedIds(), SEARCH_IDS);
  await answer(["C842vFY5kRo"]);
  const resultLink = (id) => document.querySelector(`ytd-video-renderer a[href*="${id}"]`);
  assert.equal(isShown(resultLink("C842vFY5kRo")), false);
  assert.equal(isShown(resultLink("soTfFFIQQ8U")), true);
  assert.equal(rowText(), "1 video hidden");
});

test("filters the Subscriptions grid once its setting is on", async (t) => {
  const { requests, requestedIds, visibleIds, answer, changeSettings } = await setup(t, {
    fixture: subscriptionsFixture,
    path: "/feed/subscriptions",
  });
  assert.equal(requests.length, 0);

  await changeSettings({ filterSubscriptions: true });
  assert.deepEqual(requestedIds(), HOME_IDS);
  await answer(["jNQXAC9IVRw"]);
  assert.deepEqual(visibleIds(), HOME_IDS.filter((id) => id !== "jNQXAC9IVRw"));
});

test("returning to Home keeps its hidden videos hidden, and the badge counts only the page shown", async (t) => {
  const { document, clock, requestedIds, visibleIds, rowText, hiddenRow, reports, answer, navigate } = await setup(t, {
    fixture: homeFixture + watchFixture,
    path: HOME_PATH,
  });
  const home = document.querySelector("ytd-browse");
  const homeList = document.querySelector("ytd-rich-grid-renderer > #contents");
  const watchList = document.querySelector("ytd-watch-next-secondary-results-renderer");
  await answer(HOME_OFF_TOPIC);
  assert.deepEqual(reports, [2]);

  navigate(WATCH_PATH);
  assert.deepEqual(visibleIds(home), HOME_ON_TOPIC);
  await clock.tickAsync(SCAN_MS);
  assert.deepEqual(requestedIds(), FIXTURE_IDS);
  await answer(["RphIVv0uWrM"]);
  assert.equal(rowText(), "1 video hidden");
  assert.equal(hiddenRow().nextElementSibling, watchList);
  assert.deepEqual(visibleIds(home), HOME_ON_TOPIC);

  navigate(HOME_PATH);
  assert.deepEqual(visibleIds(home), HOME_ON_TOPIC, "Home's hidden videos don't flash back");
  await clock.tickAsync(SCAN_MS);
  assert.equal(rowText(), "2 videos hidden");
  assert.equal(hiddenRow().nextElementSibling, homeList);
  assert.deepEqual(reports, [2, 0, 1, 2]);
});

test("unchecking the page being viewed shows its hidden videos again", async (t) => {
  const { visibleIds, rowShown, reports, answer, changeSettings } = await setup(t, { fixture: homeFixture, path: HOME_PATH });
  await answer(HOME_OFF_TOPIC);
  await changeSettings({ filterHome: false });
  assert.deepEqual(visibleIds(), HOME_IDS);
  assert.equal(rowShown(), false);
  assert.deepEqual(reports, [2, 0]);
});

test("ignores hover and thumbnail class changes on Home, but rescans a recycled card", async (t) => {
  const { document, clock, requestedIds, answer } = await setup(t, { fixture: homeFixture, path: HOME_PATH });
  await answer(HOME_OFF_TOPIC);
  const timers = clock.countTimers();
  document.querySelector("yt-thumbnail-view-model").classList.add("ytThumbnailViewModelHovered");
  await flush();
  assert.equal(clock.countTimers(), timers, "no scan is scheduled");

  const host = document.querySelector(".ytLockupViewModelHost");
  host.className = host.className.replace(/content-id-\S+/u, "content-id-recycled01A");
  await clock.tickAsync(SCAN_MS);
  assert.deepEqual(requestedIds(), ["recycled01A"]);
});

// Two of the watch fixture's channels, each with one video.
const FREECODECAMP = { id: "PkZNo7MFNFg", channel: "freeCodeCamp.org" };
const MOSH = { id: "PFmuCDHHpwk", channel: "Programming with Mosh" };

test("hides a blocked channel's videos without asking the model", async (t) => {
  const { requests, visibleIds, rowText, clock } = await setup(t, { stored: { blockedChannels: [FREECODECAMP.channel] } });
  assert.deepEqual(visibleIds(), FIXTURE_IDS.filter((id) => id !== FREECODECAMP.id));
  assert.equal(rowText(), "1 video hidden");
  await clock.tickAsync(RETRY_MS);
  assert.equal(requests.length, 0);
});

test("doesn't ask the model about a blocked channel's videos, and new topics never show them", async (t) => {
  const { window, requestedIds, visibleIds } = await setup(t, { stored: { topics: "programming", blockedChannels: [FREECODECAMP.channel] } });
  const others = FIXTURE_IDS.filter((id) => id !== FREECODECAMP.id);
  assert.deepEqual(requestedIds(), others);
  assert.deepEqual(visibleIds(), others, "hidden before any answer");

  await window.chrome.storage.sync.set({ topics: "chess" });
  await flush();
  assert.deepEqual(visibleIds(), others, "still hidden while the new topics wait for an answer");
});

test("never hides an allowed channel's videos, and doesn't ask about them", async (t) => {
  const { requestedIds, visibleIds, answer } = await setup(t, { stored: { topics: "programming", allowedChannels: [MOSH.channel] } });
  assert.deepEqual(requestedIds(), FIXTURE_IDS.filter((id) => id !== MOSH.id));
  await answer(FIXTURE_IDS);
  assert.deepEqual(visibleIds(), [MOSH.id]);
});

test("changing the channel lists filters again without asking again", async (t) => {
  const { requests, visibleIds, answer, changeSettings } = await setup(t);
  await answer(["RphIVv0uWrM"]);
  await changeSettings({ blockedChannels: [FREECODECAMP.channel] });
  assert.deepEqual(visibleIds(), ["PFmuCDHHpwk", "C4dGVTl6ry8"]);

  await changeSettings({ allowedChannels: ["Академия нейросетей Сергея Нагорного GORA ACADEMY"] });
  assert.deepEqual(visibleIds(), ["PFmuCDHHpwk", "RphIVv0uWrM", "C4dGVTl6ry8"]);
  await changeSettings({ blockedChannels: [] });
  assert.deepEqual(visibleIds(), FIXTURE_IDS);
  assert.equal(requests.length, 1);
});

test("turning the filter off shows blocked channels again", async (t) => {
  const { visibleIds, rowShown, changeSettings } = await setup(t, { stored: { blockedChannels: [FREECODECAMP.channel] } });
  await changeSettings({ topicFilter: false });
  assert.deepEqual(visibleIds(), FIXTURE_IDS);
  assert.equal(rowShown(), false);
});

// YouTube loads more videos when its marker at the end of the list comes into view. Hidden videos
// take no room, so when nearly all are hidden the marker stays in view while the tab sits idle.
const PAUSE_AFTER = 60;

// Sets up the watch page with every video of Mosh's channel hidden, and a way to load more of them
// the way YouTube loads its next pages.
async function setupIdleFeed(t) {
  const page = await setup(t, { stored: { topics: "", blockedChannels: [MOSH.channel] } });
  const { document, items, isShown, clock } = page;
  const loadMore = async (count) => {
    const list = document.querySelector("#related #contents");
    for (let index = 0; index < count; index += 1) {
      const item = items()[0].cloneNode(true);
      item.removeAttribute("data-better-yt-hidden");
      item.removeAttribute("data-better-yt-reason");
      showVideo(item, `more${String(index).padStart(7, "0")}`);
      list.append(item);
    }
    await clock.tickAsync(SCAN_MS);
  };
  const loads = () => isShown(document.querySelector("ytd-continuation-item-renderer"));
  return { ...page, loadMore, loads };
}

test("stops YouTube loading more videos once many were hidden without the user scrolling", async (t) => {
  const { loadMore, loads } = await setupIdleFeed(t);
  await loadMore(PAUSE_AFTER - 2);
  assert.equal(loads(), true, "a page or two of hidden videos still loads the next");
  await loadMore(1);
  assert.equal(loads(), false);
});

test("scrolling lets YouTube load more videos again", async (t) => {
  const { window, document, loadMore, loads, toggle } = await setupIdleFeed(t);
  await loadMore(PAUSE_AFTER);

  document.dispatchEvent(new window.WheelEvent("wheel", { bubbles: true, deltaY: 100 }));
  assert.equal(loads(), true, "after a wheel");
  await loadMore(PAUSE_AFTER - 1);
  assert.equal(loads(), true, "the count starts again from the scroll");

  await loadMore(1);
  document.body.dispatchEvent(new window.KeyboardEvent("keydown", { bubbles: true, key: "End" }));
  assert.equal(loads(), true, "after the End key");

  await loadMore(PAUSE_AFTER);
  toggle().click();
  assert.equal(loads(), true, "after Show them");
});

test("turning the filter off lets YouTube load more videos again", async (t) => {
  const { loadMore, loads, changeSettings } = await setupIdleFeed(t);
  await loadMore(PAUSE_AFTER);
  await changeSettings({ topicFilter: false });
  assert.equal(loads(), true);
});
