// Toolbar popup with the main switches, a summary of the topics and the topic model's status.
// Everything else is on the options page. Open YouTube tabs pick up changes right away.
(() => {
  "use strict";

  const { ui, verdict } = globalThis.BetterYT;
  const form = document.getElementById("settings");
  const { enabled, enforce } = form.elements;
  const summaryField = document.querySelector(".summary-field");
  const summaryTopics = document.getElementById("summary-topics");
  const summaryAvoid = document.getElementById("summary-avoid");
  // page is what startPage() returns below. These only run after it has returned.
  const status = ui.createModelStatus({
    status: document.getElementById("model-status"),
    progressBar: document.getElementById("model-progress"),
    loadButton: document.getElementById("load-now"),
    isVisible: () => verdict.needsModel(page.values),
  });

  // A line such as "Topics: chess, cooking", or "" without topics.
  const listLine = (key, items) => (items.length > 0 ? ui.message(key, ui.formatList(items)) : "");

  // Says there are no topics yet only while both lists are empty.
  function renderSummary() {
    const { want, avoid } = verdict.lists(page.values);
    summaryAvoid.textContent = listLine("summaryAvoiding", avoid);
    summaryAvoid.hidden = avoid.length === 0;
    summaryTopics.textContent = listLine("summaryTopics", want) || ui.message("noTopicsYet");
    summaryTopics.hidden = want.length === 0 && !summaryAvoid.hidden;
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
