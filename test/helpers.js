import { readdirSync, readFileSync } from "node:fs";
import vm from "node:vm";
import FakeTimers from "@sinonjs/fake-timers";
import { JSDOM } from "jsdom";

const root = new URL("../", import.meta.url);

export const read = (path) => readFileSync(new URL(path, root), "utf8");
export const readJson = (path) => JSON.parse(read(path));

// A video's similarities to the closest wanted topic and topic to avoid, as the offscreen
// document answers them, null for an empty list.
export const score = (want, avoid = null) => ({ want, avoid });

// Every translation the extension ships, such as "en" and "zh_CN".
export const locales = readdirSync(new URL("_locales/", root));

// Where the background reports the model's status in chrome.storage.session, as the pages read it.
export const STATUS_KEY = "modelStatus";

// The message type a page sends the background to load the model right away.
export const PRELOAD = "better-yt:preload";

// The message type the content script and the options page send the background to score videos.
export const MATCH = "better-yt:match";

// Lets pending promises, storage events and mutation observers run.
export const flush = () => new Promise((resolve) => setImmediate(resolve));

// Runs the extension's own scripts in a vm context, such as dom.getInternalVMContext().
// Naming each script after its file lets coverage report it.
export function runScripts(context, paths) {
  for (const path of paths) {
    const url = new URL(path, root);
    new vm.Script(readFileSync(url, "utf8"), { filename: url.href }).runInContext(context);
  }
}

// Runs the extension's own script in a blank page, the way the other tests load scripts.
export function loadLabels() {
  const dom = new JSDOM("", { runScripts: "outside-only" });
  runScripts(dom.getInternalVMContext(), ["src/labels.js"]);
  const labels = dom.window.BetterYT.CUSTOM_FEED_LABELS;
  dom.window.close();
  return labels;
}

// A chrome.* event that tests can fire with dispatch().
export function fakeEvent() {
  const listeners = [];
  return {
    listeners,
    addListener(listener) {
      listeners.push(listener);
    },
    removeListener(listener) {
      const index = listeners.indexOf(listener);
      if (index !== -1) listeners.splice(index, 1);
    },
    hasListener(listener) {
      return listeners.includes(listener);
    },
    dispatch(...args) {
      return listeners.map((listener) => listener(...args));
    },
  };
}

function pick(data, keys) {
  return Object.fromEntries(keys.filter((key) => key in data).map((key) => [key, data[key]]));
}

// A chrome.storage area backed by memory. Reports changes to onChanged after set() resolves, like Chrome.
function fakeStorageArea(name, stored, onChanged) {
  const data = { ...stored };
  const report = (diff) => queueMicrotask(() => onChanged.dispatch(diff, name));
  return {
    data,
    async get(keys) {
      if (keys === null || keys === undefined) return { ...data };
      if (typeof keys === "string" || Array.isArray(keys)) return pick(data, [keys].flat());
      return { ...keys, ...pick(data, Object.keys(keys)) };
    },
    async set(changes) {
      const diff = {};
      for (const [key, newValue] of Object.entries(changes)) {
        diff[key] = { oldValue: data[key], newValue };
        data[key] = newValue;
      }
      report(diff);
    },
    async remove(keys) {
      const diff = {};
      for (const key of [keys].flat()) {
        if (!(key in data)) continue;
        diff[key] = { oldValue: data[key] };
        delete data[key];
      }
      report(diff);
    },
  };
}

// Fills in a translated message, including $NAME$ placeholders such as { content: "$1" }.
function translate(entry, substitutions) {
  if (!entry) return "";
  const values = [substitutions ?? []].flat().map(String);
  return entry.message.replaceAll(/\$(\w+)\$/g, (_, name) => {
    const content = entry.placeholders?.[name.toLowerCase()]?.content ?? "";
    return content.replaceAll(/\$(\d)/g, (__, index) => values[index - 1] ?? "");
  });
}

// The parts of the extension APIs the scripts use, backed by memory.
// Tests replace runtime.sendMessage and other functions to script their own answers.
export function fakeChrome({ stored = {}, session = {}, locale = "en" } = {}) {
  const messages = readJson(`_locales/${locale}/messages.json`);
  const onChanged = fakeEvent();
  const sync = fakeStorageArea("sync", stored, onChanged);

  const chrome = {
    data: sync.data,
    openedOptions: 0,
    storage: {
      sync,
      session: fakeStorageArea("session", session, onChanged),
      onChanged,
    },
    runtime: {
      onMessage: fakeEvent(),
      async sendMessage() {
        return undefined;
      },
      getURL: (path) => `chrome-extension://better-yt/${path}`,
      async openOptionsPage() {
        chrome.openedOptions += 1;
      },
    },
    i18n: {
      getMessage(key, substitutions) {
        if (key === "@@bidi_dir") return locale === "ar" ? "rtl" : "ltr";
        return translate(messages[key], substitutions);
      },
    },
  };
  return chrome;
}

// Answers each message a page sends the background with answer(message), and returns the
// messages' types in the order they were sent.
export function recordMessages(chrome, answer = async () => ({ ok: true })) {
  const sent = [];
  chrome.runtime.sendMessage = (message) => {
    sent.push(message.type);
    return answer(message);
  };
  return sent;
}

// Keeps each message that holds(message) waiting until the test answers it with the recorded
// resolve or reject, and answers the others with { ok: true }. Returns the held requests in the
// order they were sent.
export function holdMessages(chrome, holds = () => true) {
  const requests = [];
  chrome.runtime.sendMessage = (message) => {
    if (!holds(message)) return Promise.resolve({ ok: true });
    return new Promise((resolve, reject) => requests.push({ message: structuredClone(message), resolve, reject }));
  };
  return requests;
}

// Opens one of the extension's pages, such as src/popup.html, and runs its own scripts in order
// with a fake chrome and fake timers.
export async function openPage(t, path, options) {
  const dom = new JSDOM(read(path), { runScripts: "outside-only" });
  const { window } = dom;
  const clock = FakeTimers.withGlobal(window).install({ toFake: ["setTimeout", "clearTimeout"] });
  const chrome = fakeChrome(options);
  window.chrome = chrome;
  const directory = path.slice(0, path.lastIndexOf("/") + 1);
  const scripts = [...window.document.querySelectorAll("script[src]")].map((script) => directory + script.getAttribute("src"));
  runScripts(dom.getInternalVMContext(), scripts);
  await flush();
  t.after(() => {
    clock.uninstall();
    window.close();
  });
  return { window, document: window.document, chrome, clock };
}

// The translation attributes of a page, each with the part of its element it fills.
const I18N_TARGETS = [
  ["data-i18n", (element) => element.textContent],
  ["data-i18n-placeholder", (element) => element.placeholder],
  ["data-i18n-aria-label", (element) => element.getAttribute("aria-label")],
  ["data-i18n-title", (element) => element.title],
];

// Names the messages that left their part of the page empty, such as "data-i18n=topics".
export function untranslated(document) {
  return I18N_TARGETS.flatMap(([attribute, text]) =>
    [...document.querySelectorAll(`[${attribute}]`)]
      .filter((element) => !text(element)?.trim())
      .map((element) => `${attribute}=${element.getAttribute(attribute)}`),
  );
}
