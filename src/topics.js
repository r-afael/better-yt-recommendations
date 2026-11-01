// Topics the user wants to see, typed on the options page as a list such as "programming, chess".
(() => {
  "use strict";

  const MAX_TOPICS = 20;
  const MAX_TOPIC_LENGTH = 60;
  // Commas in Latin, Chinese, Japanese and Arabic scripts, semicolons and new lines.
  const SEPARATORS = /[,，、،;\n]/u;

  // Returns the distinct topics in text, ignoring case and extra spaces.
  function parse(text) {
    const topics = new Map();
    for (const part of String(text ?? "").split(SEPARATORS)) {
      const topic = part.replaceAll(/\s+/gu, " ").trim().slice(0, MAX_TOPIC_LENGTH).trim();
      const key = topic.toLocaleLowerCase();
      if (topic && !topics.has(key)) topics.set(key, topic);
    }
    return [...topics.values()].slice(0, MAX_TOPICS);
  }

  globalThis.BetterYT ??= {};
  globalThis.BetterYT.topics = Object.freeze({ MAX_TOPICS, MAX_TOPIC_LENGTH, parse });
})();
