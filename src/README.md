# Development

No build step. Reload the extension at `chrome://extensions` after editing, then
refresh YouTube.

- `src/content.js` selects the tab on YouTube.
- `src/labels.js` lists the tab's name in each language.
- `src/settings.js` stores the settings for the content scripts, the extension's pages
  and the background.
- `src/shorts.js` hides Shorts and opens Shorts links as regular videos.
  `src/shorts.css` lists what to hide. Both load as soon as a YouTube page starts, so
  Shorts never flash on screen; the other content scripts load once the page is ready.
- `src/shorts-redirect.js` turns the Shorts redirect rule in
  `src/rules/shorts-redirect.json` on and off with Hide Shorts.
- `src/scheduler.js` debounces the content scripts' work after page changes.
- `src/popup.html`, `src/popup.css` and `src/popup.js` are the settings popup.
- `src/options.html`, `src/options.css` and `src/options.js` are the options page.
  `src/options.css` builds on `src/popup.css`.
- `src/ui.js` holds the code the settings popup and the options page share: starting the
  page, translation, saving, the switches for Home and Shorts, the profile switch, and the
  model status.
- `_locales/` has the translations of the popup, the options page and the messages the
  extension shows on YouTube.
- `src/protocol.js` names the messages the extension's parts send each other.
- `src/topics.js` turns the topics field into a list of topics.
- `src/verdict.js` decides from a video's scores whether it is hidden, and whether the
  filter needs the model.
- `src/channels.js` reads the channel lists and says whether a channel is always shown
  or always hidden.
- `src/profiles.js` saves, renames and switches topic profiles.
- `src/cards.js` finds the video cards on the watch page, Home, Subscriptions and
  search results, reads them, and hides or shows them.
- `src/hidden-row.js` draws the row that counts the hidden videos and shows them.
  `src/badge.js` shows that count on the toolbar icon.
- `src/channel-menu.js` remembers the video you right-clicked and adds its channel to a
  list. `src/menus.js` adds the right-click menu entries. `src/toast.js` shows short
  messages on YouTube.
- `src/shortcuts.js` handles the keyboard shortcuts.
- `src/filter.js` decides which videos to check, asks for verdicts and applies them.
  `src/filter.css` hides the filtered videos, or dims them while they're shown, and
  styles the row and the messages.
- `src/background.js` receives the extension's messages and events in the background
  and hands each one to the module that handles it.
- `src/model-host.js` opens the hidden page that runs the model when a page needs it or
  asks to load it early, passes messages to it, and closes it to free memory.
- `src/offscreen.html` and `src/offscreen.js` are that hidden page. They load the
  model when needed and close it after 5 idle minutes.
- `src/matcher.js` compares each video's title and channel with your topics.
- `src/model.js` loads the model with Transformers.js.
- `src/vendor/transformers/` holds Transformers.js and ONNX Runtime Web, copied from
  `node_modules` by `scripts/vendor.js`. Don't edit these files.
- `src/icons/` holds the extension's icons.
- `test/` holds the tests, and `test/helpers.js` the fake Chrome APIs and page setup they
  share. `test/fixtures/watch-sidebar.html`, `test/fixtures/home-grid.html` and
  `test/fixtures/search-results.html` hold markup for the lists the filter reads
  (`home-grid.html` is written by hand until a signed-in capture replaces it);
  [CONTRIBUTING.md](../CONTRIBUTING.md) says where each comes from and when to replace it.

To run the checks, install Node.js 24 or later and pnpm 11, then run:

```sh
pnpm install
pnpm check
```

`pnpm check` checks every script's syntax, runs ESLint (with the sonarjs rules and a
cognitive complexity of at most 10 per function), then runs the tests and fails if
coverage drops below 80%. You can also run the pieces on their own:

- `pnpm lint` runs ESLint.
- `pnpm test` runs the tests.
- `pnpm coverage` runs the tests with the coverage report.

After changing the `@huggingface/transformers` version in `package.json`, run
`pnpm install`, then `pnpm vendor` to copy the new files into `src/vendor/transformers/`.
