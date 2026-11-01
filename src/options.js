// Options page with the settings that don't fit in the popup: the topics to see and to avoid,
// the filter sensitivity, a box to try a title against them, the pages to filter and the channel
// lists. Open YouTube tabs pick up changes right away.
(() => {
  "use strict";

  const { channels, protocol, settings, ui, verdict } = globalThis.BetterYT;
  const { MATCH, MODEL_STATES } = protocol;
  const { setText } = ui;

  const TRY_ID = "try"; // The id of the one video a try asks the model to score.
  const TRY_DELAY_MS = 400; // A try waits for typing to pause, like saving does.
  const MAX_TITLE_LENGTH = 200; // About twice YouTube's 100-character limit on titles.

  const form = document.getElementById("settings");
  const { topicFilter, topics: topicsField, avoidTopics: avoidField, threshold, allowedChannels, blockedChannels } = form.elements;
  const channelFields = [allowedChannels, blockedChannels];
  const thresholdValue = document.getElementById("threshold-value");
  const thresholdHint = document.getElementById("threshold-hint");
  const tryTitle = document.getElementById("try-title");
  const tryVerdict = document.getElementById("try-verdict");
  const tryScores = document.getElementById("try-scores");
  const pageSwitches = [...document.querySelectorAll('section[aria-labelledby="pages-section"] input')];
  const channelsError = document.getElementById("channels-error");
  const filterControls = [topicsField, avoidField, threshold, tryTitle, ...pageSwitches, ...channelFields];

  let tryTimer = null;
  let trySequence = 0; // Only the answer to the latest try is shown.
  let tryPending = false;
  let tryScore = null; // The latest try's { want, avoid }, which the slider judges again as it moves.
  let tryFailed = false;

  // The fields as typed, so the page follows the first topic and not only once it is saved.
  const typed = () => ({ topicFilter: topicFilter.checked, topics: topicsField.value, avoidTopics: avoidField.value });
  const status = ui.createModelStatus({
    status: document.getElementById("model-status"),
    progressBar: document.getElementById("model-progress"),
    loadButton: document.getElementById("load-now"),
    isVisible: () => verdict.needsModel(typed()),
    onChange: renderTry,
  });

  const typedTitle = () => tryTitle.value.trim().slice(0, MAX_TITLE_LENGTH);

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

  // The topics, the sensitivity, the try box, the pages and the channel lists only apply while
  // filtering. The channel lists start disabled in the HTML: a list typed before the stored ones
  // load would have nothing to take its names out of. Moving the slider judges the tried title again.
  function render() {
    for (const control of filterControls) control.disabled = !topicFilter.checked;
    thresholdValue.value = ui.formatThreshold(threshold.valueAsNumber);
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

  // A typed channel list saves its names, and takes them out of the other list.
  function changesFor(control, values) {
    if (!isChannelField(control)) return { [control.name]: ui.valueOf(control) };
    return channels.reconcile(values, control.name, channels.parse(control.value));
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

  // A section without an error line still reports the refused save, in the console.
  function onError(error, control) {
    const line = errorLineOf(control);
    if (line) showLine(line, "saveFailed");
    else ui.reportSaveError(error);
  }

  // The fields' limits are set here rather than in the HTML, so the page allows what settings.js reads.
  for (const field of [topicsField, avoidField]) field.maxLength = settings.LIMITS.MAX_TEXT_LENGTH;
  for (const field of channelFields) {
    field.maxLength = settings.LIMITS.MAX_CHANNEL_TEXT_LENGTH;
    field.addEventListener("input", () => showLine(channelsError, channelNote()));
  }
  tryTitle.maxLength = MAX_TITLE_LENGTH;
  threshold.min = settings.LIMITS.MIN_THRESHOLD;
  threshold.max = settings.LIMITS.MAX_THRESHOLD;
  for (const field of [tryTitle, topicsField, avoidField]) field.addEventListener("input", scheduleTry);
  // Enter in the title box would submit the form and reload the page.
  form.addEventListener("submit", (event) => event.preventDefault());

  ui.startPage({ form, render, display, changesFor, onSaved, onError });
})();
