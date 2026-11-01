// Options page with the settings that don't fit in the popup: the topics and the filter sensitivity.
// Open YouTube tabs pick up changes right away.
(() => {
  "use strict";

  const { topics, ui } = globalThis.BetterYT;
  const form = document.getElementById("settings");
  const { topicFilter, topics: topicsField, threshold } = form.elements;
  const thresholdValue = document.getElementById("threshold-value");
  // Reads the field as typed, so the status appears with the first topic and not once it is saved.
  const status = ui.createModelStatus({
    status: document.getElementById("model-status"),
    progressBar: document.getElementById("model-progress"),
    isVisible: () => topicFilter.checked && topics.parse(topicsField.value).length > 0,
  });

  // The topics and the sensitivity only apply while filtering.
  function render() {
    topicsField.disabled = !topicFilter.checked;
    threshold.disabled = !topicFilter.checked;
    thresholdValue.value = ui.formatThreshold(threshold.valueAsNumber);
    status.render();
  }

  ui.startPage({ form, render });
})();
