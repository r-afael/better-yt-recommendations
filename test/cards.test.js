import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { read, runScripts } from "./helpers.js";

const fixture = read("test/fixtures/watch-sidebar.html");
const homeFixture = read("test/fixtures/home-grid.html");
const searchFixture = read("test/fixtures/search-results.html");

const SEARCH_URL = "https://www.youtube.com/results?search_query=freecodecamp";

function load(t, markup = fixture, url = "https://www.youtube.com/watch?v=W6NZfCO5SIk") {
  const dom = new JSDOM(markup, { url, runScripts: "outside-only" });
  t.after(() => dom.window.close());
  runScripts(dom.getInternalVMContext(), ["src/settings.js", "src/cards.js"]);
  const { cards } = dom.window.BetterYT;
  return { document: dom.window.document, cards, ...cards.SURFACES };
}

// Copies the page's objects into this realm, so deepEqual compares only their values.
const readAll = (cards, surface) => structuredClone(cards.findItems(surface).map((item) => cards.readVideo(item)));
const readVideos = (cards, surface) => readAll(cards, surface).filter(Boolean);
// Whether any card found is inside, or holds, one of the elements a selector names.
const foundAny = (document, items, selector) =>
  [...document.querySelectorAll(selector)].some((element) => items.some((item) => element.contains(item) || item.contains(element)));

// The sidebar wrapper YouTube puts around recommendation items.
const watchPage = (items) => `<ytd-watch-flexy><div id="secondary">
  <ytd-watch-next-secondary-results-renderer>${items}</ytd-watch-next-secondary-results-renderer>
</div></ytd-watch-flexy>`;

const HOME_VIDEOS = [
  { id: "rfscVS0vtbw", title: "Learn Python - Full Course for Beginners [Tutorial]", channel: "freeCodeCamp.org" },
  {
    id: "W6NZfCO5SIk",
    title: "JavaScript Tutorial for Beginners: Learn JavaScript in 1 Hour",
    channel: "Programming with Mosh",
  },
  {
    id: "dQw4w9WgXcQ",
    title: "Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)",
    channel: "Rick Astley",
  },
  { id: "jNQXAC9IVRw", title: "Me at the zoo", channel: "jawed" },
];

test("reads every recommendation in the real sidebar markup", (t) => {
  const { cards, watch } = load(t);
  assert.deepEqual(readAll(cards, watch), [
    {
      id: "PFmuCDHHpwk",
      title: "Object-oriented Programming in JavaScript: Made Super Simple | Mosh",
      channel: "Programming with Mosh",
    },
    { id: "PkZNo7MFNFg", title: "Learn JavaScript - Full Course for Beginners", channel: "freeCodeCamp.org" },
    {
      id: "RphIVv0uWrM",
      title: "Лучший бесплатный ИИ для работы и жизни | DeepSeek на практике | Вайб кодинг, документы, авито",
      channel: "Академия нейросетей Сергея Нагорного GORA ACADEMY",
    },
    {
      id: "C4dGVTl6ry8",
      title: "Positive Energy 2027 🌴 Deep House Mix & Tropical Vibes Playlist for Uplifting Mood",
      channel: "Positive Chill Mood",
    },
  ]);
});

test("finds only recommendations inside the watch page sidebar", (t) => {
  const lockup = (id) => `<yt-lockup-view-model><a href="/watch?v=${id}" id="video-title">Video ${id}</a></yt-lockup-view-model>`;
  const related = lockup("related0001") + `<ytd-ad-slot-renderer>${lockup("sponsored01")}</ytd-ad-slot-renderer>`;
  const { document, cards, watch } = load(t, `<div id="primary">${lockup("primary0001")}</div>${watchPage(related)}`);
  assert.deepEqual(readAll(cards, watch).map((video) => video.id), ["related0001"]);
  assert.equal(cards.container(watch), document.querySelector("ytd-watch-next-secondary-results-renderer"));
});

test("finds recommendations that a narrow window moves under the video", (t) => {
  const { document, cards, watch } = load(t);
  document.querySelector("#primary").append(document.querySelector("#related"));
  assert.equal(cards.findItems(watch).length, 4);
});

test("finds nothing on pages without the sidebar", (t) => {
  const { cards, watch } = load(t, "<ytd-browse></ytd-browse>");
  assert.equal(cards.findItems(watch).length, 0);
  assert.equal(cards.container(watch), null);
});

test("reads the older compact video layout", (t) => {
  const { cards, watch } = load(t, watchPage(`<ytd-compact-video-renderer>
    <a id="thumbnail" href="/watch?v=legacy00001&amp;t=10s"></a>
    <span id="video-title">  Legacy
      title  </span>
    <ytd-channel-name><div id="text">Old channel</div></ytd-channel-name>
  </ytd-compact-video-renderer>`));
  assert.deepEqual(readAll(cards, watch), [{ id: "legacy00001", title: "Legacy title", channel: "Old channel" }]);
});

