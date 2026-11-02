import assert from "node:assert/strict";
import test from "node:test";
import {
  EVENING,
  MATCH,
  PRELOAD,
  STATUS_KEY,
  WORK,
  channelNames,
  fakeChrome,
  flush,
  holdMessages,
  locales,
  manyProfiles,
  openPage,
  optionTexts,
  pickOption,
  readJson,
  recordMessages,
  score,
  untranslated,
} from "./helpers.js";

const SAVE_DELAY_MS = 400;
const messages = readJson("_locales/en/messages.json");
const IDLE_TEXT = "The model loads when a page needs it, or when you click Load now.";

async function setup(t, options) {
  const page = await openPage(t, "src/options.html", options);
  const { window, document } = page;
  const toggle = (name) => document.querySelector(`input[name="${name}"]`);
  const field = document.querySelector('textarea[name="topics"]');
  const avoidField = document.querySelector('textarea[name="avoidTopics"]');
  const status = document.querySelector("#model-status");
  const progressBar = document.querySelector("#model-progress");
  const loadButton = document.querySelector("#load-now");
  const type = (text, into = field) => {
    into.value = text;
    into.dispatchEvent(new window.Event("input", { bubbles: true }));
  };
  const commit = () => field.dispatchEvent(new window.Event("change", { bubbles: true }));
  const slider = document.querySelector('input[name="threshold"]');
  const avoidSlider = document.querySelector('input[name="avoidThreshold"]');
  const valueOf = (range) => document.querySelector(`#${range.id}-value`).value;
  const hintOf = (range) => document.querySelector(`#${range.id}-hint`).textContent;
  // Moves a slider the way a drag or an arrow key does: input, then change.
  const slide = (value, range = slider) => {
    range.value = String(value);
    range.dispatchEvent(new window.Event("input", { bubbles: true }));
    range.dispatchEvent(new window.Event("change", { bubbles: true }));
  };
  return {
    ...page, toggle, field, avoidField, status, progressBar, loadButton, type, commit, slider, avoidSlider, valueOf, hintOf, slide,
  };
}

// What the background stores while the model loads, as chrome.storage.session reports it.
async function reportStatus(chrome, status) {
  await chrome.storage.session.set({ [STATUS_KEY]: status });
  await flush();
}

const PAGE_SETTINGS = ["filterWatch", "filterHome", "filterSubscriptions", "filterSearch"];
const FEED_SETTINGS = ["enabled", "enforce", "hideShorts"]; // The switches for Home and Shorts.

