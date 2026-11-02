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

  // The settings needsModel reads, so a change to any other setting can't change its answer.
  const MODEL_SETTINGS = Object.freeze(["topicFilter", "topics", "avoidTopics"]);

  // The model is needed only while the filter is on and has topics to match.
  function needsModel(values) {
    if (!values.topicFilter) return false;
    return hasTopics(lists(values));
  }

  // Whether a change takes the filter from not needing the model to needing it, which is when
  // the code that saved the change starts loading it.
  const startsNeedingModel = (before, after) => !needsModel(before) && needsModel(after);

  // Whether a video matches a topic to avoid at the Match that hides line or more. An empty list
  // scores null, and never reaches it.
  const reachesAvoidLine = ({ avoid }, { avoidThreshold }) => (avoid ?? -Infinity) >= avoidThreshold;

  // Returns why a video with these similarities is hidden, "avoided" or "off-topic", or null to
  // show it. A video is avoided when it reaches the line of the topics to avoid and matches them
  // more than the wanted topics, so with both lists the stronger match decides and a tie keeps
  // it. Otherwise it is off-topic when it matches no wanted topic at threshold or more. An empty
  // list scores null, and hides nothing.
  function decide(score, lines) {
    const { want, avoid } = score;
    if (reachesAvoidLine(score, lines) && avoid > (want ?? -Infinity)) return "avoided";
    if ((want ?? Infinity) < lines.threshold) return "off-topic";
    return null;
  }

  globalThis.BetterYT.verdict = Object.freeze({
    NO_SCORE,
    MODEL_SETTINGS,
    lists,
    hasTopics,
    needsModel,
    startsNeedingModel,
    reachesAvoidLine,
    decide,
  });
})();
