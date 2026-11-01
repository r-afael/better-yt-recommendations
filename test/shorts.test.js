import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { JSDOM } from "jsdom";
import { fakeChrome, flush, read, runScripts } from "./helpers.js";

const scripts = ["src/settings.js", "src/shorts.js"];
const styles = read("src/shorts.css");

// Where YouTube shows Shorts, next to the regular entries they sit among. Structure observed on desktop YouTube.
const markup = `
  <ytd-guide-entry-renderer id="guide-home"><a id="endpoint" href="/" title="Home"></a></ytd-guide-entry-renderer>
  <ytd-guide-entry-renderer id="guide-shorts"><a id="endpoint" title="Shorts"></a></ytd-guide-entry-renderer>
  <ytd-mini-guide-entry-renderer id="mini-guide-home"><a id="endpoint" href="/" title="Home"></a></ytd-mini-guide-entry-renderer>
  <ytd-mini-guide-entry-renderer id="mini-guide-shorts"><a id="endpoint" href="/shorts/" title="Shorts"></a></ytd-mini-guide-entry-renderer>
  <ytd-rich-item-renderer id="home-video"><a href="/watch?v=PkZNo7MFNFg">Video</a></ytd-rich-item-renderer>
  <ytd-rich-item-renderer id="home-short"><a href="/shorts/C4dGVTl6ry8">Short</a></ytd-rich-item-renderer>
  <ytd-rich-section-renderer id="home-shelf">
    <ytd-rich-shelf-renderer is-shorts>
      <ytm-shorts-lockup-view-model-v2><a href="/shorts/RphIVv0uWrM">Short</a></ytm-shorts-lockup-view-model-v2>
    </ytd-rich-shelf-renderer>
  </ytd-rich-section-renderer>
  <ytd-item-section-renderer>
    <ytd-video-renderer id="search-video"><ytd-thumbnail><a href="/watch?v=W6NZfCO5SIk">Video</a></ytd-thumbnail></ytd-video-renderer>
    <ytd-video-renderer id="search-short"><ytd-thumbnail><a href="/shorts/PFmuCDHHpwk">Short</a></ytd-thumbnail></ytd-video-renderer>
    <grid-shelf-view-model id="search-shelf">
      <div><ytm-shorts-lockup-view-model-v2><a href="/shorts/rfscVS0vtbw">Short</a></ytm-shorts-lockup-view-model-v2></div>
    </grid-shelf-view-model>
  </ytd-item-section-renderer>
  <ytd-watch-next-secondary-results-renderer>
    <yt-lockup-view-model id="sidebar-video"><a href="/watch?v=8jLOx1hD3_o">Video</a></yt-lockup-view-model>
    <yt-lockup-view-model id="sidebar-short"><a href="/shorts/hdI2bqOjy3c">Short</a></yt-lockup-view-model>
    <ytd-compact-video-renderer id="sidebar-legacy-short"><a href="/shorts/jS4aFq5-91M">Short</a></ytd-compact-video-renderer>
    <ytd-reel-shelf-renderer id="sidebar-shelf"><a href="/shorts/zOjov-2OZ0E">Short</a></ytd-reel-shelf-renderer>
  </ytd-watch-next-secondary-results-renderer>`;
const REGULAR = ["guide-home", "mini-guide-home", "home-video", "search-video", "sidebar-video"];

async function setup(t, { path = "/", stored = {} } = {}) {
  const dom = new JSDOM(`<style>${styles}</style>${markup}`, { url: `https://www.youtube.com${path}` });
  const { window } = dom;
  const { document } = window;
  t.after(() => window.close());

  // jsdom can't navigate, so the script gets a location that records where it was sent.
  const replaced = [];
  const location = {
    pathname: new URL(path, window.location.href).pathname,
    replace: (url) => replaced.push(url),
  };
  const chrome = fakeChrome({ stored });
  runScripts(vm.createContext({ chrome, document, location }), scripts);
  await flush();

  const entries = [...document.querySelectorAll("body [id]:not(a)")];
  const visibleIds = () => entries
    .filter((entry) => window.getComputedStyle(entry).display !== "none")
    .map((entry) => entry.id);
  const changeSettings = async (changes) => {
    await chrome.storage.sync.set(changes);
    await flush();
  };
  // What YouTube does when it opens another page without reloading.
  const navigate = (nextPath) => {
    location.pathname = nextPath;
    document.dispatchEvent(new window.Event("yt-navigate-finish"));
  };
  return { replaced, allIds: entries.map((entry) => entry.id), visibleIds, changeSettings, navigate };
}

test("shows Shorts until the setting is turned on", async (t) => {
  const { replaced, allIds, visibleIds } = await setup(t, { path: "/shorts/C4dGVTl6ry8" });
  assert.equal(allIds.length, 14);
  assert.deepEqual(visibleIds(), allIds);
  assert.deepEqual(replaced, []);
});

test("hides Shorts in the menu, feeds, search results and sidebar, and nothing else", async (t) => {
  const { visibleIds } = await setup(t, { stored: { hideShorts: true } });
  assert.deepEqual(visibleIds(), REGULAR);
});

test("open tabs hide and show Shorts as the setting changes", async (t) => {
  const { allIds, visibleIds, changeSettings } = await setup(t);
  await changeSettings({ hideShorts: true });
  assert.deepEqual(visibleIds(), REGULAR);
  await changeSettings({ hideShorts: false });
  assert.deepEqual(visibleIds(), allIds);
});

test("opens a Short as a regular video", async (t) => {
  const { replaced } = await setup(t, { path: "/shorts/jS4aFq5-91M?feature=share", stored: { hideShorts: true } });
  assert.deepEqual(replaced, ["/watch?v=jS4aFq5-91M"]);
});

test("opens a Short reached without a page load as a regular video", async (t) => {
  const { replaced, navigate } = await setup(t, { stored: { hideShorts: true } });
  navigate("/watch");
  navigate("/feed/subscriptions");
  assert.deepEqual(replaced, []);
  navigate("/shorts/hdI2bqOjy3c");
  assert.deepEqual(replaced, ["/watch?v=hdI2bqOjy3c"]);
});

test("turning the setting on while a Short plays opens it as a regular video", async (t) => {
  const { replaced, changeSettings } = await setup(t, { path: "/shorts/zOjov-2OZ0E" });
  await changeSettings({ topics: "chess" });
  assert.deepEqual(replaced, []);
  await changeSettings({ hideShorts: true });
  assert.deepEqual(replaced, ["/watch?v=zOjov-2OZ0E"]);
});