test("caps long titles and channels and allows a missing channel", (t) => {
  const { cards, watch } = load(t, watchPage(`
    <yt-lockup-view-model><div class="ytLockupViewModelHost content-id-long0000001">
      <h3 title="${"t".repeat(250)}"></h3>
      <span class="ytContentMetadataViewModelMetadataText">${"c".repeat(150)}</span>
    </div></yt-lockup-view-model>
    <yt-lockup-view-model><div class="ytLockupViewModelHost content-id-nochannel01">
      <a class="ytLockupMetadataViewModelTitle">Untitled heading</a>
    </div></yt-lockup-view-model>`));
  const [long, noChannel] = readAll(cards, watch);
  assert.equal(long.title.length, 200);
  assert.equal(long.channel.length, 100);
  assert.deepEqual(noChannel, { id: "nochannel01", title: "Untitled heading", channel: "" });
});

test("reads a mix in the sidebar by its own id and title, like a video", (t) => {
  const { cards, watch } = load(t, watchPage(`<yt-lockup-view-model>
    <div class="ytLockupViewModelHost content-id-RDdQw4w9WgXcQ">
      <a href="/watch?v=dQw4w9WgXcQ&amp;list=RDdQw4w9WgXcQ"></a>
      <h3 title="Mix – Rick Astley"></h3>
    </div>
  </yt-lockup-view-model>`));
  assert.deepEqual(readAll(cards, watch), [{ id: "RDdQw4w9WgXcQ", title: "Mix – Rick Astley", channel: "" }]);
});

test("skips items without a video id or a title", (t) => {
  const { cards, watch } = load(t, watchPage(`
    <yt-lockup-view-model><h3 title="A playlist without a video"></h3></yt-lockup-view-model>
    <yt-lockup-view-model><a href="/watch?v=notitle0001"></a></yt-lockup-view-model>`));
  assert.deepEqual(readAll(cards, watch), [null, null]);
});

test("reads every video in the Home grid markup", (t) => {
  const { cards, home } = load(t, homeFixture, "https://www.youtube.com/");
  assert.deepEqual(readVideos(cards, home), HOME_VIDEOS);
});

test("leaves Shorts, Shorts shelves and ads out of the Home grid", (t) => {
  const { document, cards, home } = load(t, homeFixture, "https://www.youtube.com/");
  const items = cards.findItems(home);
  assert.ok(!foundAny(document, items, "ytd-ad-slot-renderer, ytd-rich-section-renderer"));
  // The grid's own Short card is found but isn't read as a video, so shorts.css decides whether it shows.
  const short = items.find((item) => item.querySelector('a[href^="/shorts/"]'));
  assert.equal(cards.readVideo(short), null);
});

test("finds the Subscriptions grid", (t) => {
  const markup = homeFixture.replaceAll('page-subtype="home"', 'page-subtype="subscriptions"');
  const { cards, home, subscriptions } = load(t, markup, "https://www.youtube.com/feed/subscriptions");
  assert.deepEqual(readVideos(cards, subscriptions), HOME_VIDEOS);
  assert.equal(cards.findItems(home).length, 0);
});

test("reads every video in the real search results markup", (t) => {
  const { cards, search } = load(t, searchFixture, SEARCH_URL);
  assert.deepEqual(readVideos(cards, search), [
    {
      id: "soTfFFIQQ8U",
      title: "Design Software Systems Like a Senior Engineer – Complete Course",
      channel: "freeCodeCamp.org",
    },
    {
      id: "C842vFY5kRo",
      title: "System Design Course – APIs, Databases, Caching, CDNs, Load Balancing & Production Infra",
      channel: "freeCodeCamp.org",
    },
    // A playlist is judged by its title, under its own id rather than its first video's.
    { id: "PLWKjhJtqVAbnqBxcdjVGgT3uVR10bzTEB", title: "Python Tutorials", channel: "freeCodeCamp.org" },
  ]);
});

test("leaves channel results, Shorts shelves and ads out of search results", (t) => {
  const { cards, search } = load(t, searchFixture, SEARCH_URL);
  const found = Array.from(cards.findItems(search), (item) => item.localName);
  // The channel result, the shelf's Shorts and the ad all fall outside the search items selector,
  // so this holds without EXCLUDED: the captured page has no search item inside an excluded container.
  assert.deepEqual(found, ["ytd-video-renderer", "ytd-video-renderer", "yt-lockup-view-model"]);
});

test("knows which list each page shows", (t) => {
  const { cards, watch, home, subscriptions, search } = load(t);
  const lists = {
    "/watch": watch,
    "/": home,
    "/feed/recommended": home,
    "/feed/subscriptions": subscriptions,
    "/results": search,
    "/feed/history": null,
    "/@channel": null,
  };
  for (const [pathname, surface] of Object.entries(lists)) assert.equal(cards.surfaceFor(pathname), surface, pathname);
});
