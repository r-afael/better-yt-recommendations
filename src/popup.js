// Toolbar popup with the extension's settings and the topic model's status.
// Open YouTube tabs pick up changes right away.
(() => {
  "use strict";

  const { topics, ui } = globalThis.BetterYT;
  const form = document.getElementById("settings");
  const { enabled, enforce, topicFilter, topics: topicsField, threshold } = form.elements;
  const thresholdValue = document.getElementById("threshold-value");
  const status = ui.createModelStatus({
    status: document.getElementById("model-status"),
    progressBar: document.getElementById("model-progress"),
    isVisible: () => topicFilter.checked && topics.parse(topicsField.value).length > 0,
  });

  // Enforcement mode builds on opening the custom feed, and topics only apply while filtering.
  function render() {
    enforce.disabled = !enabled.checked;
    topicsField.disabled = !topicFilter.checked;
    threshold.disabled = !topicFilter.checked;
    thresholdValue.value = ui.formatThreshold(threshold.valueAsNumber);
    status.render();
  }

  ui.startPage({ form, render });
})();
