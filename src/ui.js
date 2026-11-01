// Code the settings pages share: starting the page, translation, saving and the model status.
// Each page looks up its own elements, defines render() and boots with startPage().
(() => {
  "use strict";

  const { protocol, settings, verdict } = globalThis.BetterYT;
  const { MODEL_STATES, STATUS_KEY, PRELOAD } = protocol;

  const SAVE_DELAY_MS = 400; // chrome.storage.sync allows about 120 writes a minute.
  const STATUS_MESSAGES = Object.freeze({
    [MODEL_STATES.IDLE]: "modelIdle",
    [MODEL_STATES.LOADING]: "modelLoading",
    [MODEL_STATES.READY]: "modelReady",
    [MODEL_STATES.ERROR]: "modelError",
  });
  // The states in which Load now can start loading the model.
  const LOADABLE_STATES = new Set([MODEL_STATES.IDLE, MODEL_STATES.ERROR]);

  // Each attribute names the message that fills one part of its element.
  const I18N_TARGETS = Object.freeze([
    ["data-i18n", (element, text) => (element.textContent = text)],
    ["data-i18n-placeholder", (element, text) => (element.placeholder = text)],
    ["data-i18n-aria-label", (element, text) => element.setAttribute("aria-label", text)],
    ["data-i18n-title", (element, text) => (element.title = text)],
  ]);

  const noop = () => {};
  const reportSaveError = (error) => console.error("Better YT Recommendations: saving a setting failed.", error);
  const message = (key, substitutions) => chrome.i18n.getMessage(key, substitutions);
  // Asks the background to load the model now. Progress arrives as stored model statuses.
  const preload = () => chrome.runtime.sendMessage({ type: PRELOAD });

  function translatePage() {
    document.documentElement.lang = message("lang");
    document.documentElement.dir = message("@@bidi_dir");
    for (const [attribute, fill] of I18N_TARGETS) {
      for (const element of document.querySelectorAll(`[${attribute}]`)) {
        fill(element, message(element.getAttribute(attribute)));
      }
    }
  }

  const isCheckbox = (control) => control.type === "checkbox";
  const isRange = (control) => control.type === "range";
  const savesAfterPause = (control) => control.type === "textarea" || isRange(control);
  const isSetting = (control) => Object.hasOwn(settings.DEFAULTS, control.name);

  function valueOf(control) {
    if (isCheckbox(control)) return control.checked;
    return isRange(control) ? control.valueAsNumber : control.value;
  }

  const controlChanges = (control) => ({ [control.name]: valueOf(control) });

  // Rewriting the same text would make screen readers announce it again.
  function setText(element, text) {
    if (element.textContent !== text) element.textContent = text;
  }

  const formatThreshold = (value) => value.toLocaleString(message("lang"), { minimumFractionDigits: 2 });

  // "programming, chess" in English and "编程、国际象棋" in Chinese. The unit type would drop the separators.
  const formatList = (items) =>
    new Intl.ListFormat(message("lang"), { style: "narrow", type: "conjunction" }).format(items);

  // skip lets a page keep what the user is editing when changes arrive from elsewhere (see isBusy).
  function show(form, values, { skip = () => false } = {}) {
    for (const control of form.elements) {
      if (!Object.hasOwn(values, control.name) || skip(control)) continue;
      if (isCheckbox(control)) control.checked = values[control.name];
      else control.value = values[control.name];
    }
  }

  // Saves a control's value right away or once it stops changing.
  function createSaver({ save, changesFor, onSaved = noop, onError = reportSaveError }) {
    let timer = null;
    let pending = null; // The control whose value waits for timer to be saved.

    function write(control) {
      save(changesFor(control)).then(
        () => onSaved(control),
        (error) => onError(error, control),
      );
    }

    function cancel() {
      clearTimeout(timer);
      timer = null;
      pending = null;
    }

    function flush() {
      if (pending === null) return;
      const control = pending;
      cancel();
      write(control);
    }

    // Another control's pending value is saved first.
    function saveLater(control) {
      if (pending !== control) flush();
      clearTimeout(timer);
      pending = control;
      timer = setTimeout(flush, SAVE_DELAY_MS);
    }

    // The value saved now replaces the same control's pending one.
    function saveNow(control) {
      if (pending === control) cancel();
      write(control);
    }

    // Closing the page ends it, so changes that haven't been saved yet are saved now.
    addEventListener("pagehide", flush);
    addEventListener("blur", flush);

    return { saveNow, saveLater, flush, isPending: (control) => pending === control };
  }

  function bindForm(form, { saver, onChange }) {
    form.addEventListener("change", ({ target }) => {
      // Holding an arrow key on the slider fires change at every step, so it saves only once it pauses.
      if (!isSetting(target) || isRange(target)) return;
      saver.saveNow(target);
      onChange(target);
    });
    form.addEventListener("input", ({ target }) => {
      if (!isSetting(target) || !savesAfterPause(target)) return;
      saver.saveLater(target);
      onChange(target);
    });
  }

  // A field being typed in, or waiting to be saved, keeps its value when settings change elsewhere.
  // A focused switch still follows them: nothing is typed into it.
  const isBusy = (control, saver) =>
    saver.isPending(control) || (savesAfterPause(control) && control === control.ownerDocument.activeElement);

  // Boots a settings page and owns its values: what is stored, merged with every change since.
  function startPage({ form, render, changesFor = controlChanges, display = (values) => values, onSaved, onError }) {
    const values = {};

    // A save that makes the filter need the model starts loading it, so it is likely ready by
    // the time the user opens YouTube. Only this computer loads it: the background never loads
    // the model for a change synced in from another one.
    async function save(changes) {
      const before = { ...values };
      const previous = Object.fromEntries(Object.keys(changes).map((key) => [key, values[key]]));
      Object.assign(values, changes);
      try {
        await settings.save(changes);
      } catch (error) {
        Object.assign(values, previous);
        throw error;
      }
      if (verdict.startsNeedingModel(before, values)) preload().catch(noop);
    }

    translatePage();
    const saver = createSaver({ save, changesFor: (control) => changesFor(control, values), onSaved, onError });
    bindForm(form, { saver, onChange: render });

    settings.load().then((stored) => {
      Object.assign(values, stored);
      show(form, display(values));
      render();
    });
    settings.subscribe((changes) => {
      Object.assign(values, changes);
      show(form, display(changes), { skip: (control) => isBusy(control, saver) });
      render();
    });

    return { values, save, saver };
  }

  // The live region only names the state, so screen readers announce changes of state and not
  // every percent of the download. The progress bar, which isn't live, shows the percent.
  // onChange lets the page follow the status too, reading it with state().
  function createModelStatus({ status, progressBar, loadButton, isVisible, onChange = noop }) {
    let modelStatus = { state: MODEL_STATES.IDLE };

    function render() {
      status.hidden = !isVisible();
      setText(status, message(STATUS_MESSAGES[modelStatus.state] ?? STATUS_MESSAGES[MODEL_STATES.IDLE]));
      progressBar.hidden = status.hidden || modelStatus.state !== MODEL_STATES.LOADING;
      progressBar.value = Math.round((modelStatus.progress ?? 0) * 100);
      loadButton.hidden = status.hidden || !LOADABLE_STATES.has(modelStatus.state);
    }

    // A new status means the background acted on the last click, so Load now works again.
    function showModelStatus(value) {
      modelStatus = value ?? { state: MODEL_STATES.IDLE };
      loadButton.disabled = false;
      render();
      onChange();
    }

    // A failure brings no new status, so any answer but { ok: true }, or none at all from a send
    // that failed, enables Load now at once.
    loadButton.addEventListener("click", () => {
      loadButton.disabled = true;
      preload().catch(noop).then((answer) => {
        if (!answer?.ok) loadButton.disabled = false;
      });
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "session" && STATUS_KEY in changes) showModelStatus(changes[STATUS_KEY].newValue);
    });
    chrome.storage.session.get(STATUS_KEY).then((stored) => showModelStatus(stored[STATUS_KEY]));

    return { render, state: () => modelStatus.state };
  }

  globalThis.BetterYT.ui = { message, valueOf, setText, reportSaveError, startPage, createModelStatus, formatThreshold, formatList };
})();
