// Draws the row at the top of a filtered list that counts its hidden videos, with a button that
// shows them or hides them again.
(() => {
  "use strict";

  const message = (key, substitutions) => chrome.i18n.getMessage(key, substitutions);

  // Both helpers write a value only when it changes, so a rescan with the same count queues no
  // mutation record: content.js watches `hidden` across the whole page in enforcement mode.
  function assign(element, property, value) {
    if (element[property] !== value) element[property] = value;
  }

  function setAttributeIfChanged(element, name, value) {
    if (element.getAttribute(name) !== value) element.setAttribute(name, value);
  }

  // The count uses the translation's digits, as the options page does.
  function countText(count) {
    if (count === 1) return message("hiddenRowOne");
    return message("hiddenRowMany", count.toLocaleString(message("lang")));
  }

  function elementWithClass(tag, className) {
    const element = document.createElement(tag);
    element.className = className;
    return element;
  }

  // Builds the row once and returns { mount, update, unmount }; clicking its button calls onToggle().
  // The row speaks the extension's language, which can differ from YouTube's, and its text and
  // button inherit that language and direction.
  function createHiddenRow({ onToggle }) {
    const row = elementWithClass("div", "better-yt-hidden-row");
    row.lang = message("lang");
    row.dir = message("@@bidi_dir");
    const label = elementWithClass("span", "better-yt-hidden-row__text");
    const toggle = elementWithClass("button", "better-yt-hidden-row__toggle");
    row.hidden = true;
    label.id = "better-yt-hidden-row-text";
    toggle.type = "button";
    toggle.setAttribute("aria-describedby", label.id); // "Show them" is read with the count.
    toggle.setAttribute("aria-expanded", "false");
    toggle.addEventListener("click", () => onToggle());
    row.append(label, toggle);

    // The row sits right before the list, outside the subtree the filter observes, so updating
    // it never triggers a scan. Mounting again puts it back when YouTube re-renders or moves the list.
    function mount(container) {
      if (row.nextElementSibling !== container) container.before(row);
    }

    function update(count, revealed) {
      assign(row, "hidden", count === 0);
      assign(label, "textContent", countText(count));
      assign(toggle, "textContent", message(revealed ? "hideHidden" : "showHidden"));
      setAttributeIfChanged(toggle, "aria-expanded", String(revealed));
    }

    return Object.freeze({ mount, update, unmount: () => row.remove() });
  }

  globalThis.BetterYT ??= {};
  globalThis.BetterYT.createHiddenRow = createHiddenRow;
})();
