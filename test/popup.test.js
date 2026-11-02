import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import {
  EVENING,
  PRELOAD,
  STATUS_KEY,
  WORK,
  flush,
  locales,
  openPage,
  optionTexts,
  pickOption,
  read,
  readJson,
  recordMessages,
  untranslated,
} from "./helpers.js";

const alphabetically = (a, b) => a.localeCompare(b);

// The $NAME$ tokens a message uses and the placeholders it defines, so a translation fills the same values.
const placeholderNames = ({ message, placeholders = {} }) => ({
  used: [...message.matchAll(/\$(\w+)\$/g)].map(([, name]) => name.toLowerCase()).toSorted(alphabetically),
  defined: Object.entries(placeholders).map(([name, { content }]) => `${name}=${content}`).toSorted(alphabetically),
});

async function setup(t, options) {
  const page = await openPage(t, "src/popup.html", options);
  const { document } = page;
  const toggle = (name) => document.querySelector(`input[name="${name}"]`);
  const status = document.querySelector("#model-status");
  const summary = document.querySelector("#summary");
  return { ...page, toggle, status, summary };
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

test("a switch the user just clicked still shows a change made elsewhere", async (t) => {
  const { chrome, toggle } = await setup(t);
  toggle("enabled").focus();
  toggle("enabled").click();
  await flush();
  await chrome.storage.sync.set({ enabled: true });
  await flush();
  assert.equal(toggle("enabled").checked, true);
  assert.equal(toggle("enforce").disabled, false);
});

// What a screen reader announces for each switch, in the order the popup shows them.
test("each switch is named by its title and described by its hint", async (t) => {
  const { document } = await setup(t);
  const english = readJson("_locales/en/messages.json");
  const textOf = (id) => document.getElementById(id).textContent;
  const announced = [...document.querySelectorAll(".switch")].map((input) => [
    input.name,
    textOf(input.getAttribute("aria-labelledby")),
    textOf(input.getAttribute("aria-describedby")),
  ]);
  assert.deepEqual(
    announced,
    [
      ["enabled", "autoOpen", "autoOpenHint"],
      ["enforce", "enforce", "enforceHint"],
      ["hideShorts", "hideShorts", "hideShortsHint"],
      ["topicFilter", "topicFilter", "topicFilterHint"],
    ].map(([name, title, hint]) => [name, english[title].message, english[hint].message]),
  );
});

test("shows the model status for the stored topics to see or to avoid while the topic filter is on", async (t) => {
  const none = await setup(t, { stored: { topics: " , " } });
  assert.equal(none.status.hidden, true);

  const avoiding = await setup(t, {
    stored: { topics: "", avoidTopics: "gaming" },
    session: { [STATUS_KEY]: { state: "loading", progress: 0.5 } },
  });
  assert.equal(avoiding.status.hidden, false, "shown with only topics to avoid");

  const { status, toggle } = await setup(t, {
    stored: { topics: "chess" },
    session: { [STATUS_KEY]: { state: "loading", progress: 0.5 } },
  });
  assert.equal(status.hidden, false);
  assert.equal(status.textContent, "Loading the model…");
  toggle("topicFilter").click();
  await flush();
  assert.equal(status.hidden, true, "hidden while the topic filter is off");
});

test("Load now in the popup asks the background to load the model", async (t) => {
  const { document, chrome } = await setup(t, { stored: { topics: "chess" } });
  const sent = recordMessages(chrome);
  document.querySelector("#load-now").click();
  await flush();
  assert.deepEqual(sent, [PRELOAD]);
});

test("Load now moves focus to the model status, since the button turns off", async (t) => {
  const { document, status } = await setup(t, { stored: { topics: "chess" } });
  const loadButton = document.querySelector("#load-now");
  loadButton.focus();
  loadButton.click();
  assert.equal(loadButton.disabled, true);
  assert.equal(document.activeElement, status);
});

test("the summary lists the topics, and clicking it opens the options page, as screen readers hear", async (t) => {
  const { document, chrome, summary } = await setup(t, { stored: { topics: "programming, software engineering, chess" } });
  assert.equal(summary.textContent, "Topics: programming, software engineering, chess");
  assert.equal(document.getElementById(summary.getAttribute("aria-describedby")).textContent, "All settings");
  summary.click();
  assert.equal(chrome.openedOptions, 1);
});

test("the summary says when there are no topics yet", async (t) => {
  const { chrome, summary } = await setup(t);
  assert.equal(summary.textContent, "No topics yet. Add some in All settings.");
  await chrome.storage.sync.set({ topics: "chess" });
  await flush();
  assert.equal(summary.textContent, "Topics: chess");
});

test("the summary lists the topics to avoid", async (t) => {
  const { document, chrome } = await setup(t, { stored: { avoidTopics: "gaming, gossip" } });
  const topicsLine = document.querySelector("#summary-topics");
  const avoidLine = document.querySelector("#summary-avoid");
  assert.equal(topicsLine.hidden, true, "no \"no topics yet\" while there are topics to avoid");
  assert.equal(avoidLine.hidden, false);
  assert.equal(avoidLine.textContent, "Avoiding: gaming, gossip");

  await chrome.storage.sync.set({ topics: "chess" });
  await flush();
  assert.equal(topicsLine.hidden, false);
  assert.equal(topicsLine.textContent, "Topics: chess");

  await chrome.storage.sync.set({ avoidTopics: "" });
  await flush();
  assert.equal(avoidLine.hidden, true);
});

const NO_PROFILE = readJson("_locales/en/messages.json").noProfile.message;

// The popup's profile row and its switch.
async function setupProfiles(t, stored) {
  const page = await setup(t, { stored });
  const row = page.document.querySelector("#profile-row");
  const select = page.document.querySelector("#profile");
  const pick = (value) => pickOption(select, value);
  const listed = () => optionTexts(select);
  return { ...page, row, select, pick, listed };
}

test("shows the profile switch only once a profile exists", async (t) => {
  const none = await setupProfiles(t);
  assert.equal(none.row.hidden, true);
  await none.chrome.storage.sync.set({ profiles: [WORK] });
  await flush();
  assert.equal(none.row.hidden, false);
  assert.deepEqual(none.listed(), [NO_PROFILE, "Work"]);
  assert.equal(none.select.value, "");

  const { row, select, listed } = await setupProfiles(t, { profiles: [WORK, EVENING], activeProfile: "Evening" });
  assert.equal(row.hidden, false);
  assert.deepEqual(listed(), [NO_PROFILE, "Work", "Evening"]);
  assert.equal(select.value, "Evening", "the stored profile is selected");
});

test("switching a profile from the popup saves its topics and updates the summary", async (t) => {
  const { chrome, summary, pick } = await setupProfiles(t, { profiles: [WORK, EVENING], activeProfile: "Work", ...WORK });
  const avoidLine = summary.querySelector("#summary-avoid");
  assert.equal(avoidLine.textContent, "Avoiding: gaming");
  pick("Evening");
  await flush();
  const { activeProfile, topics, avoidTopics } = chrome.data;
  assert.deepEqual({ activeProfile, topics, avoidTopics }, { activeProfile: "Evening", topics: "cooking, chess", avoidTopics: "" });
  assert.equal(summary.querySelector("#summary-topics").textContent, "Topics: cooking, chess");
  assert.equal(avoidLine.hidden, true);
});

test("the profile switch is disabled while the filter is off", async (t) => {
  const { toggle, select } = await setupProfiles(t, { topicFilter: false, profiles: [WORK], activeProfile: "Work" });
  assert.equal(select.disabled, true);
  toggle("topicFilter").click();
  assert.equal(select.disabled, false);
});

test("All settings and the gear open the options page", async (t) => {
  const { document, chrome } = await setup(t);
  const link = document.querySelector("#open-options");
  const gear = document.querySelector("#open-options-icon");
  assert.equal(link.textContent, "All settings");
  assert.equal(gear.getAttribute("aria-label"), "All settings");
  link.click();
  gear.click();
  assert.equal(chrome.openedOptions, 2);
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
    assert.deepEqual(untranslated(document), [], locale);
  }
});

