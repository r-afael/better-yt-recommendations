// Toolbar popup with the main switches, a summary of the topics and the topic model's status.
// Everything else is on the options page. Open YouTube tabs pick up changes right away.
(() => {
  "use strict";

  const { topics, ui } = globalThis.BetterYT;
  const form = document.getElementById("settings");
  const { enabled, enforce } = form.elements;
  const summaryField = document.querySelector(".summary-field");
  const summaryTopics = document.getElementById("summary-topics");
  // page is what startPage() returns below. These only run after it has returned.
  const wantedTopics = () => topics.parse(page.values.topics);
  const status = ui.createModelStatus({
    status: document.getElementById("model-status"),
    progressBar: document.getElementById("model-progress"),
    isVisible: () => page.values.topicFilter && wantedTopics().length > 0,
  });

  function renderSummary() {
    const wanted = wantedTopics();
    summaryTopics.textContent =
      wanted.length > 0 ? ui.message("summaryTopics", ui.formatList(wanted)) : ui.message("noTopicsYet");
    summaryField.classList.toggle("off", !page.values.topicFilter);
  }

  // Enforcement mode builds on opening the custom feed.
  function render() {
    enforce.disabled = !enabled.checked;
    renderSummary();
    status.render();
  }

  for (const id of ["open-options-icon", "summary", "open-options"]) {
    document.getElementById(id).addEventListener("click", () => chrome.runtime.openOptionsPage());
  }

  const page = ui.startPage({ form, render });
})();
