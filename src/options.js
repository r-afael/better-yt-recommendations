// Options page with every setting: the popup's switches for Home and Shorts and Filter
// recommendations, then what doesn't fit in the popup: the topics to see and to avoid, each with
// the slider that sets how well a video must match them, a box to try a title against them, the
// topic profiles, the pages to filter, the channel lists and the keyboard shortcuts. Open
// YouTube tabs pick up changes right away.
(() => {
  "use strict";

  const { channels, profiles, protocol, settings, ui, verdict } = globalThis.BetterYT;
  const { COMMAND_TOGGLE_FILTER, COMMAND_TOGGLE_SHORTS, MATCH, MODEL_STATES } = protocol;
  const { setText } = ui;

  const TRY_ID = "try"; // The id of the one video a try asks the model to score.
  const TRY_DELAY_MS = 400; // A try waits for typing to pause, like saving does.
  const COMMANDS = Object.freeze([COMMAND_TOGGLE_FILTER, COMMAND_TOGGLE_SHORTS]); // In the manifest's order.
  // Extension pages can't link to chrome:// pages, so the button opens it in a new tab.
  const SHORTCUTS_PAGE = "chrome://extensions/shortcuts";
  // What the profiles section says when a profile button can't do what it was asked. The buttons
  // only work with a name typed and, to rename, a profile selected, so "missing" has nothing to
  // explain.
  const PROFILE_ERRORS = Object.freeze({ taken: "profileNameTaken", full: "profilesFull", missing: null });

  ui.addFeedSwitches();
  const form = document.getElementById("settings");
  const {
    topicFilter,
    topics: topicsField,
    avoidTopics: avoidField,
    threshold,
    avoidThreshold,
    activeProfile: profileSelect,
    allowedChannels,
    blockedChannels,
  } = form.elements;
  const channelFields = [allowedChannels, blockedChannels];
  const topicFields = [topicsField, avoidField];
  // The topic fields and the sliders, whose values a profile keeps a copy of.
  const profileFields = settings.PROFILE_SETTINGS.map((name) => form.elements[name]);
  // Each slider sets the line for one list of topics. Its hint says what it does, or that it does
  // nothing until that list has a topic; it stays enabled, so it can be set ahead.
  const sliders = [
    { input: threshold, list: "want", hint: "thresholdHint", emptyHint: "thresholdHintEmpty" },
    { input: avoidThreshold, list: "avoid", hint: "avoidThresholdHint", emptyHint: "avoidThresholdHintEmpty" },
  ].map((slider) => ({
    ...slider,
    value: document.getElementById(`${slider.input.id}-value`),
    hintLine: document.getElementById(`${slider.input.id}-hint`),
  }));
  const tryTitle = document.getElementById("try-title");
  const tryVerdict = document.getElementById("try-verdict");
  const tryOutcome = document.getElementById("try-outcome");
  const tryScores = document.getElementById("try-scores");
  const pageSwitches = [...document.querySelectorAll('section[aria-labelledby="pages-section"] input')];
  const profileName = document.getElementById("profile-name");
  const saveProfile = document.getElementById("save-profile");
  const renameProfile = document.getElementById("rename-profile");
  const deleteProfile = document.getElementById("delete-profile");
  const profilesError = document.getElementById("profiles-error");
  const topicsError = document.getElementById("topics-error");
  const channelsError = document.getElementById("channels-error");
  const shortcutList = document.getElementById("shortcut-list");
  const filterControls = [
    ...topicFields,
    ...sliders.map(({ input }) => input),
    tryTitle,
    profileSelect,
    profileName,
    ...pageSwitches,
    ...channelFields,
  ];

  let tryTimer = null;
  let trySequence = 0; // Only the answer to the latest try is shown.
  let tryPending = false;
  let tryScore = null; // The latest try's { want, avoid }, which the sliders judge again as they move.
  let tryFailed = false;
  // The profile selected when each profile field's pending edit started, which is the one it updates.
  const editedProfiles = new Map();

  // The fields as typed, so the page follows the first topic and not only once it is saved.
  const typed = () => ({ topicFilter: topicFilter.checked, topics: topicsField.value, avoidTopics: avoidField.value });
  const status = ui.createModelStatus({
    status: document.getElementById("model-status"),
    progressBar: document.getElementById("model-progress"),
    loadButton: document.getElementById("load-now"),
    isVisible: () => verdict.needsModel(typed()),
    onChange: renderTry,
  });

  const typedTitle = () => settings.clip(tryTitle.value, settings.LIMITS.MAX_TITLE_LENGTH);

  // How many decimals the tried title's scores show with: as many as the sliders, or as many
  // more as it takes for two different scores to read differently, so a verdict that compares
  // them never says "0.31, more than 0.31". Any two different scores read apart at some number
  // of decimals, so even the rare pair less than a millionth apart shows which is higher. Each
  // score shows as the step it reaches at that many decimals, so it also compares with each line
  // the way the filter compares the score itself.
  function decimalsFor({ want, avoid }) {
    let decimals = settings.DECIMALS;
    if (want === null || avoid === null || want === avoid) return decimals;
    const readAlike = () => settings.stepReached(want, decimals) === settings.stepReached(avoid, decimals);
    while (readAlike()) decimals += 1;
    return decimals;
  }

  const formatScore = (value, decimals) =>
    value === null ? ui.message("tryScoreNone") : ui.formatThreshold(settings.stepReached(value, decimals), decimals);

  // The tried title's scores as the verdict and the scores line show them.
  function shownScores(score) {
    const decimals = decimalsFor(score);
    return { want: formatScore(score.want, decimals), avoid: formatScore(score.avoid, decimals) };
  }

  // The lines the sliders are at, by the setting each one saves.
  const currentLines = () => Object.fromEntries(sliders.map(({ input }) => [input.name, input.valueAsNumber]));

  // What the verdict names: the comparison that decided, with the two numbers it compared, and
  // its message when the title is hidden and when it is shown. A topic to avoid is measured
  // against its line while it is the only list, and against the wanted topics once it reaches
  // that line, unless the wanted topics' own line hides the title; otherwise the wanted topics
  // are measured against theirs.
  const TRY_RULES = Object.freeze({
    avoidLine: { values: ["avoid", "avoidThreshold"], hidden: "tryAvoided", shown: "tryNotAvoided" },
    avoidTopics: { values: ["avoid", "want"], hidden: "tryAvoidedMore", shown: "tryAvoidedNotMore" },
    wantLine: { values: ["want", "threshold"], hidden: "tryOffTopic", shown: "tryOnTopic" },
  });

  function tryRule(score, reason, lines) {
    if (score.want === null) return TRY_RULES.avoidLine;
    const comparesTopics = reason !== "off-topic" && verdict.reachesAvoidLine(score, lines);
    return comparesTopics ? TRY_RULES.avoidTopics : TRY_RULES.wantLine;
  }

  function tryVerdictText(score, reason, lines, scores) {
    const shownValues = {
      ...scores,
      threshold: ui.formatThreshold(lines.threshold),
      avoidThreshold: ui.formatThreshold(lines.avoidThreshold),
    };
    const { values, hidden, shown } = tryRule(score, reason, lines);
    return ui.message(reason === null ? shown : hidden, values.map((name) => shownValues[name]));
  }

  // What the result says while there is no score to judge.
  function tryNote() {
    if (tryFailed) return ui.message("tryError");
    if (tryPending) return status.state() === MODEL_STATES.LOADING ? ui.message("modelLoading") : "";
    if (typedTitle() === "" || !topicFilter.checked) return "";
    return verdict.hasTopics(verdict.lists(typed())) ? "" : ui.message("tryNeedsTopics");
  }

  // The verdict names the line, so it changes at every slider step and stays out of the live
  // region. Screen readers announce only Shown or Hidden, which changes when the outcome does.
  function renderTry() {
    if (tryScore === null) {
      setText(tryVerdict, "");
      setText(tryOutcome, "");
      setText(tryScores, tryNote());
      return;
    }
    const lines = currentLines();
    const reason = verdict.decide(tryScore, lines);
    const scores = shownScores(tryScore);
    setText(tryVerdict, tryVerdictText(tryScore, reason, lines, scores));
    setText(tryOutcome, ui.message(reason === null ? "tryShown" : "tryHidden"));
    setText(tryScores, ui.message("tryScores", [scores.want, scores.avoid]));
  }

  // A missing score, from an { error } answer, an answer without this title or a failed send,
  // shows that the title couldn't be checked.
  function settleTry(sequence, score) {
    if (sequence !== trySequence) return;
    tryPending = false;
    tryScore = score ?? null;
    tryFailed = tryScore === null;
    renderTry();
  }

  // Asks the model about the title the same way the filter asks about a video on YouTube.
  function runTry() {
    const title = typedTitle();
    const sequence = ++trySequence;
    tryScore = null;
    tryFailed = false;
    tryPending = title !== "" && verdict.needsModel(typed());
    renderTry();
    if (!tryPending) return;
    const { want, avoid } = verdict.lists(typed());
    const videos = [{ id: TRY_ID, title, channel: "" }];
    chrome.runtime.sendMessage({ type: MATCH, topics: want, avoidTopics: avoid, videos }).then(
      (answer) => settleTry(sequence, answer?.scores?.[TRY_ID]),
      () => settleTry(sequence, null),
    );
  }

  // Turning the filter off drops the try: the one waiting for typing to pause is never sent, a
  // late answer is ignored, and no verdict is left describing a filter that isn't running.
  function stopTry() {
    clearTimeout(tryTimer);
    trySequence += 1;
    tryPending = false;
    tryScore = null;
    tryFailed = false;
  }

  // Changing the topics tries the title again, once there is one.
  function scheduleTry({ target }) {
    if (target !== tryTitle && typedTitle() === "") return;
    clearTimeout(tryTimer);
    tryTimer = setTimeout(runTry, TRY_DELAY_MS);
  }

  // The slider speaks the value as shown, since the shown value isn't read out on its own.
  function renderSlider({ input, value, hintLine, list, hint, emptyHint }, typedLists) {
    value.value = ui.formatThreshold(input.valueAsNumber);
    input.setAttribute("aria-valuetext", value.value);
    setText(hintLine, ui.message(typedLists[list].length > 0 ? hint : emptyHint));
  }

  // Each button needs a name to save or rename to, and a selected profile to rename or delete.
  function renderProfiles() {
    const off = !topicFilter.checked;
    const unnamed = profileName.value.trim() === "";
    const unselected = profiles.active(page.values) === null;
    ui.fillProfileSelect(profileSelect, page.values);
    saveProfile.disabled = off || unnamed;
    renameProfile.disabled = off || unnamed || unselected;
    deleteProfile.disabled = off || unselected;
  }

  // The topics, the sliders, the try box, the profiles, the pages and the channel lists only
  // apply while filtering. The profiles and the channel lists start disabled in the HTML: a list
  // typed before the stored ones load would have nothing to take its names out of. Moving a
  // slider judges the tried title again. The switches for Home and Shorts work without the filter.
  function render() {
    ui.renderFeedSwitches(form.elements);
    for (const control of filterControls) control.disabled = !topicFilter.checked;
    renderProfiles();
    const typedLists = verdict.lists(typed());
    for (const slider of sliders) renderSlider(slider, typedLists);
    status.render();
    if (!topicFilter.checked) stopTry();
    renderTry();
  }

  const isChannelField = (control) => channelFields.includes(control);

  // Each channel list shows one name per line.
  function display(values) {
    const shown = { ...values };
    for (const { name } of channelFields) {
      if (Object.hasOwn(values, name)) shown[name] = values[name].join("\n");
    }
    return shown;
  }

  // A typed channel list saves its names, and takes them out of the other list. Topics and
  // sliders update the profile they were changed for, and picking a profile brings its own.
  function changesFor(control, values) {
    if (isChannelField(control)) return channels.reconcile(values, control.name, channels.parse(control.value));
    return profiles.changesFor(control.name, ui.valueOf(control), values, editedProfiles.get(control));
  }

  // Shows a message in a section's error line, or hides the line when key is null.
  function showLine(line, key) {
    setText(line, key === null ? "" : ui.message(key));
    line.hidden = key === null;
  }

  // Only the first names of a list that is too long are saved, so the page says so.
  const channelNote = () =>
    channelFields.some((field) => channels.countNames(field.value) > settings.LIMITS.MAX_CHANNELS) ? "listFull" : null;

  // The error line of the section a control is in, if that section has one.
  const errorLineOf = (control) => control.closest("section").querySelector(".error");

  function onSaved(control) {
    const line = errorLineOf(control);
    if (line) showLine(line, line === channelsError ? channelNote() : null);
  }

  // A refusal because a value no longer fits in Chrome sync, and one because the profiles don't.
  const isQuotaError = (error) => error?.code === settings.QUOTA_ERROR;
  const isProfilesFull = (error) => isQuotaError(error) && error.key === "profiles";

  // A change that no longer fits in its profile still reaches the filter. The profile keeps what it had.
  function saveWithoutProfile(control) {
    page.save({ [control.name]: ui.valueOf(control) }).then(
      () => showLine(topicsError, "profileChangeTooLarge"),
      () => showLine(topicsError, "saveFailed"),
    );
  }

  // A section without an error line still reports the refused save, in the console.
  function onError(error, control) {
    if (profileFields.includes(control) && isProfilesFull(error)) {
      saveWithoutProfile(control);
      return;
    }
    const line = errorLineOf(control);
    if (line) showLine(line, "saveFailed");
    else ui.reportSaveError(error);
  }

  // The button just pressed can turn off with the name cleared, and focus then goes to the
  // profile list, which shows the result.
  function profilesSaved() {
    const focused = document.activeElement;
    profileName.value = "";
    showLine(profilesError, null);
    renderProfiles();
    if (focused?.disabled) profileSelect.focus();
  }

  // Saves the profiles a button changed, and the profile now selected, or says why it can't.
  function saveProfiles({ error, list, name }) {
    if (error) {
      showLine(profilesError, PROFILE_ERRORS[error]);
      return;
    }
    page.save({ profiles: list, activeProfile: name }).then(profilesSaved, (refusal) =>
      showLine(profilesError, isQuotaError(refusal) ? PROFILE_ERRORS.full : "saveFailed"),
    );
  }

  // A new profile saves the topics and sliders as shown, even before their own save.
  const shownProfile = () => ({
    name: profileName.value,
    ...Object.fromEntries(profileFields.map((control) => [control.name, ui.valueOf(control)])),
  });

  // A shortcut's description, then its keys, or Not set when Chrome left it unset.
  function shortcutRow({ description, shortcut }) {
    const row = document.createElement("li");
    const name = document.createElement("span");
    const keys = document.createElement("kbd");
    name.textContent = description;
    keys.textContent = shortcut || ui.message("shortcutUnset");
    row.append(name, " ", keys);
    return row;
  }

  // Lists the shortcuts as Chrome has them set. Nothing needs the result, and reading them doesn't
  // fail, so callers don't wait for it or catch.
  async function renderShortcuts() {
    const commands = await chrome.commands.getAll();
    const ours = COMMANDS.map((name) => commands.find((command) => command.name === name)).filter(Boolean);
    shortcutList.replaceChildren(...ours.map(shortcutRow));
  }

  // The fields' limits are set here rather than in the HTML, so the page allows what settings.js reads.
  for (const field of topicFields) field.maxLength = settings.LIMITS.MAX_TEXT_LENGTH;
  // The topic fields and the sliders save once they pause, on input. This runs before the
  // form's listener makes the edit pending, so it sees where the edit starts.
  for (const control of profileFields) {
    control.addEventListener("input", () => {
      if (!page.saver.isPending(control)) editedProfiles.set(control, page.values.activeProfile);
    });
  }
  profileName.maxLength = settings.LIMITS.MAX_PROFILE_NAME_LENGTH;
  profileName.addEventListener("input", renderProfiles);
  saveProfile.addEventListener("click", () => saveProfiles(profiles.create(page.values.profiles, shownProfile())));
  renameProfile.addEventListener("click", () =>
    saveProfiles(profiles.rename(page.values.profiles, page.values.activeProfile, profileName.value)),
  );
  // Deleting a profile keeps its topics and sliders, so the filter goes on as before.
  deleteProfile.addEventListener("click", () =>
    saveProfiles({ list: profiles.remove(page.values.profiles, page.values.activeProfile), name: "" }),
  );
  for (const field of channelFields) {
    field.maxLength = settings.LIMITS.MAX_CHANNEL_TEXT_LENGTH;
    field.addEventListener("input", () => showLine(channelsError, channelNote()));
  }
  tryTitle.maxLength = settings.LIMITS.MAX_TITLE_LENGTH;
  for (const { input } of sliders) {
    input.min = settings.LIMITS.MIN_THRESHOLD;
    input.max = settings.LIMITS.MAX_THRESHOLD;
  }
  for (const field of [tryTitle, ...topicFields]) field.addEventListener("input", scheduleTry);
  // Enter in the title box would submit the form and reload the page.
  form.addEventListener("submit", (event) => event.preventDefault());
  document.getElementById("change-shortcuts").addEventListener("click", () => chrome.tabs.create({ url: SHORTCUTS_PAGE }));
  // The shortcuts may have changed on Chrome's page by the time the user comes back to this tab.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void renderShortcuts();
  });

  // page is used by the functions above, which only run once the page has started.
  const page = ui.startPage({ form, render, display, changesFor, onSaved, onError });
  void renderShortcuts();
})();