// Links in the popup only open when they target a new tab.
test("links to the source code in a new tab", async (t) => {
  const { document } = await setup(t);
  const link = document.querySelector("footer a");
  assert.equal(link.href, "https://github.com/r-afael/better-yt-recommendations");
  assert.equal(link.target, "_blank");
  assert.equal(link.textContent, "Source code on GitHub");
});

test("translations cover the ten most spoken languages with the same messages as English", () => {
  assert.deepEqual(locales.toSorted(alphabetically), ["ar", "bn", "en", "es", "fr", "hi", "id", "pt", "ru", "zh_CN", "zh_TW"]);
  const english = readJson("_locales/en/messages.json");
  const keys = Object.keys(english).toSorted(alphabetically);
  for (const locale of locales) {
    const messages = readJson(`_locales/${locale}/messages.json`);
    assert.deepEqual(Object.keys(messages).toSorted(alphabetically), keys, locale);
    assert.equal(messages.lang.message.replace("-", "_"), locale, locale);
    for (const key of keys) {
      assert.deepEqual(placeholderNames(messages[key]), placeholderNames(english[key]), `${locale} ${key}`);
    }
  }
});

// The options page and the popup both name their sections and most settings in English in the
// markup too, where checks of the markup read them, so that text has to stay the English message
// that replaces it. One test covers both pages.
test("the pages' English text in the markup matches the English messages", () => {
  const english = readJson("_locales/en/messages.json");
  for (const path of ["src/options.html", "src/popup.html"]) {
    const { document } = new JSDOM(read(path)).window;
    const named = [...document.querySelectorAll("[data-i18n]")].filter((element) => element.textContent);
    assert.deepEqual(
      named.map((element) => [element.dataset.i18n, element.textContent]),
      named.map((element) => [element.dataset.i18n, english[element.dataset.i18n].message]),
      path,
    );
  }
});

test("the manifest's messages exist in the default locale", () => {
  const manifest = readJson("manifest.json");
  const messages = readJson(`_locales/${manifest.default_locale}/messages.json`);
  for (const [, key] of JSON.stringify(manifest).matchAll(/__MSG_(\w+)__/g)) {
    assert.ok(messages[key], key);
  }
});
