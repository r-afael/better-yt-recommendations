// Options page with the settings that don't fit in the popup: the topics to see and to avoid,
// and the filter sensitivity. Open YouTube tabs pick up changes right away.
(() => {
  "use strict";

  const { ui, verdict } = globalThis.BetterYT;
  const form = document.getElementById("settings");
  const { topicFilter, topics: topicsField, avoidTopics: avoidField, threshold } = form.elements;
  const thresholdValue = document.getElementById("threshold-value");
  const thresholdHint = document.getElementById("threshold-hint");
  // The fields as typed, so the page follows the first topic and not only once it is saved.
  const typed = () => ({ topicFilter: topicFilter.checked, topics: topicsField.value, avoidTopics: avoidField.value });
  const status = ui.createModelStatus({
    status: document.getElementById("model-status"),
    progressBar: document.getElementById("model-progress"),
    loadButton: document.getElementById("load-now"),
    isVisible: () => verdict.needsModel(typed()),
  });

  // With only topics to avoid, the slider works the other way round, so its hint says so.
  function sensitivityHint() {
    const { want, avoid } = verdict.lists(typed());
    return want.length === 0 && avoid.length > 0 ? "sensitivityHintAvoid" : "sensitivityHint";
  }

  // The topics and the sensitivity only apply while filtering.
  function render() {
    for (const control of [topicsField, avoidField, threshold]) control.disabled = !topicFilter.checked;
    thresholdValue.value = ui.formatThreshold(threshold.valueAsNumber);
    thresholdHint.textContent = ui.message(sensitivityHint());
    status.render();
  }

  ui.startPage({ form, render });
})();
