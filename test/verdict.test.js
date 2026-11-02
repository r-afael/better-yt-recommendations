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

const LINES = { threshold: 0.25, avoidThreshold: 0.3 };

// Each row is [want, avoid, the expected verdict at LINES].
function assertDecisions(rows) {
  for (const [want, avoid, expected] of rows) {
    assert.equal(verdict.decide(score(want, avoid), LINES), expected, JSON.stringify({ want, avoid }));
  }
}

test("only wanted topics: hidden below the match needed, shown from it", () => {
  assertDecisions([
    [0.24, null, "off-topic"],
    [0.25, null, null],
  ]);
});

test("only topics to avoid: hidden from the match that hides, shown below it", () => {
  assertDecisions([
    [null, 0.3, "avoided"],
    [null, 0.29, null],
  ]);
});

test("both lists: each score is judged against its own line, and a topic to avoid wins", () => {
  assertDecisions([
    [0.4, 0.3, "avoided"],
    [0.1, 0.35, "avoided"],
    [0.1, 0.2, "off-topic"],
    [0.31, 0.29, null],
  ]);
});

test("an unscored video stays visible", () => {
  assert.equal(verdict.decide(verdict.NO_SCORE, LINES), null);
});

test("the model is needed only with the filter on and some topics", () => {
  const rows = [
    [{ topicFilter: false, topics: "chess", avoidTopics: "gaming" }, false],
    [{ topicFilter: true, topics: " , ", avoidTopics: " , " }, false],
    [{ topicFilter: true, topics: "", avoidTopics: "gaming" }, true],
  ];
  for (const [values, expected] of rows) assert.equal(verdict.needsModel(values), expected, JSON.stringify(values));
});
