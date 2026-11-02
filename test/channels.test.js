import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { channelNames as names, fakeChrome, runScripts } from "./helpers.js";

function loadChannels() {
  const context = vm.createContext({ chrome: fakeChrome(), TextEncoder });
  runScripts(context, ["src/settings.js", "src/protocol.js", "src/channels.js"]);
  return context.BetterYT.channels;
}

const channels = loadChannels();
const lists = (allowedChannels, blockedChannels) => ({ allowedChannels, blockedChannels });

test("reads one channel per line, ignoring empty lines, spacing and case for duplicates", () => {
  const typed = "Fireship\n\n   freeCodeCamp.org  \nFIRESHIP\r\nTraversy   Media\n \n";
  assert.deepEqual(structuredClone(channels.parse(typed)), ["Fireship", "freeCodeCamp.org", "Traversy Media"]);
  assert.equal(channels.countNames(typed), 3);
});

test("keeps at most 50 channels of 100 characters", () => {
  const long = "x".repeat(120);
  const typed = [long, ...names(60)].join("\n");
  const parsed = channels.parse(typed);
  assert.equal(parsed.length, 50);
  assert.equal(parsed[0], "x".repeat(100));
  assert.equal(channels.countNames(typed), 61, "the page still counts every name typed");
  assert.deepEqual(
    structuredClone(channels.parse(`${"a".repeat(99)}🌴`)),
    ["a".repeat(99)],
    "an emoji the cut would split goes whole, leaving no half of it",
  );
});

test("adding a channel to one list removes it from the other", () => {
  const values = lists(["Fireship", "Traversy Media"], ["MrBeast"]);
  assert.deepEqual(structuredClone(channels.add(values, "blockedChannels", "  fireship ")), lists(["Traversy Media"], ["MrBeast", "fireship"]));
  assert.deepEqual(structuredClone(channels.add(values, "allowedChannels", "MrBeast")), lists(["Fireship", "Traversy Media", "MrBeast"], []));
});

test("adding a new channel to a full list does nothing", () => {
  assert.equal(channels.add(lists([], names(50)), "blockedChannels", "MrBeast"), null);
});

test("adding a channel a full list already holds keeps the list and still confirms", () => {
  const full = names(50);
  const changes = channels.add(lists(["channel 7"], full), "blockedChannels", "Channel 7");
  assert.notEqual(changes, null);
  assert.deepEqual(structuredClone(changes), lists([], full));
});

test("a typed list removes its names from the other list", () => {
  const values = lists(["Fireship", "Traversy Media"], ["MrBeast"]);
  const typed = channels.parse("MrBeast\nTRAVERSY MEDIA");
  assert.deepEqual(structuredClone(channels.reconcile(values, "blockedChannels", typed)), lists(["Fireship"], ["MrBeast", "TRAVERSY MEDIA"]));
});

test("an allowed channel is never hidden, even if it's also blocked", () => {
  const index = channels.createIndex(lists(["Fireship"], ["Fireship", "MrBeast"]));
  assert.equal(index.lookup("Fireship"), "allow");
  assert.equal(index.lookup("MrBeast"), "block");
  assert.equal(index.lookup("Traversy Media"), null);
});

test("matches channel names ignoring case and spacing", () => {
  // The full-width letters a name can be typed with read as the ones YouTube shows.
  const index = channels.createIndex(lists([], ["  free code   camp ", "ＭｒＢｅａｓｔ"]));
  assert.equal(index.lookup("Free Code Camp"), "block");
  assert.equal(index.lookup("mrbeast"), "block");
});

test("a blank name synced from another computer hides no card whose channel can't be read", () => {
  const index = channels.createIndex(lists([], ["", " "]));
  assert.equal(index.lookup(""), null);
});
