import { readFileSync, writeFileSync } from "node:fs";

let content = readFileSync("test/options.test.js", "utf8");

const target = `test("Undo applies the restored profile's topics and sliders in the same save that selects it", async (t) => {
  const { chrome, select, button, pick, field, avoidField, slider, avoidSlider } = await setupProfiles(t, {
    profiles: [WORK, EVENING],
    activeProfile: "Work",
    ...WORK,
  });
  button("delete").click();
  await flush();

  pick("Evening");
  await flush();
  assert.equal(chrome.data.activeProfile, "Evening");
  assert.equal(field.value, EVENING.topics);
  assert.equal(slider.value, String(EVENING.threshold));

  button("undo").click();
  await flush();
  assert.equal(chrome.data.activeProfile, "Work");
  assert.equal(select.value, "Work");
  assert.equal(chrome.data.topics, WORK.topics);
  assert.equal(chrome.data.avoidTopics, WORK.avoidTopics);
  assert.equal(chrome.data.threshold, WORK.threshold);
  assert.equal(chrome.data.avoidThreshold, WORK.avoidThreshold);
  assert.equal(field.value, WORK.topics);
  assert.equal(avoidField.value, WORK.avoidTopics);
  assert.equal(slider.value, String(WORK.threshold));
  assert.equal(avoidSlider.value, String(WORK.avoidThreshold));
});`;

const replacement = `test("Undo applies the restored profile's topics and sliders in the same save that selects it", async (t) => {
  const work = { ...WORK, threshold: 0.25, avoidThreshold: 0.24 };
  const { chrome, select, button, pick, field, avoidField, slider, avoidSlider } = await setupProfiles(t, {
    profiles: [work, EVENING],
    activeProfile: "Work",
    ...work,
  });
  button("delete").click();
  await flush();

  pick("Evening");
  await flush();
  assert.equal(chrome.data.activeProfile, "Evening");
  assert.equal(field.value, EVENING.topics);
  assert.equal(slider.value, String(EVENING.threshold));

  button("undo").click();
  await flush();
  assert.equal(chrome.data.activeProfile, "Work");
  assert.equal(select.value, "Work");
  assert.equal(chrome.data.topics, work.topics);
  assert.equal(chrome.data.avoidTopics, work.avoidTopics);
  assert.equal(chrome.data.threshold, work.threshold);
  assert.equal(chrome.data.avoidThreshold, work.avoidThreshold);
  assert.equal(field.value, work.topics);
  assert.equal(avoidField.value, work.avoidTopics);
  assert.equal(slider.value, String(work.threshold));
  assert.equal(avoidSlider.value, String(work.avoidThreshold));
});`;

if (!content.includes(target)) {
  console.error("target not found in test/options.test.js");
  process.exit(1);
}

content = content.replace(target, replacement);
writeFileSync("test/options.test.js", content, "utf8");
console.log("Updated test/options.test.js");