test("the Filter recommendations switch on the options page saves and enables the fields, profiles, page checkboxes and channel lists, but not the switches for Home and Shorts", async (t) => {
  const stored = { topicFilter: false, profiles: [WORK], activeProfile: WORK.name };
  const { document, chrome, toggle, field, avoidField, slider, avoidSlider, type } = await setup(t, { stored });
  const titleBox = document.querySelector("#try-title");
  const profileName = document.querySelector("#profile-name");
  const profileButtons = ["save", "rename", "delete"].map((action) => document.querySelector(`#${action}-profile`));
  type("Office", profileName); // A name and a selected profile leave only the switch to disable the buttons.
  const profileControls = [document.querySelector("#profile"), profileName, ...profileButtons];
  const channelFields = [...document.querySelectorAll('textarea[name$="Channels"]')];
  assert.equal(channelFields.length, 2);
  const controls = [field, avoidField, slider, avoidSlider, titleBox, ...profileControls, ...PAGE_SETTINGS.map(toggle), ...channelFields];
  const disabled = () => controls.map((control) => control.disabled);
  const every = (value) => controls.map(() => value);
  assert.deepEqual(disabled(), every(true));
  assert.deepEqual(FEED_SETTINGS.map((name) => toggle(name).disabled), [false, false, false], "they work without the filter");
  toggle("topicFilter").click();
  await flush();
  assert.equal(chrome.data.topicFilter, true);
  assert.deepEqual(disabled(), every(false));
  toggle("topicFilter").click();
  assert.deepEqual(disabled(), every(true));
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

test("topics typed before the stored settings load are still saved", async (t) => {
  const chrome = fakeChrome();
  chrome.storage.sync.get = () => new Promise(() => {}); // Sync never answers.
  const { clock, type } = await setup(t, { chrome });
  type("chess");
  clock.tick(SAVE_DELAY_MS);
  await flush();
  assert.equal(chrome.data.topics, "chess");
});

test("saves the topics to avoid once typing pauses", async (t) => {
  const { chrome, clock, type, avoidField } = await setup(t, { stored: { avoidTopics: "gaming" } });
  assert.equal(avoidField.value, "gaming");
  type("gaming, gossip", avoidField);
  clock.tick(SAVE_DELAY_MS - 1);
  assert.equal(chrome.data.avoidTopics, "gaming");
  clock.tick(1);
  assert.equal(chrome.data.avoidTopics, "gaming, gossip");
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

test("shows each stored match line, or its default", async (t) => {
  const { slider, avoidSlider, valueOf } = await setup(t);
  assert.deepEqual([slider, avoidSlider].map(valueOf), ["0.25", "0.24"]);

  const stored = await setup(t, { stored: { threshold: 0.3, avoidThreshold: 0.35 } });
  assert.deepEqual([stored.slider.valueAsNumber, stored.avoidSlider.valueAsNumber], [0.3, 0.35]);
  assert.deepEqual([stored.slider, stored.avoidSlider].map(stored.valueOf), ["0.30", "0.35"]);
});

test("saves each slider as a number once it pauses, showing each value as it moves", async (t) => {
  const { chrome, clock, slider, avoidSlider, slide, valueOf } = await setup(t);
  for (const range of [slider, avoidSlider]) {
    slide(0.31, range);
    assert.equal(valueOf(range), "0.31", range.name);
    assert.equal(range.getAttribute("aria-valuetext"), "0.31", `${range.name}: screen readers hear the value shown`);
    slide(0.32, range);
    clock.tick(SAVE_DELAY_MS - 1);
    assert.equal(chrome.data[range.name], undefined, range.name);
    clock.tick(1);
    assert.equal(chrome.data[range.name], 0.32, range.name);
  }
});

test("saves both the topics and the match needed when the user moves from one to the other", async (t) => {
  const { window, chrome, type, slide } = await setup(t);
  type("chess");
  slide(0.2);
  assert.equal(chrome.data.topics, "chess");
  window.dispatchEvent(new window.Event("pagehide"));
  assert.equal(chrome.data.threshold, 0.2);
});

test("each slider's hint says it has no effect until its list has a topic", async (t) => {
  const { type, avoidField, slider, avoidSlider, hintOf } = await setup(t, { stored: { avoidTopics: "gaming" } });
  const hints = () => [slider, avoidSlider].map(hintOf);
  assert.deepEqual(hints(), [messages.thresholdHintEmpty.message, messages.avoidThresholdHint.message]);
  type("chess");
  type("", avoidField);
  assert.deepEqual(hints(), [messages.thresholdHint.message, messages.avoidThresholdHintEmpty.message]);
  assert.equal(avoidSlider.disabled, false, "it can be set ahead");
});

test("shows the match needed in the browser's language", async (t) => {
  const { slider, valueOf } = await setup(t, { locale: "ar", stored: { threshold: 0.3 } });
  assert.equal(valueOf(slider), (0.3).toLocaleString("ar", { minimumFractionDigits: 2 }));
  assert.equal(slider.getAttribute("aria-valuetext"), valueOf(slider), "the slider speaks it the same way");
});

test("describes each model state", async (t) => {
  const { chrome, status, progressBar } = await setup(t, { stored: { topics: "chess" } });
  assert.equal(status.hidden, false);
  assert.equal(status.textContent, IDLE_TEXT);
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
  assert.equal(status.textContent, IDLE_TEXT);
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
  const { status, loadButton, type } = await setup(t);
  assert.equal(status.hidden, true);
  assert.equal(loadButton.hidden, true);
  type(" , ");
  assert.equal(status.hidden, true);
  type("chess");
  assert.equal(status.hidden, false);
});

test("shows the model status with only topics to avoid", async (t) => {
  const { status, type, avoidField } = await setup(t);
  type("gaming", avoidField);
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

test("Load now shows while the model is idle or failed, and asks the background to load it", async (t) => {
  const { chrome, loadButton } = await setup(t, { stored: { topics: "chess" } });
  const sent = recordMessages(chrome);
  assert.equal(loadButton.hidden, false);
  assert.equal(loadButton.textContent, "Load now");

  loadButton.click();
  await flush();
  assert.deepEqual(sent, [PRELOAD]);
  assert.equal(loadButton.disabled, true, "until the next status arrives");

  await reportStatus(chrome, { state: "error" });
  assert.equal(loadButton.hidden, false);
  assert.equal(loadButton.disabled, false);
});

test("Load now comes back when the background couldn't reach the model", async (t) => {
  const { chrome, loadButton } = await setup(t, { stored: { topics: "chess" } });
  recordMessages(chrome, async () => ({ error: "The topic model did not answer." }));
  loadButton.click();
  assert.equal(loadButton.disabled, true);
  await flush();
  assert.equal(loadButton.disabled, false);

  recordMessages(chrome, async () => {
    throw new Error("Extension context invalidated.");
  });
  loadButton.click();
  await flush();
  assert.equal(loadButton.disabled, false, "also when the message couldn't be sent");
});

test("Load now hides while the model loads or is ready", async (t) => {
  const { chrome, loadButton } = await setup(t, { stored: { topics: "chess" } });
  await reportStatus(chrome, { state: "loading", progress: 0.1 });
  assert.equal(loadButton.hidden, true);
  await reportStatus(chrome, { state: "ready" });
  assert.equal(loadButton.hidden, true);
});

test("saving the first topics asks the background to load the model", async (t) => {
  const { chrome, clock, type } = await setup(t);
  const sent = recordMessages(chrome);
  const saved = Promise.withResolvers();
  const set = chrome.storage.sync.set;
  chrome.storage.sync.set = (changes) => saved.promise.then(() => set(changes));

  type("chess");
  clock.tick(SAVE_DELAY_MS);
  await flush();
  assert.deepEqual(sent, [], "not before the save resolved");
  saved.resolve();
  await flush();
  assert.equal(chrome.data.topics, "chess");
  assert.deepEqual(sent, [PRELOAD]);
});

test("turning the filter back on with topics asks the background to load the model", async (t) => {
  const { chrome, toggle } = await setup(t, { stored: { topics: "chess", topicFilter: false } });
  const sent = recordMessages(chrome);
  toggle("topicFilter").click();
  await flush();
  assert.deepEqual(sent, [PRELOAD]);
});

test("changing topics that were already set doesn't ask again", async (t) => {
  const { chrome, type, commit } = await setup(t, { stored: { topics: "chess" } });
  const sent = recordMessages(chrome);
  type("chess, cooking");
  commit();
  await flush();
  assert.equal(chrome.data.topics, "chess, cooking");
  assert.deepEqual(sent, []);
});

test("ignores storage changes that aren't the model status", async (t) => {
  const { chrome, status } = await setup(t, { stored: { topics: "chess" } });
  await chrome.storage.session.set({ other: { state: "ready" } });
  await chrome.storage.sync.set({ [STATUS_KEY]: { state: "ready" } });
  await flush();
  assert.equal(status.textContent, IDLE_TEXT);
});

const TRY_TITLE = "How to beat the Sicilian Defense";
const TRY_DELAY_MS = 400; // How long the try box waits for typing to pause.
const TRY_ERROR = "Couldn't check the title. Try again shortly.";
const SHOWN = "Shown: matches your topics at 0.31, meeting the 0.25 needed."; // A score of 0.31 at the default line.

// The options page with each title it tries waiting until the test answers it. Other messages,
// such as loading the model, are answered at once.
async function setupTry(t, options) {
  const page = await setup(t, options);
  const requests = holdMessages(page.chrome, (message) => message.type === MATCH);
  const titleBox = page.document.querySelector("#try-title");
  const verdictText = () => page.document.querySelector("#try-verdict").textContent;
  const scoresText = () => page.document.querySelector("#try-scores").textContent;
  // Types a title and waits for typing to pause.
  const tryTitle = (text) => {
    page.type(text, titleBox);
    page.clock.tick(TRY_DELAY_MS);
  };
  const answer = async (value, request = requests.at(-1)) => {
    request.resolve(value);
    await flush();
  };
  return { ...page, requests, titleBox, verdictText, scoresText, tryTitle, answer };
}

test("checks a typed title once typing pauses, with the topics on the page", async (t) => {
  const { clock, requests, titleBox, type, avoidField } = await setupTry(t, { stored: { topics: "chess" } });
  type("chess, cooking");
  type("gaming", avoidField);
  clock.tick(TRY_DELAY_MS);
  assert.equal(requests.length, 0, "not without a title");

  type("How to beat", titleBox);
  clock.tick(TRY_DELAY_MS / 2);
  type(TRY_TITLE, titleBox);
  clock.tick(TRY_DELAY_MS - 1);
  assert.equal(requests.length, 0);
  clock.tick(1);
  assert.deepEqual(requests.map((request) => request.message), [{
    type: MATCH,
    topics: ["chess", "cooking"],
    avoidTopics: ["gaming"],
    videos: [{ id: "try", title: TRY_TITLE, channel: "" }],
  }]);

  type("chess", avoidField);
  clock.tick(TRY_DELAY_MS);
  assert.equal(requests.length, 2, "changing the topics checks the title again");
  assert.deepEqual(requests[1].message.avoidTopics, ["chess"]);
});

test("tries a title the way the filter reads one on YouTube, with its spacing collapsed", async (t) => {
  const { requests, tryTitle } = await setupTry(t, { stored: { topics: "chess" } });
  tryTitle("  chess   openings ");
  assert.deepEqual(requests.map((request) => request.message.videos[0].title), ["chess openings"]);
});

test("the verdict names the rule that decided and its line, and follows either slider without asking again", async (t) => {
  const { clock, requests, tryTitle, answer, type, field, avoidSlider, slide, verdictText, scoresText } = await setupTry(t, {
    stored: { topics: "chess", avoidTopics: "gaming" },
  });
  tryTitle(TRY_TITLE);
  await answer({ scores: { try: score(0.31, 0.35) } });
  assert.equal(verdictText(), "Hidden: matches a topic to avoid at 0.35, more than your topics at 0.31.");
  assert.equal(scoresText(), "Match with your topics: 0.31 · Match with topics to avoid: 0.35");
  slide(0.4, avoidSlider);
  assert.equal(verdictText(), SHOWN);
  slide(0.35);
  assert.equal(verdictText(), "Hidden: matches your topics at only 0.31, below the 0.35 needed.");
  assert.equal(requests.length, 1);

  type("", field);
  clock.tick(TRY_DELAY_MS);
  assert.deepEqual(requests.at(-1).message.topics, []);
  await answer({ scores: { try: score(null, 0.18) } });
  assert.equal(verdictText(), "Shown: matches a topic to avoid at only 0.18, below the 0.40 that hides.");
  assert.equal(scoresText(), "Match with your topics: none · Match with topics to avoid: 0.18");
  slide(0.18, avoidSlider);
  assert.equal(verdictText(), "Hidden: matches a topic to avoid at 0.18, reaching the 0.18 that hides.");
});

// Rounding would show 0.196 as 0.20 though a 0.20 line isn't reached, and 0.29 * 100 falls just short of 29.
test("a score shows as the highest line it meets, so the number agrees with the verdict at every step", async (t) => {
  const { tryTitle, answer, avoidSlider, slide, verdictText, scoresText } = await setupTry(t, {
    stored: { topics: "chess", avoidTopics: "gaming", avoidThreshold: 0.2 },
  });
  tryTitle(TRY_TITLE);
  await answer({ scores: { try: score(0.29, 0.196) } });
  assert.equal(scoresText(), "Match with your topics: 0.29 · Match with topics to avoid: 0.19");
  slide(0.29);
  assert.equal(verdictText(), "Shown: matches your topics at 0.29, meeting the 0.29 needed.");
  slide(0.3);
  assert.equal(verdictText(), "Hidden: matches your topics at only 0.29, below the 0.30 needed.");
  slide(0.29);
  slide(0.19, avoidSlider);
  assert.equal(verdictText(), "Shown: matches a topic to avoid at 0.19, but not more than your topics at 0.29.");
  slide(0.3);
  assert.equal(verdictText(), "Hidden: matches your topics at only 0.29, below the 0.30 needed.");
});

test("two scores that would show as the same number show with the decimals that tell them apart", async (t) => {
  const { tryTitle, answer, verdictText, scoresText } = await setupTry(t, { stored: { topics: "chess", avoidTopics: "gaming" } });
  tryTitle(TRY_TITLE);
  await answer({ scores: { try: score(0.312, 0.314) } });
  assert.equal(verdictText(), "Hidden: matches a topic to avoid at 0.314, more than your topics at 0.312.");
  assert.equal(scoresText(), "Match with your topics: 0.312 · Match with topics to avoid: 0.314");
});

test("tells screen readers only when moving a slider shows or hides the tried title", async (t) => {
  const { window, document, tryTitle, answer, slide, verdictText } = await setupTry(t, { stored: { topics: "chess" } });
  const live = document.querySelector('#try-result [role="status"]');
  tryTitle(TRY_TITLE);
  await answer({ scores: { try: score(0.31) } });
  assert.equal(live.textContent, "Shown Match with your topics: 0.31 · Match with topics to avoid: none");
  const announced = [];
  const observer = new window.MutationObserver(() => announced.push(live.textContent));
  observer.observe(live, { childList: true, characterData: true, subtree: true });
  slide(0.3);
  slide(0.31);
  await flush();
  assert.equal(verdictText(), "Shown: matches your topics at 0.31, meeting the 0.31 needed.");
  assert.deepEqual(announced, [], "the line in the verdict isn't read out at each step");
  slide(0.32);
  await flush();
  assert.deepEqual(announced, ["Hidden Match with your topics: 0.31 · Match with topics to avoid: none"]);
});

test("ignores the answer for a title that has changed since", async (t) => {
  const { requests, tryTitle, answer, verdictText, scoresText } = await setupTry(t, { stored: { topics: "chess" } });
  tryTitle("Celebrity gossip");
  tryTitle(TRY_TITLE);
  const [first, latest] = requests;
  await answer({ scores: { try: score(0.1) } }, first);
  assert.equal(verdictText(), "");
  assert.equal(scoresText(), "");
  await answer({ scores: { try: score(0.31) } }, latest);
  assert.equal(verdictText(), SHOWN);
});

test("asks for a topic before trying a title", async (t) => {
  const { clock, requests, tryTitle, type, verdictText, scoresText } = await setupTry(t);
  tryTitle(TRY_TITLE);
  assert.equal(requests.length, 0);
  assert.equal(verdictText(), "");
  assert.equal(scoresText(), "Add a topic above to try a title.");

  type("chess");
  clock.tick(TRY_DELAY_MS);
  assert.equal(requests.length, 1);
  assert.equal(scoresText(), "");
});

test("says when the title couldn't be checked", async (t) => {
  const { requests, tryTitle, answer, verdictText, scoresText, slide } = await setupTry(t, { stored: { topics: "chess" } });
  const failures = [
    () => answer({ error: "The topic model did not answer." }),
    async () => {
      requests.at(-1).reject(new Error("Extension context invalidated."));
      await flush();
    },
    () => answer({ scores: {} }),
  ];
  for (const [index, fail] of failures.entries()) {
    tryTitle(`${TRY_TITLE} ${index}`);
    await fail();
    assert.equal(verdictText(), "", `failure ${index}`);
    assert.equal(scoresText(), TRY_ERROR, `failure ${index}`);
    slide(0.3);
    assert.equal(scoresText(), TRY_ERROR, `failure ${index}, after moving the slider`);
  }
});

test("shows that the model is loading while it waits", async (t) => {
  const { chrome, tryTitle, answer, verdictText, scoresText } = await setupTry(t, { stored: { topics: "chess" } });
  tryTitle(TRY_TITLE);
  assert.equal(scoresText(), "");
  await reportStatus(chrome, { state: "loading", progress: 0.2 });
  assert.equal(scoresText(), "Loading the model…");
  await reportStatus(chrome, { state: "ready" });
  await answer({ scores: { try: score(0.31) } });
  assert.equal(verdictText(), SHOWN);
});

test("turning the filter off stops trying titles and clears the verdict", async (t) => {
  const { clock, requests, tryTitle, answer, type, titleBox, toggle, verdictText, scoresText } = await setupTry(t, {
    stored: { topics: "chess" },
  });
  const filterSwitch = toggle("topicFilter");
  tryTitle(TRY_TITLE);
  await answer({ scores: { try: score(0.31) } });
  filterSwitch.click();
  assert.equal(verdictText(), "");
  assert.equal(scoresText(), "");

  filterSwitch.click();
  tryTitle("Chess openings for beginners");
  type("Chess openings for kids", titleBox);
  filterSwitch.click();
  clock.tick(TRY_DELAY_MS);
  assert.equal(requests.length, 2, "the title still waiting for typing to pause is never sent");
  await answer({ scores: { try: score(0.31) } });
  assert.equal(verdictText(), "", "a late answer is ignored");
  assert.equal(scoresText(), "");
});

test("the page checkboxes show their defaults and save as they change", async (t) => {
  const { chrome, toggle } = await setup(t);
  assert.deepEqual(PAGE_SETTINGS.map((name) => toggle(name).checked), [true, true, false, false]);

  toggle("filterSearch").click();
  toggle("filterHome").click();
  await flush();
  assert.equal(chrome.data.filterSearch, true);
  assert.equal(chrome.data.filterHome, false);
});

test("the switches for Home and Shorts show their defaults and save as they change", async (t) => {
  const { chrome, toggle } = await setup(t);
  assert.deepEqual(FEED_SETTINGS.map((name) => toggle(name).checked), [true, false, false]);

  toggle("hideShorts").click();
  toggle("enforce").click();
  toggle("enabled").click();
  await flush();
  assert.deepEqual(FEED_SETTINGS.map((name) => chrome.data[name]), [false, true, true]);
});

test("the switches for Home and Shorts show the stored settings and follow a change made in the popup", async (t) => {
  const { chrome, toggle } = await setup(t, { stored: { enabled: false, enforce: true, hideShorts: true } });
  assert.deepEqual(FEED_SETTINGS.map((name) => toggle(name).checked), [false, true, true]);
  assert.equal(toggle("enforce").disabled, true);

  await chrome.storage.sync.set({ enabled: true, hideShorts: false });
  await flush();
  assert.deepEqual(FEED_SETTINGS.map((name) => toggle(name).checked), [true, true, false]);
  assert.equal(toggle("enforce").disabled, false);
});

test("submitting the options form, as Enter in the title box does, keeps the page open", async (t) => {
  const { document } = await setup(t);
  const form = document.querySelector("#settings");
  let submit;
  form.addEventListener("submit", (event) => (submit = event));
  form.requestSubmit();
  assert.equal(submit.defaultPrevented, true);
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

// The options page with its two channel lists.
async function setupChannels(t, options) {
  const page = await setup(t, options);
  const { document, chrome } = page;
  const allowed = document.querySelector('textarea[name="allowedChannels"]');
  const blocked = document.querySelector('textarea[name="blockedChannels"]');
  const channelsError = document.querySelector("#channels-error");
  // The lists as stored, outside the page's context.
  const stored = () => structuredClone({ allowedChannels: chrome.data.allowedChannels, blockedChannels: chrome.data.blockedChannels });
  return { ...page, allowed, blocked, channelsError, stored };
}

test("saves each channel list one name per line", async (t) => {
  const { clock, type, allowed, blocked, stored } = await setupChannels(t, { stored: { allowedChannels: ["Fireship", "Traversy Media"] } });
  assert.equal(allowed.value, "Fireship\nTraversy Media");
  type("MrBeast\n\n  mrbeast \nVeritasium\n", blocked);
  clock.tick(SAVE_DELAY_MS);
  assert.deepEqual(stored(), { allowedChannels: ["Fireship", "Traversy Media"], blockedChannels: ["MrBeast", "Veritasium"] });
});

test("shows a channel added elsewhere without disturbing the list being typed in", async (t) => {
  const { chrome, type, allowed, blocked } = await setupChannels(t, { stored: { allowedChannels: ["Fireship"] } });
  blocked.focus();
  type("MrBeast\nVer", blocked);
  await chrome.storage.sync.set({ allowedChannels: ["Fireship", "Traversy Media"], blockedChannels: ["Elsewhere"] });
  await flush();
  assert.equal(allowed.value, "Fireship\nTraversy Media");
  assert.equal(blocked.value, "MrBeast\nVer");
});

test("typing a channel into one list removes it from the other", async (t) => {
  const { clock, type, allowed, blocked, stored } = await setupChannels(t, { stored: { allowedChannels: ["Fireship", "MrBeast"] } });
  blocked.focus();
  type("mrbeast", blocked);
  clock.tick(SAVE_DELAY_MS);
  assert.deepEqual(stored(), { allowedChannels: ["Fireship"], blockedChannels: ["mrbeast"] });
  await flush();
  assert.equal(allowed.value, "Fireship");
});

test("editing one channel list after the other keeps both", async (t) => {
  const { clock, type, allowed, blocked, stored } = await setupChannels(t);
  type("MrBeast", blocked);
  clock.tick(SAVE_DELAY_MS);
  // No storage event has reached the page yet, so only the saved change set says MrBeast is blocked.
  type("Fireship", allowed);
  clock.tick(SAVE_DELAY_MS);
  assert.deepEqual(stored(), { allowedChannels: ["Fireship"], blockedChannels: ["MrBeast"] });
});

test("says when a list has more than 50 channels", async (t) => {
  const { clock, type, allowed, channelsError, chrome } = await setupChannels(t);
  assert.equal(channelsError.hidden, true);
  allowed.focus();
  type(channelNames(51).join("\n"), allowed);
  assert.equal(channelsError.hidden, false);
  assert.equal(channelsError.textContent, messages.listFull.message);
  clock.tick(SAVE_DELAY_MS);
  await flush();
  assert.equal(chrome.data.allowedChannels.length, 50);
  assert.equal(channelsError.hidden, false, "saving the first 50 still says the rest were left out");

  type(channelNames(50).join("\n"), allowed);
  assert.equal(channelsError.hidden, true);
});

test("says when a change couldn't be saved", async (t) => {
  const { window, document, chrome, type, field, blocked } = await setupChannels(t);
  const set = chrome.storage.sync.set;
  for (const [into, text, line] of [[field, "chess", "#topics-error"], [blocked, "MrBeast", "#channels-error"]]) {
    const errorLine = document.querySelector(line);
    // Chrome refuses the first write, as it does past its write quota.
    chrome.storage.sync.set = async () => {
      chrome.storage.sync.set = set;
      throw new Error("MAX_WRITE_OPERATIONS_PER_MINUTE quota exceeded");
    };
    type(text, into);
    into.dispatchEvent(new window.Event("change", { bubbles: true }));
    await flush();
    assert.equal(errorLine.hidden, false, line);
    assert.equal(errorLine.textContent, messages.saveFailed.message, line);

    into.dispatchEvent(new window.Event("change", { bubbles: true }));
    await flush();
    assert.equal(errorLine.hidden, true, `${line}, once saved`);
  }
});

test("a refused save in a section without an error line is still reported", async (t) => {
  const { window, chrome, toggle } = await setupChannels(t);
  const refusal = new Error("MAX_WRITE_OPERATIONS_PER_MINUTE quota exceeded");
  chrome.storage.sync.set = async () => {
    throw refusal;
  };
  const logged = t.mock.method(window.console, "error", () => {});
  toggle("filterHome").click();
  await flush();
  assert.deepEqual(logged.mock.calls.map((call) => call.arguments.at(-1)), [refusal]);
});

// The keyboard shortcuts as the page lists them: each one's description and keys.
const shortcutRows = (document) =>
  [...document.querySelectorAll("#shortcut-list li")].map((row) => [row.querySelector("span").textContent, row.querySelector("kbd").textContent]);

test("lists the shortcuts Chrome assigned, or Not set", async (t) => {
  const { document } = await setup(t, {
    commandList: [
      { name: "_execute_action", description: "", shortcut: "" },
      { name: "toggle-hide-shorts", description: "Turn Hide Shorts on or off", shortcut: "Ctrl+Shift+Y" },
      { name: "toggle-topic-filter", description: "Turn Filter recommendations on or off", shortcut: "" },
    ],
  });
  assert.deepEqual(shortcutRows(document), [
    ["Turn Filter recommendations on or off", "Not set"],
    ["Turn Hide Shorts on or off", "Ctrl+Shift+Y"],
  ]);
});

test("lists the shortcuts again when the user comes back from changing them", async (t) => {
  const { window, document, chrome } = await setup(t);
  assert.deepEqual(shortcutRows(document), [
    ["Turn Filter recommendations on or off", "Alt+Shift+F"],
    ["Turn Hide Shorts on or off", "Alt+Shift+S"],
  ]);
  chrome.commandList[1].shortcut = "";
  Object.defineProperty(document, "hidden", { value: false }); // jsdom's page is never shown.
  document.dispatchEvent(new window.Event("visibilitychange"));
  await flush();
  assert.deepEqual(shortcutRows(document).map(([, keys]) => keys), ["Alt+Shift+F", "Not set"]);
});

test("Change shortcuts opens Chrome's shortcuts page", async (t) => {
  const { document, chrome } = await setup(t);
  document.querySelector("#change-shortcuts").click();
  assert.deepEqual(structuredClone(chrome.createdTabs), [{ url: "chrome://extensions/shortcuts" }]);
});

const NO_PROFILE = messages.noProfile.message;
// Profiles whose topics take 3 bytes a character, so five of them nearly fill their sync item.
const cjkProfiles = (count) => Array.from({ length: count }, (_, index) => ({ name: `频道 ${index}`, topics: "频".repeat(500), avoidTopics: "" }));
const ITEM_BUDGET = 8000; // The bytes settings.js lets one synced setting take.
const syncBytes = (key, value) => key.length + new TextEncoder().encode(JSON.stringify(value)).length;

// Work and profiles that fill the rest of their sync item to the byte, so Work can't grow.
function filledProfiles() {
  const filler = { name: "Filler", topics: "", avoidTopics: "" };
  const list = [WORK, ...cjkProfiles(5), filler];
  filler.topics = "x".repeat(ITEM_BUDGET - syncBytes("profiles", list));
  return list;
}

// The options page with its profile switch, the profile name field and the profile buttons.
async function setupProfiles(t, stored) {
  const page = await setup(t, { stored });
  const { window, document, chrome } = page;
  const select = document.querySelector("#profile");
  const nameField = document.querySelector("#profile-name");
  const button = (action) => document.querySelector(`#${action}-profile`);
  const profilesError = document.querySelector("#profiles-error");
  const topicsError = document.querySelector("#topics-error");
  const name = (text) => {
    nameField.value = text;
    nameField.dispatchEvent(new window.Event("input", { bubbles: true }));
  };
  const pick = (value) => pickOption(select, value);
  const listed = () => optionTexts(select);
  const storedProfiles = () => structuredClone(chrome.data.profiles);
  return { ...page, select, nameField, button, profilesError, topicsError, name, pick, listed, storedProfiles };
}

test("saves the topics and sliders as shown as a new profile and selects it", async (t) => {
  const stored = { topics: "chess", avoidTopics: "gaming", threshold: 0.3 };
  const { chrome, select, nameField, button, name, listed, storedProfiles, slide, avoidSlider } = await setupProfiles(t, stored);
  assert.equal(button("save").disabled, true, "until there is a name");
  name("  Chess   club ");
  assert.equal(button("save").disabled, false);
  slide(0.2, avoidSlider);
  button("save").click();
  await flush();
  assert.deepEqual(storedProfiles(), [{ name: "Chess club", ...stored, avoidThreshold: 0.2 }]);
  assert.equal(chrome.data.activeProfile, "Chess club");
  assert.deepEqual(listed(), [NO_PROFILE, "Chess club"]);
  assert.equal(select.value, "Chess club");
  assert.equal(nameField.value, "");
  assert.equal(button("delete").disabled, false);
});

test("after a profile button saves, focus moves from the button, now off, to the profile list", async (t) => {
  const { document, select, button, name } = await setupProfiles(t, { topics: "chess" });
  name("Chess club");
  button("save").focus();
  button("save").click();
  await flush();
  assert.equal(button("save").disabled, true);
  assert.equal(document.activeElement, select);
});

test("shows the stored profile as selected when the page opens", async (t) => {
  const { select, listed } = await setupProfiles(t, { profiles: [WORK, EVENING], activeProfile: "evening", topics: EVENING.topics });
  assert.deepEqual(listed(), [NO_PROFILE, "Work", "Evening"]);
  assert.equal(select.value, "Evening");
});

test("switching profiles fills both topic fields and both sliders and saves them in one write", async (t) => {
  const { chrome, field, avoidField, slider, avoidSlider, pick } = await setupProfiles(t, { profiles: [WORK, EVENING], activeProfile: "Work", ...WORK });
  const set = chrome.storage.sync.set;
  let writes = 0;
  chrome.storage.sync.set = (changes) => {
    writes += 1;
    return set(changes);
  };
  pick("Evening");
  await flush();
  assert.equal(writes, 1);
  const { activeProfile, topics, avoidTopics, threshold, avoidThreshold } = chrome.data;
  assert.deepEqual({ name: activeProfile, topics, avoidTopics, threshold, avoidThreshold }, EVENING);
  assert.deepEqual([field.value, avoidField.value], [EVENING.topics, EVENING.avoidTopics]);
  assert.deepEqual([slider.valueAsNumber, avoidSlider.valueAsNumber], [EVENING.threshold, EVENING.avoidThreshold]);
});

test("a saved profile brings back its sliders as they were last moved", async (t) => {
  const { chrome, clock, slider, avoidSlider, slide, name, button, pick } = await setupProfiles(t, { profiles: [EVENING], topics: "chess" });
  name("Chess club");
  button("save").click();
  await flush();
  slide(0.33);
  clock.tick(SAVE_DELAY_MS);
  pick("Evening");
  await flush();
  assert.deepEqual([slider.valueAsNumber, avoidSlider.valueAsNumber], [EVENING.threshold, EVENING.avoidThreshold]);
  pick("Chess club");
  await flush();
  assert.deepEqual([slider.valueAsNumber, avoidSlider.valueAsNumber], [0.33, 0.24]);
  assert.deepEqual([chrome.data.threshold, chrome.data.avoidThreshold], [0.33, 0.24]);
});

test("editing the topics or moving a slider updates the selected profile, even one saved without sliders", async (t) => {
  const { chrome, clock, type, slide, avoidSlider, storedProfiles } = await setupProfiles(t, { profiles: [WORK, EVENING], activeProfile: "Work", ...WORK });
  type("programming, rust");
  slide(0.3, avoidSlider);
  clock.tick(SAVE_DELAY_MS);
  await flush();
  assert.deepEqual([chrome.data.topics, chrome.data.avoidThreshold], ["programming, rust", 0.3]);
  assert.deepEqual(storedProfiles(), [{ ...WORK, topics: "programming, rust", avoidThreshold: 0.3 }, EVENING]);
});

test("a change that no longer fits in the profile still applies, and the page says the profile keeps what it had", async (t) => {
  const profiles = filledProfiles();
  const edits = [
    ["topics", "programming, rust", (page) => page.type("programming, rust")],
    ["threshold", 0.33, (page) => page.slide(0.33)],
  ];
  for (const [key, value, edit] of edits) {
    const page = await setupProfiles(t, { profiles, activeProfile: "Work", ...WORK });
    const { chrome, clock, select, topicsError, storedProfiles } = page;
    edit(page);
    clock.tick(SAVE_DELAY_MS);
    await flush();
    assert.equal(chrome.data[key], value, key);
    assert.deepEqual(storedProfiles(), profiles, key);
    assert.equal(chrome.data.activeProfile, "Work", key);
    assert.equal(select.value, "Work", key);
    assert.equal(topicsError.hidden, false, key);
    assert.equal(topicsError.textContent, messages.profileChangeTooLarge.message, key);
  }
});

test("a profile switch from elsewhere during an edit doesn't write the edit into the new profile", async (t) => {
  const edits = [
    ["topics", "programming, rust", (page) => {
      page.field.focus();
      page.type("programming, rust");
    }],
    ["threshold", 0.33, (page) => page.slide(0.33)],
  ];
  for (const [key, value, edit] of edits) {
    const page = await setupProfiles(t, { profiles: [WORK, EVENING], activeProfile: "Work", ...WORK });
    const { chrome, clock, select, storedProfiles } = page;
    edit(page);
    await chrome.storage.sync.set({ activeProfile: "Evening", topics: EVENING.topics, avoidTopics: EVENING.avoidTopics });
    await flush();
    assert.equal(select.value, "Evening", key);
    clock.tick(SAVE_DELAY_MS);
    await flush();
    assert.deepEqual(storedProfiles(), [WORK, EVENING], key);
    assert.equal(chrome.data[key], value, `${key}: the edit still reaches the filter`);
  }
});

test("a profile switch from elsewhere moves a focused slider once its move is saved", async (t) => {
  const { chrome, clock, slider, slide, valueOf } = await setupProfiles(t, { profiles: [WORK, EVENING], activeProfile: "Work", ...WORK });
  slider.focus();
  slide(0.33);
  clock.tick(SAVE_DELAY_MS);
  await flush();
  const { name, ...evening } = EVENING;
  await chrome.storage.sync.set({ activeProfile: name, ...evening });
  await flush();
  assert.equal(slider.valueAsNumber, EVENING.threshold);
  assert.equal(valueOf(slider), "0.30");
});

test("typing in the other topics field after a switch from elsewhere doesn't move the first edit into the new profile", async (t) => {
  const { chrome, clock, field, avoidField, type, storedProfiles } = await setupProfiles(t, { profiles: [WORK, EVENING], activeProfile: "Work", ...WORK });
  field.focus();
  type("programming, rust");
  await chrome.storage.sync.set({ activeProfile: "Evening", topics: EVENING.topics, avoidTopics: EVENING.avoidTopics });
  await flush();
  avoidField.focus();
  type("gossip", avoidField);
  clock.tick(SAVE_DELAY_MS);
  await flush();
  assert.deepEqual(storedProfiles(), [WORK, { ...EVENING, avoidTopics: "gossip" }]);
  assert.equal(chrome.data.topics, "programming, rust", "the typed topics still reach the filter");
});

test("switching profiles on the page while typing saves the typed topics into the profile they were typed for", async (t) => {
  const { chrome, field, select, type, pick, storedProfiles } = await setupProfiles(t, { profiles: [WORK, EVENING], activeProfile: "Work", ...WORK });
  field.focus();
  type("programming, rust");
  select.focus();
  pick("Evening");
  await flush();
  assert.deepEqual(storedProfiles(), [{ ...WORK, topics: "programming, rust" }, EVENING]);
  const { activeProfile, topics } = chrome.data;
  assert.deepEqual({ activeProfile, topics }, { activeProfile: "Evening", topics: EVENING.topics });
  assert.equal(field.value, EVENING.topics);
});

// The profile list may be open while this happens; redrawing it would close it under the user.
test("typing a profile name or a change from elsewhere doesn't redraw the profile list", async (t) => {
  const { chrome, select, name } = await setupProfiles(t, { profiles: [WORK, EVENING], activeProfile: "Work", ...WORK });
  const before = [...select.options];
  for (const typed of ["O", "Of", "Off"]) name(typed);
  await chrome.storage.sync.set({ threshold: 0.5 });
  await flush();
  const after = [...select.options];
  assert.ok(after.length === before.length && after.every((option, index) => option === before[index]), "the same option elements");
  assert.equal(select.value, "Work");
});

test("renaming the selected profile keeps it selected", async (t) => {
  const { chrome, select, button, name, listed, storedProfiles } = await setupProfiles(t, { profiles: [WORK, EVENING], activeProfile: "Work" });
  name("Office");
  button("rename").click();
  await flush();
  assert.deepEqual(storedProfiles(), [{ ...WORK, name: "Office" }, EVENING]);
  assert.equal(chrome.data.activeProfile, "Office");
  assert.deepEqual(listed(), [NO_PROFILE, "Office", "Evening"]);
  assert.equal(select.value, "Office");
});

test("deleting the selected profile keeps the topics", async (t) => {
  const { chrome, field, select, button, listed, storedProfiles } = await setupProfiles(t, { profiles: [WORK, EVENING], activeProfile: "Work", ...WORK });
  button("delete").click();
  await flush();
  assert.deepEqual(storedProfiles(), [EVENING]);
  assert.equal(chrome.data.activeProfile, "");
  assert.equal(chrome.data.topics, WORK.topics);
  assert.equal(field.value, WORK.topics);
  assert.deepEqual(listed(), [NO_PROFILE, "Evening"]);
  assert.equal(select.value, "");
  assert.equal(button("delete").disabled, true);
});

test("refuses a name already in use", async (t) => {
  const { button, name, profilesError, storedProfiles } = await setupProfiles(t, { profiles: [WORK, EVENING], activeProfile: "Evening" });
  for (const action of ["save", "rename"]) {
    name(" WORK ");
    button(action).click();
    await flush();
    assert.equal(profilesError.hidden, false, action);
    assert.equal(profilesError.textContent, messages.profileNameTaken.message, action);
    assert.deepEqual(storedProfiles(), [WORK, EVENING], action);
  }
  name("Office");
  button("save").click();
  await flush();
  assert.equal(profilesError.hidden, true, "a save that works clears the error");
  assert.deepEqual(storedProfiles(), [WORK, EVENING, { name: "Office", topics: "", avoidTopics: "", threshold: 0.25, avoidThreshold: 0.24 }]);
});

test("says when there's no room for another profile", async (t) => {
  const eight = manyProfiles(8);
  const cjk = cjkProfiles(5);
  for (const [profiles, topics] of [[eight, "chess"], [cjk, "频".repeat(300)]]) {
    const { button, name, profilesError, storedProfiles } = await setupProfiles(t, { profiles, topics });
    name("One more");
    button("save").click();
    await flush();
    assert.equal(profilesError.hidden, false, `${profiles.length} profiles`);
    assert.equal(profilesError.textContent, messages.profilesFull.message, `${profiles.length} profiles`);
    assert.deepEqual(storedProfiles(), profiles, `${profiles.length} profiles`);
  }
});
