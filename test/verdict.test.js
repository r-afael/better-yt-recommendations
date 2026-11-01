import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { runScripts, score } from "./helpers.js";

function loadVerdict() {
  const context = vm.createContext({});
  runScripts(context, ["src/topics.js", "src/verdict.js"]);
  return context.BetterYT.verdict;
}

const verdict = loadVerdict();

// Each row is [want, avoid, threshold, the expected verdict].
function assertDecisions(rows) {
  for (const [want, avoid, threshold, expected] of rows) {
    assert.equal(verdict.decide(score(want, avoid), threshold), expected, JSON.stringify({ want, avoid, threshold }));
  }
}

test("only wanted topics: hidden below the sensitivity", () => {
  assertDecisions([
    [0.24, null, 0.25, "off-topic"],
    [0.25, null, 0.25, null],
  ]);
});

test("only topics to avoid: hidden when closer than the sensitivity", () => {
  assertDecisions([
    [null, 0.26, 0.25, "avoided"],
    [null, 0.25, 0.25, null],
  ]);
});

test("both lists: hidden when a topic to avoid is closer than the closest wanted one", () => {
  assertDecisions([
    [0.31, 0.35, 0.25, "avoided"],
    [0.31, 0.2, 0.25, null],
    [0.31, 0.2, 0.35, "off-topic"],
    [0.4, 0.4, 0.25, null],
  ]);
});

test("an unscored video stays visible", () => {
  assert.equal(verdict.decide(verdict.NO_SCORE, 0.25), null);
});

test("the model is needed only with the filter on and some topics", () => {
  const rows = [
    [{ topicFilter: false, topics: "chess", avoidTopics: "gaming" }, false],
    [{ topicFilter: true, topics: " , ", avoidTopics: " , " }, false],
    [{ topicFilter: true, topics: "", avoidTopics: "gaming" }, true],
  ];
  for (const [values, expected] of rows) assert.equal(verdict.needsModel(values), expected, JSON.stringify(values));
});
