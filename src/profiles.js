// Topic profiles: named copies of the topics to see and to avoid, which the popup and the
// options page switch between. Pure logic, shared by both pages. The filter never reads a
// profile: switching to one copies its topics into the ones the filter reads.
(() => {
  "use strict";

  const { settings } = globalThis.BetterYT;
  const { LIMITS } = settings;

  // The settings a profile keeps a copy of.
  const TOPIC_SETTINGS = Object.freeze(["topics", "avoidTopics"]);

  const { sameName } = settings;
  const clean = (name) => settings.clip(name, LIMITS.MAX_PROFILE_NAME_LENGTH);
  const find = (list, name) => list.find((profile) => sameName(profile.name, name)) ?? null;

  // The selected profile, or null when none is.
  const active = (values) => find(values.profiles, values.activeProfile);

  // The list with a new profile at its end, and the name it was saved under.
  function create(list, { name, topics, avoidTopics }) {
    const cleaned = clean(name);
    if (cleaned === "") return { error: "missing" };
    if (find(list, cleaned)) return { error: "taken" };
    if (list.length >= LIMITS.MAX_PROFILES) return { error: "full" };
    return { list: [...list, { name: cleaned, topics, avoidTopics }], name: cleaned };
  }

  // The list with one profile renamed, and its new name. Changing only the case of a name is a rename too.
  function rename(list, from, to) {
    const cleaned = clean(to);
    const current = find(list, from);
    if (cleaned === "" || current === null) return { error: "missing" };
    const holder = find(list, cleaned);
    if (holder !== null && holder !== current) return { error: "taken" };
    return { list: list.map((profile) => (profile === current ? { ...profile, name: cleaned } : profile)), name: cleaned };
  }

  const remove = (list, name) => list.filter((profile) => !sameName(profile.name, name));

  // Switching to a profile brings its topics along, in the same write. No profile keeps the topics as they are.
  function switchTo(list, name) {
    const profile = find(list, name);
    if (profile === null) return { activeProfile: "" };
    return { activeProfile: profile.name, topics: profile.topics, avoidTopics: profile.avoidTopics };
  }

  // What saving one control writes. Topics edited while a profile is selected update that
  // profile too, but only when it is still the one selected when the edit started
  // (editedProfile): a switch that arrives while the user types never gets the typed topics.
  function changesFor(name, value, values, editedProfile = values.activeProfile) {
    if (name === "activeProfile") return switchTo(values.profiles, value);
    const profile = TOPIC_SETTINGS.includes(name) ? active(values) : null;
    if (profile === null || !sameName(profile.name, editedProfile)) return { [name]: value };
    const profiles = values.profiles.map((entry) => (entry === profile ? { ...entry, [name]: value } : entry));
    return { [name]: value, profiles };
  }

  globalThis.BetterYT.profiles = Object.freeze({ active, create, rename, remove, changesFor });
})();
