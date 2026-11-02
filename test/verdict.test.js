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

const LINES = { threshold: 0.25, avoidThreshold: 0.2 };

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
    [null, 0.2, "avoided"],
    [null, 0.19, null],
  ]);
});

// The first four rows are titles the model scored against the topics programming, java, sql,
// leetcode, javascript and system design, and the topic to avoid gaming.
test("both lists: a topic to avoid hides from its line only when it matches more than the wanted topics", () => {
  assertDecisions([
    [0.926, 0.202, null], // Java
    [0.39, 0.33, null], // I Played 100 Games of Bullet Chess
    [0.02, 0.3, "avoided"], // Top 10 Best PS5 Games
    [0.22, 0.38, "avoided"], // Gaming Setup Tour
    [0.3, 0.3, null], // A tie keeps the video.
    [0.1, 0.15, "off-topic"], // Below its line, a topic to avoid hides nothing.
    [0.22, 0.21, "off-topic"], // Kept from the topic to avoid, then judged against its own line.
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
