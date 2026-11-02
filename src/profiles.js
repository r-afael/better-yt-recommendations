// Topic profiles: named copies of the topics to see and to avoid and of both match sliders,
// which the popup and the options page switch between. Pure logic, shared by both pages. The
// filter never reads a profile: switching to one copies its settings into the ones the filter
// reads.
(() => {
  "use strict";

  const { settings } = globalThis.BetterYT;
  const { LIMITS, PROFILE_SETTINGS, profileCopy, sameName } = settings;
  const clean = (name) => settings.clip(name, LIMITS.MAX_PROFILE_NAME_LENGTH);
  const find = (list, name) => list.find((profile) => sameName(profile.name, name)) ?? null;

  // The selected profile, or null when none is.
  const active = (values) => find(values.profiles, values.activeProfile);

  // The list with a new profile at its end, and the name it was saved under.
  // values holds the settings the profile keeps a copy of.
  function create(list, { name, ...values }) {
    const cleaned = clean(name);
    if (cleaned === "") return { error: "missing" };
    if (find(list, cleaned)) return { error: "taken" };
    if (list.length >= LIMITS.MAX_PROFILES) return { error: "full" };
    return { list: [...list, { name: cleaned, ...profileCopy(values) }], name: cleaned };
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

  // Switching to a profile brings the settings it holds along, in the same write: a profile saved
  // before profiles kept the sliders brings only its topics. No profile keeps them as they are.
  function switchTo(list, name) {
    const profile = find(list, name);
    if (profile === null) return { activeProfile: "" };
    return { activeProfile: profile.name, ...profileCopy(profile) };
  }

  // What saving one control writes. Topics or a slider changed while a profile is selected
  // update that profile too, but only when it is still the one selected when the edit started
  // (editedProfile): a switch that arrives during an edit never gets the edited value. A slider
  // moved while a profile without sliders is selected adds its value to that profile.
  function changesFor(name, value, values, editedProfile = values.activeProfile) {
    if (name === "activeProfile") return switchTo(values.profiles, value);
    const profile = PROFILE_SETTINGS.includes(name) ? active(values) : null;
    if (profile === null || !sameName(profile.name, editedProfile)) return { [name]: value };
    const profiles = values.profiles.map((entry) => (entry === profile ? { ...entry, [name]: value } : entry));
    return { [name]: value, profiles };
  }

  globalThis.BetterYT.profiles = Object.freeze({ active, create, rename, remove, changesFor });
})();
