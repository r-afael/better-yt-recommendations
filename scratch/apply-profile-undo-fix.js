import { readFileSync, writeFileSync } from "node:fs";

// 1. Update src/profiles.js
let profilesContent = readFileSync("src/profiles.js", "utf8");
profilesContent = profilesContent.replace(
  `  // The list with one profile put back where it was, and the name it was saved under.
  function restore(list, profile, index) {
    if (find(list, profile.name)) return { error: "taken" };
    if (list.length >= LIMITS.MAX_PROFILES) return { error: "full" };
    const next = [...list];
    next.splice(Math.max(0, Math.min(index ?? next.length, next.length)), 0, profile);
    return { list: next, name: profile.name };
  }`,
  `  // The list with one profile put back where it was, the name it was saved under, and the settings it switches to.
  function restore(list, profile, index) {
    if (find(list, profile.name)) return { error: "taken" };
    if (list.length >= LIMITS.MAX_PROFILES) return { error: "full" };
    const next = [...list];
    next.splice(Math.max(0, Math.min(index ?? next.length, next.length)), 0, profile);
    return { list: next, name: profile.name, ...profileCopy(profile) };
  }`
);
writeFileSync("src/profiles.js", profilesContent, "utf8");
console.log("Updated src/profiles.js");

// 2. Update src/options.js
let optionsContent = readFileSync("src/options.js", "utf8");
const isCrlf = optionsContent.includes("\r\n");
const nl = isCrlf ? "\r\n" : "\n";

optionsContent = optionsContent.replace(
  `function saveProfiles({ error, list, name })`,
  `function saveProfiles({ error, list, name, ...rest })`
);
optionsContent = optionsContent.replace(
  `page.save({ profiles: list, activeProfile: name })`,
  `page.save({ profiles: list, activeProfile: name, ...rest })`
);
optionsContent = optionsContent.replace(
  `  undoProfile.addEventListener("click", () => {${nl}    if (!deletedProfile) return;${nl}    const profile = deletedProfile;`,
  `  undoProfile.addEventListener("click", () => {${nl}    if (!deletedProfile) return;${nl}    page.saver.flush();${nl}    const profile = deletedProfile;`
);

writeFileSync("src/options.js", optionsContent, "utf8");
console.log("Updated src/options.js");