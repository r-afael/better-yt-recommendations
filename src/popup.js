// Toolbar popup with the extension's settings and the topic model's status.
// Open YouTube tabs pick up changes right away.
(() => {
  "use strict";

  const { protocol, settings, topics } = globalThis.BetterYT;
  const { MODEL_STATES, STATUS_KEY } = protocol;
  const form = document.getElementById("settings");
  const { enabled, enforce, topicFilter, topics: topicsField, threshold } = form.elements;
  const thresholdValue = document.getElementById("threshold-value");
  const status = document.getElementById("model-status");
  const progressBar = document.getElementById("model-progress");

  const SAVE_DELAY_MS = 400; // chrome.storage.sync allows about 120 writes a minute.
  const STATUS_MESSAGES = Object.freeze({
    [MODEL_STATES.IDLE]: "modelIdle",
    [MODEL_STATES.LOADING]: "modelLoading",
    [MODEL_STATES.READY]: "modelReady",
    [MODEL_STATES.ERROR]: "modelError",
  });

  let modelStatus = { state: MODEL_STATES.IDLE };
  let saveTimer = null;
  let pending = null; // The control whose value waits for saveTimer to be saved.

  const message = (key, substitutions) => chrome.i18n.getMessage(key, substitutions);

  function translatePage() {
    document.documentElement.lang = message("lang");
    document.documentElement.dir = message("@@bidi_dir");
    for (const element of document.querySelectorAll("[data-i18n]")) {
      element.textContent = message(element.dataset.i18n);
    }
    for (const element of document.querySelectorAll("[data-i18n-placeholder]")) {
      element.placeholder = message(element.dataset.i18nPlaceholder);
    }
  }

  const isCheckbox = (control) => control.type === "checkbox";
  const isRange = (control) => control.type === "range";

  function valueOf(control) {
    if (isCheckbox(control)) return control.checked;
    return isRange(control) ? control.valueAsNumber : control.value;
  }

  const formatThreshold = (value) => value.toLocaleString(message("lang"), { minimumFractionDigits: 2 });

  function show(values) {
    for (const control of form.elements) {
      if (!(control.name in values)) continue;
      if (isCheckbox(control)) control.checked = values[control.name];
      else control.value = values[control.name];
    }
  }

  function save(control) {
    settings.save({ [control.name]: valueOf(control) });
  }

  // The live region only names the state, so screen readers announce changes of state and not
  // every percent of the download. The progress bar, which isn't live, shows the percent.
  function renderStatus() {
    status.hidden = !topicFilter.checked || topics.parse(topicsField.value).length === 0;
    const text = message(STATUS_MESSAGES[modelStatus.state] ?? STATUS_MESSAGES[MODEL_STATES.IDLE]);
    // Rewriting the same text would make screen readers announce it again.
    if (status.textContent !== text) status.textContent = text;
    progressBar.hidden = status.hidden || modelStatus.state !== MODEL_STATES.LOADING;
    progressBar.value = Math.round((modelStatus.progress ?? 0) * 100);
  }

  function renderThreshold() {
    thresholdValue.value = formatThreshold(threshold.valueAsNumber);
  }

  // Enforcement mode builds on opening the custom feed, and topics only apply while filtering.
  function render() {
    enforce.disabled = !enabled.checked;
    topicsField.disabled = !topicFilter.checked;
    threshold.disabled = !topicFilter.checked;
    renderThreshold();
    renderStatus();
  }

  function cancelPendingSave() {
    clearTimeout(saveTimer);
    saveTimer = null;
    pending = null;
  }

  // Saves control once its value stops changing. Another control's pending value is saved first.
  function saveLater(control) {
    if (pending !== control) savePendingNow();
    clearTimeout(saveTimer);
    pending = control;
    saveTimer = setTimeout(savePendingNow, SAVE_DELAY_MS);
  }

  function savePendingNow() {
    if (pending === null) return;
    const control = pending;
    cancelPendingSave();
    save(control);
  }

  function showModelStatus(value) {
    modelStatus = value ?? { state: MODEL_STATES.IDLE };
    renderStatus();
  }

  translatePage();

  form.addEventListener("change", (event) => {
    // Holding an arrow key on the slider fires change at every step, so it saves only once it pauses.
    if (isRange(event.target)) return;
    if (event.target === pending) cancelPendingSave();
    save(event.target);
    render();
  });

  topicsField.addEventListener("input", () => {
    saveLater(topicsField);
    renderStatus();
  });

  threshold.addEventListener("input", () => {
    saveLater(threshold);
    renderThreshold();
  });

  // Closing the popup ends the page, so changes that haven't been saved yet are saved now.
  addEventListener("pagehide", savePendingNow);
  addEventListener("blur", savePendingNow);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "session" && STATUS_KEY in changes) showModelStatus(changes[STATUS_KEY].newValue);
  });

  settings.load().then((values) => {
    show(values);
    render();
  });
  chrome.storage.session.get(STATUS_KEY).then((stored) => showModelStatus(stored[STATUS_KEY]));
})();
