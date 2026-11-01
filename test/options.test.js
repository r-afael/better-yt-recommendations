import assert from "node:assert/strict";
import test from "node:test";
import { STATUS_KEY, flush, locales, openPage, readJson, untranslated } from "./helpers.js";

const SAVE_DELAY_MS = 400;

async function setup(t, options) {
  const page = await openPage(t, "src/options.html", options);
  const { window, document } = page;
  const toggle = (name) => document.querySelector(`input[name="${name}"]`);
  const field = document.querySelector('textarea[name="topics"]');
  const status = document.querySelector("#model-status");
  const progressBar = document.querySelector("#model-progress");
  const type = (text) => {
    field.value = text;
    field.dispatchEvent(new window.Event("input", { bubbles: true }));
  };
  const commit = () => field.dispatchEvent(new window.Event("change", { bubbles: true }));
  const slider = document.querySelector('input[name="threshold"]');
  const sliderValue = document.querySelector("#threshold-value");
  // Moves the slider the way a drag or an arrow key does: input, then change.
  const slide = (value) => {
    slider.value = String(value);
    slider.dispatchEvent(new window.Event("input", { bubbles: true }));
    slider.dispatchEvent(new window.Event("change", { bubbles: true }));
  };
  return { ...page, toggle, field, status, progressBar, type, commit, slider, sliderValue, slide };
}

// What the background stores while the model loads, as chrome.storage.session reports it.
async function reportStatus(chrome, status) {
  await chrome.storage.session.set({ [STATUS_KEY]: status });
  await flush();
}

test("the topic filter switch on the options page saves and enables the fields", async (t) => {
  const { chrome, toggle, field, slider } = await setup(t, { stored: { topicFilter: false } });
  assert.equal(field.disabled, true);
  assert.equal(slider.disabled, true);
  toggle("topicFilter").click();
  await flush();
  assert.equal(chrome.data.topicFilter, true);
  assert.equal(field.disabled, false);
  assert.equal(slider.disabled, false);
  toggle("topicFilter").click();
  assert.equal(field.disabled, true);
  assert.equal(slider.disabled, true);
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

test("shows a change made elsewhere without overwriting the field being typed in", async (t) => {
  const { chrome, clock, toggle, field, type } = await setup(t);
  field.focus();
  type("chess");
  clock.tick(SAVE_DELAY_MS);
  await chrome.storage.sync.set({ topicFilter: false, topics: "elsewhere" });
  await flush();
  assert.equal(toggle("topicFilter").checked, false);
  assert.equal(field.value, "chess");
});

// Chrome fires blur when the page loses focus, such as on a switch to another tab, and pagehide when it closes.
for (const event of ["pagehide", "blur"]) {
  test(`saves unsaved typing on ${event}`, async (t) => {
    const { window, chrome, type } = await setup(t);
    type("chess");
    window.dispatchEvent(new window.Event(event));
    assert.equal(chrome.data.topics, "chess");
  });
}

test("closing the page without typing saves nothing", async (t) => {
  const { window, chrome } = await setup(t);
  window.dispatchEvent(new window.Event("pagehide"));
  assert.equal(chrome.data.topics, undefined);
});

test("shows the stored sensitivity, or 0.25 by default", async (t) => {
  const { slider, sliderValue } = await setup(t);
  assert.equal(slider.valueAsNumber, 0.25);
  assert.equal(sliderValue.value, "0.25");

  const stored = await setup(t, { stored: { threshold: 0.3 } });
  assert.equal(stored.slider.valueAsNumber, 0.3);
  assert.equal(stored.sliderValue.value, "0.30");
});

test("saves the sensitivity as a number once the slider pauses, showing each value as it moves", async (t) => {
  const { chrome, clock, slide, sliderValue } = await setup(t);
  slide(0.31);
  assert.equal(sliderValue.value, "0.31");
  slide(0.32);
  clock.tick(SAVE_DELAY_MS - 1);
  assert.equal(chrome.data.threshold, undefined);
  clock.tick(1);
  assert.equal(chrome.data.threshold, 0.32);
});

test("saves both the topics and the sensitivity when the user moves from one to the other", async (t) => {
  const { window, chrome, type, slide } = await setup(t);
  type("chess");
  slide(0.2);
  assert.equal(chrome.data.topics, "chess");
  window.dispatchEvent(new window.Event("pagehide"));
  assert.equal(chrome.data.threshold, 0.2);
});

test("shows the sensitivity in the browser's language", async (t) => {
  const { sliderValue } = await setup(t, { locale: "ar", stored: { threshold: 0.3 } });
  assert.equal(sliderValue.value, (0.3).toLocaleString("ar", { minimumFractionDigits: 2 }));
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

test("shows the model status stored before the page opened", async (t) => {
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

test("every translation fills every options page text", async (t) => {
  for (const locale of locales) {
    const { document } = await setup(t, { locale });
    assert.deepEqual(untranslated(document), [], locale);
  }
});
