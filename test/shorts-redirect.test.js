import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readJson, runScripts } from "./helpers.js";

const [ruleset] = readJson("manifest.json").declarative_net_request.rule_resources;
const [rule] = readJson(ruleset.path);
// Chrome matches without regard to case unless the rule asks otherwise.
const pattern = new RegExp(rule.condition.regexFilter, rule.condition.isUrlFilterCaseSensitive ? "" : "i");
const substitution = rule.action.redirect.regexSubstitution.replaceAll(/\\(\d)/g, "$$$1");

// Rewrites url the way Chrome applies a regexSubstitution: the first match is replaced, and the
// pattern's \1 inserts the first capture group.
const redirect = (url) => (pattern.test(url) ? url.replace(pattern, substitution) : null);

test("the manifest ships the Shorts rule turned off, under the id the background uses", () => {
  const context = vm.createContext({});
  runScripts(context, ["src/protocol.js"]);

  assert.equal(ruleset.id, context.BetterYT.protocol.SHORTS_RULESET);
  assert.equal(ruleset.enabled, false);
});

test("redirects a Short's full page load to the regular player", () => {
  // Chrome keeps whatever the pattern leaves unmatched, so the pattern consumes the query too.
  assert.equal(redirect("https://www.youtube.com/shorts/C4dGVTl6ry8?feature=share"), "https://www.youtube.com/watch?v=C4dGVTl6ry8");
  assert.equal(redirect("https://youtube.com/shorts/abc-_1"), "https://www.youtube.com/watch?v=abc-_1");
  // YouTube's own requests from inside the page, such as the next Short's data, are left alone.
  assert.deepEqual(rule.condition.resourceTypes, ["main_frame"]);
});

test("leaves the Shorts feed and other pages alone", () => {
  for (const url of [
    "https://www.youtube.com/shorts/",
    "https://www.youtube.com/watch?v=x",
    "https://www.youtube.com/feed/subscriptions",
  ]) {
    assert.equal(redirect(url), null, url);
  }
});
