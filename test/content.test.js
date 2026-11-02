import assert from "node:assert/strict";
import test from "node:test";
import FakeTimers from "@sinonjs/fake-timers";
import { JSDOM } from "jsdom";
import { fakeChrome, flush, loadLabels, read, readJson, runScripts } from "./helpers.js";

const scripts = ["src/settings.js", "src/scheduler.js", "src/labels.js", "src/cards.js", "src/content.js"];
const HOME_PAGE = "ytd-browse";

// Structure observed on desktop YouTube. No account data is needed by the tests.
function homeMarkup({ selected = false, label = "Your custom feed", legacy = false } = {}) {
  const content = legacy ? label : `
    <chip-shape role="presentation">
      <button role="tab" aria-selected="${selected}">
        <div class="ytChipShapeText">${label}</div>
      </button>
    </chip-shape>`;
  return `<ytd-browse page-subtype="home">
    <ytd-rich-grid-renderer>
      <ytd-feed-filter-chip-bar-renderer>
        <iron-selector role="tablist">
          <yt-chip-cloud-chip-renderer id="custom" ${selected ? "selected" : ""}>
            ${content}
          </yt-chip-cloud-chip-renderer>
          <yt-chip-cloud-chip-renderer>
            <button id="all" role="tab" aria-selected="${!selected}">All</button>
          </yt-chip-cloud-chip-renderer>
        </iron-selector>
        <button id="next" aria-label="Next">›</button>
      </ytd-feed-filter-chip-bar-renderer>
    </ytd-rich-grid-renderer>
  </ytd-browse>`;
}

// What YouTube does to the chips when All becomes the selected tab.
function selectAll(document) {
  document.querySelector("#custom")?.removeAttribute("selected");
  document.querySelector('#custom [role="tab"]')?.setAttribute("aria-selected", "false");
  document.querySelector("#all").setAttribute("aria-selected", "true");
}

const isCustomSelected = (document) =>
  document.querySelector('#custom [role="tab"]').getAttribute("aria-selected") === "true";

