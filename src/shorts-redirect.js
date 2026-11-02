// Turns the rule in src/rules/shorts-redirect.json on and off with Hide Shorts. While it is on,
// Chrome rewrites a Short's address into the regular video's before loading the page, so the
// Shorts player never shows.
(() => {
  "use strict";

  const { protocol, settings } = globalThis.BetterYT;
  const RULESET_IDS = [protocol.SHORTS_RULESET];

  const logFailure = (error) => console.error("Better YT Recommendations: switching the Shorts redirect failed.", error);

  // A failure leaves the rule as it was, and is logged. After a failed enable, src/shorts.js still
  // opens the regular player; a failed disable is undone by the next reconcile, at startup or on
  // an update.
  function sync(on) {
    const change = on ? { enableRulesetIds: RULESET_IDS } : { disableRulesetIds: RULESET_IDS };
    return chrome.declarativeNetRequest.updateEnabledRulesets(change).catch(logFailure);
  }

  // Chrome keeps the rule's state across restarts, but resets it to the manifest's (off) on every
  // update of the extension. Reconciling on install and update covers that, and on startup it
  // covers a change that synced in from another computer while Chrome was closed.
  function reconcile() {
    return settings.load().then((values) => sync(values.hideShorts));
  }

  function onSettingsChanged(changes) {
    if ("hideShorts" in changes) sync(changes.hideShorts.newValue === true);
  }

  globalThis.BetterYT.shortsRedirect = Object.freeze({ reconcile, onSettingsChanged });
})();
