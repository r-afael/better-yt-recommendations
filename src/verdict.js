// Decides from a video's scores whether it is hidden, and whether the filter needs the model.
// Pure logic, shared by the content script, the extension's pages and the background.
(() => {
  "use strict";

  const { topics: topicList } = globalThis.BetterYT;

  // The scores of a video the model's answer leaves out, which stays visible.
  const NO_SCORE = Object.freeze({ want: null, avoid: null });

  // The topics the user wants to see and the topics to avoid, as lists.
  function lists({ topics, avoidTopics }) {
    return { want: topicList.parse(topics), avoid: topicList.parse(avoidTopics) };
  }

  // Whether there is any topic to match, wanted or to avoid.
  const hasTopics = ({ want, avoid }) => want.length > 0 || avoid.length > 0;

  // The model is needed only while the filter is on and has topics to match.
  function needsModel(values) {
    if (!values.topicFilter) return false;
    return hasTopics(lists(values));
  }

  // Returns why a video with these similarities is hidden, "off-topic" or "avoided", or null to show it.
  function decide({ want, avoid }, threshold) {
    const closest = want ?? threshold; // No wanted topics: every video sits exactly on the line.
    const avoided = avoid ?? -Infinity; // No topics to avoid: nothing to beat.
    if (closest < threshold) return "off-topic";
    if (avoided > closest) return "avoided";
    return null; // Visible. Ties keep the video.
  }

  globalThis.BetterYT.verdict = Object.freeze({ NO_SCORE, lists, hasTopics, needsModel, decide });
})();