async function setup(t, { path = "/", markup = homeMarkup(), acceptClick = () => true, stored = {} } = {}) {
  const dom = new JSDOM(`<a id="logo" href="/">YouTube Home</a>${markup}`, {
    url: `https://www.youtube.com${path}`,
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const { window } = dom;
  const { document } = window;
  const clock = FakeTimers.withGlobal(window).install({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance"],
  });

  // jsdom has no layout engine. Supply only the visibility needed by this script.
  window.Element.prototype.checkVisibility = function () {
    return this.isConnected && !this.closest('[hidden], [style*="display: none"]');
  };

  const state = { clicks: 0 };
  document.addEventListener("click", (event) => {
    if (event.target.closest("a")) event.preventDefault();
    if (event.target.closest("#all")) selectAll(document);
    if (event.target.closest("#custom")) {
      state.clicks += 1;
      if (acceptClick(state.clicks)) {
        document.querySelector("#custom").setAttribute("selected", "");
        document.querySelector('#custom [role="tab"]')?.setAttribute("aria-selected", "true");
        document.querySelector("#all").setAttribute("aria-selected", "false");
      }
    }
  });

  const dispatch = (name) => document.dispatchEvent(new window.Event(name));
  const navigate = (path, markup = homeMarkup()) => {
    dispatch("yt-navigate-start");
    window.history.pushState({}, "", path);
    document.querySelector(HOME_PAGE)?.remove();
    document.body.insertAdjacentHTML("beforeend", markup);
    dispatch("yt-navigate-finish");
  };
  const chrome = fakeChrome({ stored });
  const changeSettings = async (changes) => {
    await chrome.storage.sync.set(changes);
    await flush();
  };

  t.after(() => {
    window.dispatchEvent(new window.Event("pagehide"));
    clock.uninstall();
    window.close();
  });

  window.chrome = chrome;
  runScripts(dom.getInternalVMContext(), scripts);
  await flush();
  return { window, document, clock, state, dispatch, navigate, changeSettings };
}

test("selects the custom feed on initial load and stops all timers", async (t) => {
  const { state, document, clock } = await setup(t);
  assert.equal(state.clicks, 1);
  assert.ok(isCustomSelected(document));
  assert.equal(clock.countTimers(), 0);
});

test("does not click an already selected custom feed", async (t) => {
  const { state, clock } = await setup(t, { markup: homeMarkup({ selected: true }) });
  clock.tick(30_000);
  assert.equal(state.clicks, 0);
  assert.equal(clock.countTimers(), 0);
});

test("waits for the asynchronously rendered chip bar", async (t) => {
  const { state, document, clock } = await setup(t, { markup: "" });
  clock.tick(2_000);
  assert.equal(state.clicks, 0);
  document.body.insertAdjacentHTML("beforeend", homeMarkup());
  await clock.tickAsync(100);
  assert.equal(state.clicks, 1);
  assert.equal(clock.countTimers(), 0);
});

test("waits for a hidden home page to become visible", async (t) => {
  const { state, document, clock } = await setup(t, {
    markup: homeMarkup().replace('<ytd-browse page-subtype="home">', '<ytd-browse page-subtype="home" hidden>'),
  });
  assert.equal(state.clicks, 0);
  document.querySelector(HOME_PAGE).removeAttribute("hidden");
  await clock.tickAsync(100);
  assert.equal(state.clicks, 1);
});

test("catches a layout change that no watched mutation reports", async (t) => {
  const { state, document, clock } = await setup(t, {
    markup: homeMarkup().replace('<ytd-browse page-subtype="home">', '<ytd-browse page-subtype="home" style="display: none">'),
  });
  assert.equal(state.clicks, 0);
  // Like a CSS class change on YouTube, this attribute isn't one the script watches.
  document.querySelector(HOME_PAGE).removeAttribute("style");
  await clock.tickAsync(500);
  assert.equal(state.clicks, 1);
});

test("ignores a disabled tab until it becomes available", async (t) => {
  const { state, document, clock } = await setup(t, {
    markup: homeMarkup().replace('id="custom"', 'id="custom" aria-disabled="true"'),
  });
  assert.equal(state.clicks, 0);
  document.querySelector("#custom").removeAttribute("aria-disabled");
  await clock.tickAsync(100);
  assert.equal(state.clicks, 1);
});

test("retries when the first click arrives before YouTube is ready", async (t) => {
  const { state, clock } = await setup(t, { acceptClick: (count) => count === 2 });
  assert.equal(state.clicks, 1);
  clock.tick(999);
  assert.equal(state.clicks, 1);
  clock.tick(1);
  assert.equal(state.clicks, 2);
  assert.equal(clock.countTimers(), 0);
});

test("limits retries when clicks never select the tab", async (t) => {
  const { state, clock } = await setup(t, { acceptClick: () => false });
  clock.tick(30_000);
  assert.equal(state.clicks, 3);
  assert.equal(clock.countTimers(), 0);
});

test("stops waiting when the feature is missing", async (t) => {
  const { state, document, clock, dispatch } = await setup(t, { markup: "" });
  clock.tick(20_000);
  assert.equal(clock.countTimers(), 0);
  document.body.insertAdjacentHTML("beforeend", homeMarkup());
  dispatch("yt-page-data-updated");
  await clock.tickAsync(1_000);
  assert.equal(state.clicks, 0);
  assert.equal(clock.countTimers(), 0);
});

for (const path of ["/watch?v=example", "/results?search_query=example", "/feed/subscriptions", "/shorts/example", "/@channel", "/playlist?list=example"]) {
  test(`does not select even a cached home tab while on ${path}`, async (t) => {
    const { state, clock } = await setup(t, { path });
    clock.tick(30_000);
    assert.equal(state.clicks, 0);
    assert.equal(clock.countTimers(), 0);
  });
}

test("does not select a similarly named button outside the homepage chip bar", async (t) => {
  const { state, clock } = await setup(t, {
    markup: '<ytd-browse page-subtype="home"><button id="custom">Your custom feed</button></ytd-browse>',
  });
  clock.tick(30_000);
  assert.equal(state.clicks, 0);
});

test("selects the feed when navigating from a video to Home without a reload", async (t) => {
  const { state, navigate } = await setup(t, { path: "/watch?v=example", markup: "" });
  navigate("/");
  assert.equal(state.clicks, 1);
  navigate("/feed/subscriptions", "");
  assert.equal(state.clicks, 1);
  navigate("/");
  assert.equal(state.clicks, 2);
});

test("manual All selection survives same-URL navigation events and DOM updates", async (t) => {
  const { state, document, clock, dispatch } = await setup(t);
  document.querySelector("#all").click();
  dispatch("yt-navigate-start");
  dispatch("yt-navigate-finish");
  dispatch("yt-page-data-updated");
  document.querySelector(HOME_PAGE).append(document.createElement("div"));
  await clock.tickAsync(5_000);
  assert.equal(state.clicks, 1);
  assert.equal(document.querySelector("#all").getAttribute("aria-selected"), "true");
  assert.equal(clock.countTimers(), 0);
});

test("a manual tab choice cancels an outstanding automatic retry", async (t) => {
  const { state, document, clock } = await setup(t, { acceptClick: () => false });
  document.querySelector("#all").click();
  clock.tick(30_000);
  assert.equal(state.clicks, 1);
  assert.equal(clock.countTimers(), 0);
});

test("scrolling the chip bar does not count as a manual tab choice", async (t) => {
  const { state, document, clock } = await setup(t, { acceptClick: (count) => count === 2 });
  document.querySelector("#next").click();
  clock.tick(1_000);
  assert.equal(state.clicks, 2);
});

test("a Home link starts a new visit even when the URL stays the same", async (t) => {
  const { state, document, navigate } = await setup(t);
  document.querySelector("#all").click();
  document.querySelector("#logo").click();
  navigate("/");
  assert.equal(state.clicks, 2);
});

test("logo navigation restores the custom feed after a delayed reset to All", async (t) => {
  const { state, document, clock, dispatch } = await setup(t);
  document.querySelector("#logo").click();
  dispatch("yt-navigate-start");
  // YouTube can announce navigation completion while the old chip is selected.
  dispatch("yt-navigate-finish");
  await clock.tickAsync(4_000);
  selectAll(document);
  await clock.tickAsync(100);
  assert.equal(state.clicks, 2);
  assert.equal(document.querySelector("#all").getAttribute("aria-selected"), "false");
  await clock.tickAsync(20_000);
  assert.equal(clock.countTimers(), 0);
});

test("a same-page Home click works without YouTube navigation events", async (t) => {
  const { state, document, clock } = await setup(t);
  document.querySelector("#logo").click();
  await clock.tickAsync(1_000);
  document.querySelector(HOME_PAGE).outerHTML = homeMarkup();
  await clock.tickAsync(100);
  assert.equal(state.clicks, 2);
});

test("a second delayed render cannot undo a successful selection after a logo click", async (t) => {
  const { state, document, clock, navigate } = await setup(t);
  document.querySelector("#logo").click();
  navigate("/");
  assert.equal(state.clicks, 2);
  await clock.tickAsync(4_000);
  document.querySelector(HOME_PAGE).outerHTML = homeMarkup();
  await clock.tickAsync(100);
  assert.equal(state.clicks, 3);
  assert.equal(document.querySelector("#all").getAttribute("aria-selected"), "false");
});

test("manual All selection during the Home refresh guard is respected", async (t) => {
  const { state, document, clock, dispatch } = await setup(t);
  document.querySelector("#logo").click();
  dispatch("yt-navigate-start");
  dispatch("yt-navigate-finish");
  document.querySelector("#all").click();
  dispatch("yt-page-data-updated");
  await clock.tickAsync(30_000);
  assert.equal(state.clicks, 1);
  assert.equal(document.querySelector("#all").getAttribute("aria-selected"), "true");
  assert.equal(clock.countTimers(), 0);
});

test("the Home refresh guard expires even when the existing custom tab never resets", async (t) => {
  const { state, document, clock, dispatch } = await setup(t);
  document.querySelector("#logo").click();
  dispatch("yt-navigate-finish");
  await clock.tickAsync(30_000);
  assert.equal(state.clicks, 1);
  assert.equal(clock.countTimers(), 0);
});

test("opening Home in a new tab does not reset the current visit", async (t) => {
  const { window, state, document, dispatch } = await setup(t);
  document.querySelector("#all").click();
  document.querySelector("#logo").dispatchEvent(new window.MouseEvent("click", { bubbles: true, ctrlKey: true }));
  dispatch("yt-navigate-finish");
  assert.equal(state.clicks, 1);
});

test("suspends pending retries during navigation away from Home", async (t) => {
  const { state, clock, dispatch, window } = await setup(t, { acceptClick: () => false });
  dispatch("yt-navigate-start");
  clock.tick(10_000);
  assert.equal(state.clicks, 1);
  assert.equal(clock.countTimers(), 0);
  window.history.pushState({}, "", "/watch?v=example");
  dispatch("yt-navigate-finish");
  assert.equal(clock.countTimers(), 0);
});

test("retries remain bounded across navigation events from the custom-feed click", async (t) => {
  const { state, clock, dispatch } = await setup(t, { acceptClick: () => false });
  for (let i = 0; i < 10; i += 1) {
    dispatch("yt-navigate-start");
    dispatch("yt-navigate-finish");
    clock.tick(1_000);
  }
  assert.equal(state.clicks, 3);
  assert.equal(clock.countTimers(), 0);
});

test("restoring Home from the back-forward cache starts a fresh visit", async (t) => {
  const { state, document, window } = await setup(t);
  document.querySelector("#all").click();
  window.dispatchEvent(new window.Event("pagehide"));
  window.dispatchEvent(new window.PageTransitionEvent("pageshow", { persisted: true }));
  assert.equal(state.clicks, 2);
});

test("browser history navigation can return Home after leaving", async (t) => {
  const { state, window, dispatch } = await setup(t);
  window.history.pushState({}, "", "/watch?v=example");
  window.dispatchEvent(new window.PopStateEvent("popstate"));
  window.history.pushState({}, "", "/");
  dispatch("yt-page-data-updated");
  // The previous custom tab is still selected; there is no need to click it again.
  assert.equal(state.clicks, 1);
});

test("supports whitespace variations and older chip-renderer markup", async (t) => {
  const { state } = await setup(t, { markup: homeMarkup({ label: "  Your\n custom   feed ", legacy: true }) });
  assert.equal(state.clicks, 1);
});

test("supports homepage query parameters and the recommended-feed route", async (t) => {
  const { state, navigate } = await setup(t, { path: "/?app=desktop" });
  assert.equal(state.clicks, 1);
  navigate("/watch?v=example", "");
  navigate("/feed/recommended");
  assert.equal(state.clicks, 2);
});

test("recognizes the tab in the ten most spoken languages", async (t) => {
  const labels = loadLabels();
  assert.deepEqual(Object.keys(labels), ["en", "zh", "hi", "es", "ar", "fr", "bn", "pt", "ru", "id"]);
  for (const [language, names] of Object.entries(labels)) {
    for (const label of names) {
      await t.test(`${language}: ${label}`, async (t) => {
        const { state } = await setup(t, { markup: homeMarkup({ label }) });
        assert.equal(state.clicks, 1);
      });
    }
  }
});

for (const [variant, label] of [
  ["different case", "YOUR CUSTOM FEED"],
  ["missing accents", "Flux personnalise"],
  ["missing Arabic diacritics", "خلاصة مخصصة"],
  ["a precomposed Hindi nukta", "कस्टम फ़ीड"],
  ["the label only in aria-label", '<span aria-hidden="true"></span>'],
]) {
  test(`matches labels with ${variant}`, async (t) => {
    let markup = homeMarkup({ label });
    if (variant.includes("aria-label")) markup = markup.replace('role="tab" aria-selected', 'role="tab" aria-label="Feed personalizado" aria-selected');
    const { state } = await setup(t, { markup });
    assert.equal(state.clicks, 1);
  });
}

for (const label of ["Custom feeds", "New custom feed", "Feed", "Personalizado"]) {
  test(`does not mistake "${label}" for the custom feed tab`, async (t) => {
    const { state, clock } = await setup(t, { markup: homeMarkup({ label }) });
    clock.tick(30_000);
    assert.equal(state.clicks, 0);
  });
}

test("does nothing while turned off", async (t) => {
  const { state, document, clock, dispatch } = await setup(t, { stored: { enabled: false, enforce: true } });
  document.querySelector("#logo").click();
  dispatch("yt-navigate-finish");
  clock.tick(30_000);
  assert.equal(state.clicks, 0);
  assert.equal(clock.countTimers(), 0);
});

test("turning it on selects the custom feed right away", async (t) => {
  const { state, document, changeSettings } = await setup(t, { stored: { enabled: false } });
  await changeSettings({ enabled: true });
  assert.equal(state.clicks, 1);
  assert.ok(isCustomSelected(document));
});

test("turning it off cancels a pending retry", async (t) => {
  const { state, clock, changeSettings } = await setup(t, { acceptClick: () => false });
  await changeSettings({ enabled: false });
  clock.tick(30_000);
  assert.equal(state.clicks, 1);
  assert.equal(clock.countTimers(), 0);
});

test("enforcement mode ignores clicks on other Home tabs", async (t) => {
  const { window, state, document } = await setup(t, { stored: { enforce: true } });
  assert.equal(state.clicks, 1);
  const click = new window.MouseEvent("click", { bubbles: true, cancelable: true });
  document.querySelector("#all").dispatchEvent(click);
  assert.ok(click.defaultPrevented);
  assert.ok(isCustomSelected(document));
  assert.equal(document.querySelector("#all").getAttribute("aria-selected"), "false");
});

test("enforcement mode lets clicks on the custom feed and chip bar arrows through", async (t) => {
  const { window, document } = await setup(t, { stored: { enforce: true } });
  for (const selector of ['#custom [role="tab"]', "#next"]) {
    const click = new window.MouseEvent("click", { bubbles: true, cancelable: true });
    document.querySelector(selector).dispatchEvent(click);
    assert.equal(click.defaultPrevented, false, selector);
  }
});

test("enforcement mode switches back when YouTube selects another tab anyway", async (t) => {
  const { state, document, clock } = await setup(t, { stored: { enforce: true } });
  await clock.tickAsync(60_000);
  selectAll(document);
  await clock.tickAsync(100);
  assert.equal(state.clicks, 2);
  assert.ok(isCustomSelected(document));
  assert.equal(clock.countTimers(), 0);
});

test("enforcement mode survives a re-render of the chip bar", async (t) => {
  const { state, document, clock } = await setup(t, { stored: { enforce: true } });
  await clock.tickAsync(5_000);
  document.querySelector(HOME_PAGE).outerHTML = homeMarkup();
  await clock.tickAsync(100);
  assert.equal(state.clicks, 2);
  assert.ok(isCustomSelected(document));
});

test("enforcement mode gives up when YouTube keeps ignoring the switch back", async (t) => {
  const { state, document, clock } = await setup(t, { stored: { enforce: true }, acceptClick: (count) => count === 1 });
  selectAll(document);
  await clock.tickAsync(30_000);
  assert.equal(state.clicks, 4);
  assert.equal(clock.countTimers(), 0);
  // Other tabs work again once enforcement has given up.
  document.querySelector("#all").click();
  assert.equal(document.querySelector("#all").getAttribute("aria-selected"), "true");
});

test("enforcement mode leaves other tabs alone when there is no custom feed", async (t) => {
  const { document, clock } = await setup(t, { stored: { enforce: true }, markup: homeMarkup({ label: "Music" }) });
  await clock.tickAsync(30_000);
  document.querySelector("#all").click();
  assert.equal(document.querySelector("#all").getAttribute("aria-selected"), "true");
  assert.equal(clock.countTimers(), 0);
});

test("enforcement mode stops when leaving Home and resumes on return", async (t) => {
  const { state, document, clock, navigate } = await setup(t, { stored: { enforce: true } });
  navigate("/watch?v=example", "");
  assert.equal(clock.countTimers(), 0);
  navigate("/", homeMarkup({ selected: true }));
  selectAll(document);
  await clock.tickAsync(100);
  assert.equal(state.clicks, 2);
});

test("turning enforcement on switches back right away", async (t) => {
  const { state, document, changeSettings } = await setup(t);
  document.querySelector("#all").click();
  await changeSettings({ enforce: true });
  assert.equal(state.clicks, 2);
  assert.ok(isCustomSelected(document));
});

test("turning enforcement off lets other tabs be chosen again", async (t) => {
  const { state, document, clock, changeSettings } = await setup(t, { stored: { enforce: true } });
  await changeSettings({ enforce: false });
  document.querySelector("#all").click();
  await clock.tickAsync(30_000);
  assert.equal(state.clicks, 1);
  assert.equal(document.querySelector("#all").getAttribute("aria-selected"), "true");
  assert.equal(clock.countTimers(), 0);
});

test("the manifest ships only local scripts, asks for host access only on YouTube, and stays on desktop YouTube", () => {
  const manifest = readJson("manifest.json");
  const contentScripts = manifest.content_scripts;
  const js = contentScripts.flatMap((entry) => entry.js);
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ["storage", "offscreen", "contextMenus", "declarativeNetRequestWithHostAccess"]);
  for (const entry of contentScripts) {
    assert.deepEqual(entry.matches, ["https://www.youtube.com/*", "https://youtube.com/*"]);
  }
  // Asking for no more than the content scripts already run on adds no install warning.
  assert.deepEqual(manifest.host_permissions, contentScripts[0].matches);
  // Content scripts share one global scope, so each one loads after the scripts it uses.
  assert.deepEqual(js.filter((path) => scripts.includes(path)), scripts);
  // Extension pages may run WebAssembly but no remote or inline scripts.
  assert.equal(manifest.content_security_policy.extension_pages, "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'");
  const files = [
    ...js,
    ...contentScripts.flatMap((entry) => entry.css),
    manifest.background.service_worker,
    manifest.action.default_popup,
    manifest.options_ui.page,
    ...manifest.declarative_net_request.rule_resources.map((ruleset) => ruleset.path),
  ];
  for (const path of files) assert.ok(read(path));
});
