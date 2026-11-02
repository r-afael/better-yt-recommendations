// Toolbar popup with the main switches, the profile switch, a summary of the topics and the
// topic model's status, for quick access.
// The options page has these and every other setting. Open YouTube tabs pick up changes right away.
(() => {
  "use strict";

  const { profiles, ui, verdict } = globalThis.BetterYT;
  ui.addFeedSwitches();
  const form = document.getElementById("settings");
  const { activeProfile: profileSelect } = form.elements;
  const profileRow = document.getElementById("profile-row");
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

  // The switch shows once there is a profile to pick. Like the topics, it only applies while filtering.
  function renderProfiles() {
    profileRow.hidden = page.values.profiles.length === 0;
    ui.fillProfileSelect(profileSelect, page.values);
    profileSelect.disabled = !page.values.topicFilter;
  }

  function render() {
    ui.renderFeedSwitches(form.elements);
    renderProfiles();
    renderSummary();
    status.render();
  }

  for (const id of ["open-options-icon", "summary", "open-options"]) {
    document.getElementById(id).addEventListener("click", () => chrome.runtime.openOptionsPage());
  }

  // Picking a profile saves its topics and sliders with it, and the summary follows the topics
  // once they're saved.
  const changesFor = (control, values) => profiles.changesFor(control.name, ui.valueOf(control), values);
  const page = ui.startPage({ form, render, changesFor });
})();
