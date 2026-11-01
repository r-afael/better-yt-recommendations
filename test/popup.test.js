import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import test from "node:test";
import FakeTimers from "@sinonjs/fake-timers";
import { JSDOM } from "jsdom";
import { fakeChrome, flush, read, readJson, runScripts } from "./helpers.js";

const html = read("src/popup.html");
const scripts = ["src/settings.js", "src/protocol.js", "src/topics.js", "src/popup.js"];
const STATUS_KEY = "modelStatus";
const SAVE_DELAY_MS = 400;
const localeDirectory = new URL("../_locales/", import.meta.url);
const locales = readdirSync(localeDirectory);
const alphabetically = (a, b) => a.localeCompare(b);

async function setup(t, options) {
  const dom = new JSDOM(html, { runScripts: "outside-only" });
  const { window } = dom;
  const clock = FakeTimers.withGlobal(window).install({ toFake: ["setTimeout", "clearTimeout"] });
  const chrome = fakeChrome(options);
  window.chrome = chrome;
  runScripts(dom.getInternalVMContext(), scripts);
  await flush();
  t.after(() => {
    clock.uninstall();
    window.close();
  });

  const { document } = window;
  const toggle = (name) => document.querySelector(`input[name="${name}"]`);
  const field = document.querySelector('textarea[name="topics"]');
  const status = document.querySelector("#model-status");
  const progressBar = document.querySelector("#model-progress");
  const type = (text) => {
    field.value = text;
    field.dispatchEvent(new window.Event("input", { bubbles: true }));
  };
  const commit = () => field.dispatchEvent(new window.Event("change", { bubbles: true }));
  return { window, document, chrome, clock, toggle, field, status, progressBar, type, commit };
}

// What the background stores while the model loads, as chrome.storage.session reports it.
async function reportStatus(chrome, status) {
  await chrome.storage.session.set({ [STATUS_KEY]: status });
  await flush();
}

test("shows the stored settings", async (t) => {
  const { toggle } = await setup(t, { stored: { enabled: true, enforce: true } });
  assert.equal(toggle("enabled").checked, true);
  assert.equal(toggle("enforce").checked, true);
  assert.equal(toggle("enforce").disabled, false);
});

test("defaults to opening the custom feed without enforcement", async (t) => {
  const { toggle } = await setup(t);
  assert.equal(toggle("enabled").checked, true);
  assert.equal(toggle("enforce").checked, false);
});

test("saves each toggle as it changes", async (t) => {
  const { chrome, toggle } = await setup(t);
  toggle("enforce").click();
  await flush();
  assert.equal(chrome.data.enforce, true);
  toggle("enabled").click();
  await flush();
  assert.equal(chrome.data.enabled, false);
});

test("enforcement mode can only be changed while the custom feed opens automatically", async (t) => {
  const { toggle } = await setup(t, { stored: { enabled: false } });
  assert.equal(toggle("enforce").disabled, true);
  toggle("enabled").click();
  assert.equal(toggle("enforce").disabled, false);
});

test("saves the topic filter toggle as it changes", async (t) => {
  const { chrome, toggle } = await setup(t);
  assert.equal(toggle("topicFilter").checked, true);
  toggle("topicFilter").click();
  await flush();
  assert.equal(chrome.data.topicFilter, false);
});

test("Hide Shorts starts off and saves as it changes", async (t) => {
  const { chrome, toggle } = await setup(t);
  assert.equal(toggle("hideShorts").checked, false);
  toggle("hideShorts").click();
  await flush();
  assert.equal(chrome.data.hideShorts, true);
});

test("shows the stored topics", async (t) => {
  const { field } = await setup(t, { stored: { topics: "chess, cooking" } });
  assert.equal(field.value, "chess, cooking");
});

test("saves the topics once typing pauses", async (t) => {
  const { chrome, clock, type } = await setup(t);
  type("chess");
  type("chess, cooking");
  clock.tick(SAVE_DELAY_MS - 1);
  assert.equal(chrome.data.topics, undefined);
  clock.tick(1);
  assert.equal(chrome.data.topics, "chess, cooking");
});

test("saves the topics right away when the field changes", async (t) => {
  const { chrome, clock, type, commit } = await setup(t);
  type("chess");
  commit();
  assert.equal(chrome.data.topics, "chess");
  chrome.data.topics = "saved elsewhere";
  clock.tick(SAVE_DELAY_MS);
  assert.equal(chrome.data.topics, "saved elsewhere", "the pending save was cancelled");
});

// Chrome fires blur when the popup closes by a click outside it, and pagehide otherwise.
for (const event of ["pagehide", "blur"]) {
  test(`saves unsaved typing on ${event}`, async (t) => {
    const { window, chrome, type } = await setup(t);
    type("chess");
    window.dispatchEvent(new window.Event(event));
    assert.equal(chrome.data.topics, "chess");
  });
}

test("closing the popup without typing saves nothing", async (t) => {
  const { window, chrome } = await setup(t);
  window.dispatchEvent(new window.Event("pagehide"));
  assert.equal(chrome.data.topics, undefined);
});

test("topics can only be edited while the topic filter is on", async (t) => {
  const { field, toggle } = await setup(t, { stored: { topicFilter: false } });
  assert.equal(field.disabled, true);
  toggle("topicFilter").click();
  assert.equal(field.disabled, false);
  toggle("topicFilter").click();
  assert.equal(field.disabled, true);
});

