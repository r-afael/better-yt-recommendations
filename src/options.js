// Options page with every setting: the popup's switches for Home and Shorts and Filter
// recommendations, then what doesn't fit in the popup: the topics to see and to avoid, the
// filter sensitivity, a box to try a title against them, the topic profiles, the pages to
// filter, the channel lists and the keyboard shortcuts. Open YouTube tabs pick up changes
// right away.
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

  const form = document.getElementById("settings");
  const {
    topicFilter,
    topics: topicsField,
    avoidTopics: avoidField,
    threshold,
    activeProfile: profileSelect,
    allowedChannels,
    blockedChannels,
  } = form.elements;
  const channelFields = [allowedChannels, blockedChannels];
  const topicFields = [topicsField, avoidField];
  const thresholdValue = document.getElementById("threshold-value");
  const thresholdHint = document.getElementById("threshold-hint");
  const tryTitle = document.getElementById("try-title");
  const tryVerdict = document.getElementById("try-verdict");
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
  const filterControls = [...topicFields, threshold, tryTitle, profileSelect, profileName, ...pageSwitches, ...channelFields];

  let tryTimer = null;
  let trySequence = 0; // Only the answer to the latest try is shown.
  let tryPending = false;
  let tryScore = null; // The latest try's { want, avoid }, which the slider judges again as it moves.
  let tryFailed = false;
  // The profile selected when each topics field's pending edit started, which is the one it updates.
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

  const formatScore = (value) => (value === null ? ui.message("tryScoreNone") : ui.formatThreshold(value));

  // What the result says while there is no score to judge.
  function tryNote() {
    if (tryFailed) return ui.message("tryError");
    if (tryPending) return status.state() === MODEL_STATES.LOADING ? ui.message("modelLoading") : "";
    if (typedTitle() === "" || !topicFilter.checked) return "";
    return verdict.hasTopics(verdict.lists(typed())) ? "" : ui.message("tryNeedsTopics");
  }

  function renderTry() {
    if (tryScore === null) {
      setText(tryVerdict, "");
      setText(tryScores, tryNote());
      return;
    }
    const hidden = verdict.decide(tryScore, threshold.valueAsNumber) !== null;
    setText(tryVerdict, ui.message(hidden ? "tryHidden" : "tryShown"));
    setText(tryScores, ui.message("tryScores", [formatScore(tryScore.want), formatScore(tryScore.avoid)]));
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

  // With only topics to avoid, the slider works the other way round, so its hint says so.
  function sensitivityHint() {
    const { want, avoid } = verdict.lists(typed());
    return want.length === 0 && avoid.length > 0 ? "sensitivityHintAvoid" : "sensitivityHint";
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

  // The topics, the sensitivity, the try box, the profiles, the pages and the channel lists only
  // apply while filtering. The profiles and the channel lists start disabled in the HTML: a list
  // typed before the stored ones load would have nothing to take its names out of. Moving the
  // slider judges the tried title again. The switches for Home and Shorts work without the filter.
  function render() {
    ui.renderFeedSwitches(form.elements);
    for (const control of filterControls) control.disabled = !topicFilter.checked;
    renderProfiles();
    // The slider speaks the value as shown, since the shown value isn't read out on its own.
    thresholdValue.value = ui.formatThreshold(threshold.valueAsNumber);
    threshold.setAttribute("aria-valuetext", thresholdValue.value);
    thresholdHint.textContent = ui.message(sensitivityHint());
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

  // A typed channel list saves its names, and takes them out of the other list. Topics update
  // the profile they were typed for, and picking a profile brings its topics.
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

  // Topics too long for their profile still reach the filter. The profile keeps its older topics.
  function saveTopicsAlone(control) {
    page.save({ [control.name]: ui.valueOf(control) }).then(
      () => showLine(topicsError, "profileTopicsTooLong"),
      () => showLine(topicsError, "saveFailed"),
    );
  }

  // A section without an error line still reports the refused save, in the console.
  function onError(error, control) {
    if (topicFields.includes(control) && isProfilesFull(error)) {
      saveTopicsAlone(control);
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

  // A new profile saves the topics as typed, even before their own save.
  const typedProfile = () => ({ name: profileName.value, topics: topicsField.value, avoidTopics: avoidField.value });

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

  async function renderShortcuts() {
    const commands = await chrome.commands.getAll();
    const ours = COMMANDS.map((name) => commands.find((command) => command.name === name)).filter(Boolean);
    shortcutList.replaceChildren(...ours.map(shortcutRow));
  }

  // The fields' limits are set here rather than in the HTML, so the page allows what settings.js reads.
  for (const field of topicFields) {
    field.maxLength = settings.LIMITS.MAX_TEXT_LENGTH;
    // This runs before the form's listener makes the edit pending, so it sees where the edit starts.
    field.addEventListener("input", () => {
      if (!page.saver.isPending(field)) editedProfiles.set(field, page.values.activeProfile);
    });
  }
  profileName.maxLength = settings.LIMITS.MAX_PROFILE_NAME_LENGTH;
  profileName.addEventListener("input", renderProfiles);
  saveProfile.addEventListener("click", () => saveProfiles(profiles.create(page.values.profiles, typedProfile())));
  renameProfile.addEventListener("click", () =>
    saveProfiles(profiles.rename(page.values.profiles, page.values.activeProfile, profileName.value)),
  );
  // Deleting a profile keeps its topics, so the filter goes on as before.
  deleteProfile.addEventListener("click", () =>
    saveProfiles({ list: profiles.remove(page.values.profiles, page.values.activeProfile), name: "" }),
  );
  for (const field of channelFields) {
    field.maxLength = settings.LIMITS.MAX_CHANNEL_TEXT_LENGTH;
    field.addEventListener("input", () => showLine(channelsError, channelNote()));
  }
  tryTitle.maxLength = settings.LIMITS.MAX_TITLE_LENGTH;
  threshold.min = settings.LIMITS.MIN_THRESHOLD;
  threshold.max = settings.LIMITS.MAX_THRESHOLD;
  for (const field of [tryTitle, ...topicFields]) field.addEventListener("input", scheduleTry);
  // Enter in the title box would submit the form and reload the page.
  form.addEventListener("submit", (event) => event.preventDefault());
  document.getElementById("change-shortcuts").addEventListener("click", () => chrome.tabs.create({ url: SHORTCUTS_PAGE }));
  // The shortcuts may have changed on Chrome's page by the time the user comes back to this tab.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) renderShortcuts();
  });

  // page is used by the functions above, which only run once the page has started.
  const page = ui.startPage({ form, render, display, changesFor, onSaved, onError });
  renderShortcuts();
})();
