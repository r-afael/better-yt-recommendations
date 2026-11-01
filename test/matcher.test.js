import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { runScripts } from "./helpers.js";

// A unit vector whose similarity to the "x" topic is score.
const near = (score) => [score, Math.sqrt(1 - score * score)];
const X = [1, 0];
const Y = [0, 1];

// Embeds texts from a fixed table and records every batch it was asked for.
function fakeEmbed(table) {
  const batches = [];
  const embed = async (texts) => {
    batches.push([...texts]);
    return texts.map((text) => table[text] ?? Y);
  };
  return { embed, batches };
}

function createMatcher(options) {
  const context = vm.createContext({});
  runScripts(context, ["src/matcher.js"]);
  return context.BetterYT.matcher.createMatcher(options);
}

const video = (id, channel = "") => ({ id, title: id, channel });
// Results come from another realm, so they are copied before deep comparisons.
const plain = (value) => ({ ...value });

test("scores each video by its similarity to the closest topic", async () => {
  const { embed } = fakeEmbed({ x: X, y: Y, chess: Y, cooking: [-1, 0] });
  const matcher = createMatcher({ embed });
  const scores = await matcher.score(["x", "y"], [video("chess"), video("cooking")]);
  assert.deepEqual(plain(scores), { chess: 1, cooking: 0 });
});

test("scores a video by its similarity to a single topic", async () => {
  const { embed } = fakeEmbed({ x: X, close: near(0.3), opposite: [-1, 0] });
  const matcher = createMatcher({ embed });
  const scores = await matcher.score(["x"], [video("close"), video("opposite")]);
  assert.deepEqual(plain(scores), { close: 0.3, opposite: -1 });
});

test("compares the title with the channel, or the title alone without one", async () => {
  const { embed, batches } = fakeEmbed({ x: X, "Lecture | MIT": X });
  const matcher = createMatcher({ embed });
  const scores = await matcher.score(["x"], [
    { id: "a", title: "Lecture", channel: "MIT" },
    { id: "b", title: "Lecture", channel: "" },
  ]);
  assert.deepEqual(plain(scores), { a: 1, b: 0 });
  assert.deepEqual(batches, [["x"], ["Lecture | MIT", "Lecture"]]);
});

test("embeds each video text once across requests and topic changes, and each new topic list once", async () => {
  const { embed, batches } = fakeEmbed({ x: X, y: Y, a: X });
  const matcher = createMatcher({ embed });
  await matcher.score(["x"], [video("a"), video("b")]);
  await matcher.score(["x"], [video("a"), video("b"), video("c")]);
  const scores = await matcher.score(["y"], [video("a"), video("c")]);
  assert.deepEqual(plain(scores), { a: 0, c: 1 });
  assert.deepEqual(batches, [["x"], ["a", "b"], ["c"], ["y"]]);
});

test("alternating two topic lists embeds each list once", async () => {
  const { embed, batches } = fakeEmbed({ x: X, y: Y });
  const matcher = createMatcher({ embed });
  for (const topics of [["x"], ["y"], ["x"], ["y"]]) await matcher.score(topics, [video("a")]);
  assert.deepEqual(batches, [["x"], ["a"], ["y"]]);
});

test("embeds repeated texts once and in batches of the configured size", async () => {
  const { embed, batches } = fakeEmbed({ x: X });
  const matcher = createMatcher({ embed, batchSize: 2 });
  const videos = ["a", "b", "a", "c", "d", "e"].map((id) => video(id));
  await matcher.score(["x"], videos);
  assert.deepEqual(batches, [["x"], ["a", "b"], ["c", "d"], ["e"]]);
});

test("forgets the least recently used videos beyond the cache size", async () => {
  const { embed, batches } = fakeEmbed({ x: X, a: X });
  const matcher = createMatcher({ embed, cacheSize: 2 });
  await matcher.score(["x"], [video("a"), video("b")]);
  await matcher.score(["x"], [video("a")]);
  await matcher.score(["x"], [video("c")]);
  const scores = await matcher.score(["x"], [video("a"), video("b")]);
  assert.deepEqual(plain(scores), { a: 1, b: 0 });
  assert.deepEqual(batches.slice(1), [["a", "b"], ["c"], ["b"]]);
});

test("answers a request with more videos than the cache holds", async () => {
  const { embed } = fakeEmbed({ x: X, a: X, c: X });
  const matcher = createMatcher({ embed, cacheSize: 1 });
  const scores = await matcher.score(["x"], [video("a"), video("b"), video("c")]);
  assert.deepEqual(plain(scores), { a: 1, b: 0, c: 1 });
});