test("describes each model state", async (t) => {
  const { chrome, status, progressBar } = await setup(t, { stored: { topics: "chess" } });
  assert.equal(status.hidden, false);
  assert.equal(status.textContent, "The model loads when you open a video.");
  assert.equal(status.getAttribute("role"), "status");
  assert.equal(progressBar.hidden, true);

  await reportStatus(chrome, { state: "loading", progress: 0.426 });
  assert.equal(status.textContent, "Loading the model…");
  assert.equal(progressBar.hidden, false);
  assert.equal(progressBar.value, 43);
  await reportStatus(chrome, { state: "ready" });
  assert.equal(status.textContent, "The model is ready.");
  assert.equal(progressBar.hidden, true);
  await reportStatus(chrome, { state: "error" });
  assert.equal(status.textContent, "Couldn't load the model. It will try again shortly.");
  await chrome.storage.session.remove(STATUS_KEY);
  await flush();
  assert.equal(status.textContent, "The model loads when you open a video.");
});

test("announces loading once while the progress bar follows the download", async (t) => {
  const { window, chrome, status, progressBar } = await setup(t, { stored: { topics: "chess" } });
  const announced = [];
  const observer = new window.MutationObserver(() => announced.push(status.textContent));
  observer.observe(status, { childList: true, characterData: true, subtree: true });
  for (const progress of [0.01, 0.02, 0.5]) await reportStatus(chrome, { state: "loading", progress });
  assert.deepEqual(announced, ["Loading the model…"]);
  assert.equal(progressBar.value, 50);
});

test("shows the model status stored before the popup opened", async (t) => {
  const { status, progressBar } = await setup(t, {
    stored: { topics: "chess" },
    session: { [STATUS_KEY]: { state: "loading", progress: 0.5 } },
  });
  assert.equal(status.textContent, "Loading the model…");
  assert.equal(progressBar.value, 50);
});

test("hides the model status until there are topics to match", async (t) => {
  const { status, type } = await setup(t);
  assert.equal(status.hidden, true);
  type(" , ");
  assert.equal(status.hidden, true);
  type("chess");
  assert.equal(status.hidden, false);
});

test("hides the model status while the topic filter is off", async (t) => {
  const { status, progressBar, toggle } = await setup(t, {
    stored: { topics: "chess", topicFilter: false },
    session: { [STATUS_KEY]: { state: "loading", progress: 0.5 } },
  });
  assert.equal(status.hidden, true);
  assert.equal(progressBar.hidden, true);
  toggle("topicFilter").click();
  assert.equal(status.hidden, false);
  assert.equal(progressBar.hidden, false);
});

test("ignores storage changes that aren't the model status", async (t) => {
  const { chrome, status } = await setup(t, { stored: { topics: "chess" } });
  await chrome.storage.session.set({ other: { state: "ready" } });
  await chrome.storage.sync.set({ [STATUS_KEY]: { state: "ready" } });
  await flush();
  assert.equal(status.textContent, "The model loads when you open a video.");
});

test("uses the browser's language and direction", async (t) => {
  const { document } = await setup(t, { locale: "ar" });
  const messages = readJson("_locales/ar/messages.json");
  assert.equal(document.documentElement.lang, "ar");
  assert.equal(document.documentElement.dir, "rtl");
  assert.equal(document.querySelector("#enforce-title").textContent, messages.enforce.message);
});

test("every translation fills every popup text", async (t) => {
  for (const locale of locales) {
    const { document } = await setup(t, { locale });
    for (const element of document.querySelectorAll("[data-i18n]")) {
      assert.notEqual(element.textContent.trim(), "", `${locale}: ${element.dataset.i18n}`);
    }
    for (const element of document.querySelectorAll("[data-i18n-placeholder]")) {
      assert.notEqual(element.placeholder.trim(), "", `${locale}: ${element.dataset.i18nPlaceholder}`);
    }
  }
});

test("translates the topics placeholder and the model's status", async (t) => {
  const { field, status } = await setup(t, {
    locale: "es",
    stored: { topics: "ajedrez" },
    session: { [STATUS_KEY]: { state: "loading", progress: 0.07 } },
  });
  const messages = readJson("_locales/es/messages.json");
  assert.equal(field.placeholder, messages.topicsPlaceholder.message);
  assert.equal(status.textContent, "Cargando el modelo…");
});

test("translations cover the ten most spoken languages with the same messages as English", () => {
  assert.deepEqual(locales.toSorted(alphabetically), ["ar", "bn", "en", "es", "fr", "hi", "id", "pt", "ru", "zh_CN", "zh_TW"]);
  const keys = Object.keys(readJson("_locales/en/messages.json")).toSorted(alphabetically);
  for (const locale of locales) {
    const messages = readJson(`_locales/${locale}/messages.json`);
    assert.deepEqual(Object.keys(messages).toSorted(alphabetically), keys, locale);
    assert.equal(messages.lang.message.replace("-", "_"), locale, locale);
  }
});

test("the manifest's messages exist in the default locale", () => {
  const manifest = readJson("manifest.json");
  const messages = readJson(`_locales/${manifest.default_locale}/messages.json`);
  for (const [, key] of JSON.stringify(manifest).matchAll(/__MSG_(\w+)__/g)) {
    assert.ok(messages[key], key);
  }
});
