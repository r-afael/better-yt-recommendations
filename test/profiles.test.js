import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { EVENING, WORK, fakeChrome, manyProfiles, runScripts } from "./helpers.js";

function loadProfiles() {
  const context = vm.createContext({ chrome: fakeChrome(), TextEncoder });
  runScripts(context, ["src/settings.js", "src/profiles.js"]);
  return context.BetterYT.profiles;
}

const profiles = loadProfiles();
const profile = (name, topics = "", avoidTopics = "") => ({ name, topics, avoidTopics });
const LATE_NIGHT = "Late night";
const plain = (value) => structuredClone(value);

test("creates a profile unless its name is empty, taken (ignoring case) or there are already 8", () => {
  const sliders = { threshold: 0.3, avoidThreshold: 0.2 };
  const created = profiles.create([WORK], { ...profile("  Late   night ", "jazz"), ...sliders, hideShorts: true });
  assert.deepEqual(plain(created), { list: [WORK, { ...profile(LATE_NIGHT, "jazz"), ...sliders }], name: LATE_NIGHT });

  assert.deepEqual(plain(profiles.create([WORK], profile("   "))), { error: "missing" });
  assert.deepEqual(plain(profiles.create([WORK], profile(" WORK"))), { error: "taken" });
  assert.deepEqual(plain(profiles.create(manyProfiles(8), profile("Ninth"))), { error: "full" });
});

test("renames a profile unless the new name is taken", () => {
  assert.deepEqual(plain(profiles.rename([WORK, EVENING], "evening", "Night")), {
    list: [WORK, { ...EVENING, name: "Night" }],
    name: "Night",
  });
  assert.deepEqual(plain(profiles.rename([WORK, EVENING], "Work", "evening")), { error: "taken" });
  assert.equal(plain(profiles.rename([WORK], "Work", "WORK")).list[0].name, "WORK", "changing only the case is a rename");
});

test("switching to a profile gives its topics and sliders, or only the topics it has, and No profile gives none", () => {
  const values = { profiles: [WORK, EVENING], activeProfile: "", topics: "anything", avoidTopics: "" };
  assert.deepEqual(plain(profiles.changesFor("activeProfile", "evening", values)), {
    activeProfile: "Evening",
    topics: "cooking, chess",
    avoidTopics: "",
    threshold: 0.3,
    avoidThreshold: 0.2,
  });
  assert.deepEqual(plain(profiles.changesFor("activeProfile", "Work", values)), {
    activeProfile: "Work",
    topics: "programming",
    avoidTopics: "gaming",
  });
  assert.deepEqual(plain(profiles.changesFor("activeProfile", "", { ...values, activeProfile: "Work" })), { activeProfile: "" });
});

test("editing topics or moving a slider updates the selected profile, and only that one", () => {
  const values = { profiles: [WORK, EVENING], activeProfile: "evening" };
  assert.deepEqual(plain(profiles.changesFor("avoidTopics", "gossip", values)), {
    avoidTopics: "gossip",
    profiles: [WORK, { ...EVENING, avoidTopics: "gossip" }],
  });
  assert.deepEqual(plain(profiles.changesFor("threshold", 0.33, { ...values, activeProfile: "Work" })), {
    threshold: 0.33,
    profiles: [{ ...WORK, threshold: 0.33 }, EVENING],
  });
  assert.deepEqual(plain(profiles.changesFor("topics", "chess", { ...values, activeProfile: "" })), { topics: "chess" });
  assert.deepEqual(plain(profiles.changesFor("hideShorts", true, values)), { hideShorts: true });
});

test("an edit started under another profile updates only the live setting", () => {
  const values = { profiles: [WORK, EVENING], activeProfile: "Evening" };
  for (const [name, value] of [["topics", "rust"], ["avoidThreshold", 0.35]]) {
    assert.deepEqual(plain(profiles.changesFor(name, value, values, "Work")), { [name]: value }, name);
  }
});

test("removing a profile keeps the others in order", () => {
  const late = profile(LATE_NIGHT);
  assert.deepEqual(plain(profiles.remove([WORK, EVENING, late], " EVENING")), [WORK, late]);
});
