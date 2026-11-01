// Runs the offscreen document that holds the topic model: opens it when a tab asks for
// matches, relays the answers and the model status, and closes it to free the memory.
(() => {
  "use strict";

  const { protocol, topics } = globalThis.BetterYT;
  const { OFFSCREEN, STATUS_KEY, MODEL_STATES } = protocol;

  const OFFSCREEN_PATH = "src/offscreen.html";
  const OFFSCREEN_DOCUMENT = {
    url: OFFSCREEN_PATH,
    reasons: ["WORKERS"],
    justification: "Runs the topic-matching AI model in a web worker.",
  };
  // Chrome's errors when a message reaches no listener, such as a document that is closing,
  // or when the document closes before it answers, such as on going idle as a request arrives.
  const MISSING_RECEIVER = /Could not establish connection|Receiving end does not exist|message (?:channel|port) closed/i;
  const NO_ANSWER = "The topic model did not answer.";

  // Opening and closing run one at a time, so concurrent requests share one document
  // and a request never forwards to a document that is still closing.
  let lifecycle = Promise.resolve();
  // Counts the times the user turned the filter off, so a request that was in flight then
  // doesn't reopen the document. Going idle doesn't count: a request arriving then still needs it.
  let turnOffs = 0;

  function serialize(task) {
    const run = lifecycle.then(task);
    lifecycle = run.catch(() => {});
    return run;
  }

  async function hasOffscreen() {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)],
    });
    return contexts.length > 0;
  }

  function ensureOffscreen() {
    return serialize(async () => {
      if (!(await hasOffscreen())) await chrome.offscreen.createDocument(OFFSCREEN_DOCUMENT);
    });
  }

  function closeOffscreen() {
    return serialize(async () => {
      if (await hasOffscreen()) await chrome.offscreen.closeDocument();
    });
  }

  function storeStatus(status) {
    return chrome.storage.session.set({ [STATUS_KEY]: status });
  }

  const errorAnswer = (error) => ({ error: String(error?.message ?? error) });

  async function forward(message) {
    await ensureOffscreen();
    const answer = await chrome.runtime.sendMessage({ ...message, target: OFFSCREEN });
    return answer ?? { error: NO_ANSWER };
  }

  // A document can close between the check and the message, so a missing receiver gets one retry,
  // unless the user turned the filter off meanwhile.
  async function match(message) {
    const startedAt = turnOffs;
    try {
      return await forward(message);
    } catch (error) {
      if (turnOffs !== startedAt || !MISSING_RECEIVER.test(error?.message)) return errorAnswer(error);
      return forward(message).catch(errorAnswer);
    }
  }

  // Freeing the model also resets the status the popup and the options page show.
  // A failed close is ignored: a document closed elsewhere is already freed.
  async function release() {
    await closeOffscreen().catch(() => {});
    await storeStatus({ state: MODEL_STATES.IDLE });
  }

  function turnsFilterOff(changes) {
    if (changes.topicFilter?.newValue === false) return true;
    return "topics" in changes && topics.parse(changes.topics.newValue).length === 0;
  }

  function onSettingsChanged(changes) {
    if (!turnsFilterOff(changes)) return;
    turnOffs += 1;
    release();
  }

  globalThis.BetterYT.modelHost = Object.freeze({ match, storeStatus, release, onSettingsChanged });
})();
