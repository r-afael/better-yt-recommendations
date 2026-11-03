# Contributing

Thanks for helping make YouTube less distracting. Bug reports, fixes for YouTube
layout changes, translations and ideas are all welcome.

By taking part, you agree to follow the [code of conduct](CODE_OF_CONDUCT.md).
Report security problems privately, as described in [SECURITY.md](SECURITY.md).

## Set up

Install Node.js 24 or later and pnpm 11, then run:

```sh
pnpm install
pnpm check
```

There's no build step. To try your changes, open `chrome://extensions`, turn on
**Developer mode**, click **Load unpacked** and choose this folder. After editing,
click the extension's reload button, then refresh YouTube.

## Before you open a pull request

`pnpm check` must pass. It checks every script's syntax, runs ESLint (with the
sonarjs rules and a cognitive complexity of at most 10 per function), and runs the
tests, which must cover at least 80% of the code.

- Test what the extension does, not how it does it. Tests that only raise coverage
  aren't needed.
- Keep functions small and follow the style of the code around them.
- Add new text for the popup, the options page or YouTube pages to every
  `_locales/*/messages.json`.
- Give headings and labels their English text in the HTML as well as their
  `data-i18n` key. The page replaces it with the translation, a test keeps it equal
  to the English message, and Sonar's HTML checks, which ESLint can't run, need the
  markup to carry text. The Home and Shorts switches are the exception: they are
  listed in `FEED_SWITCHES` in `src/ui.js`, which gives each row its `data-i18n` keys.
- Update the README when a setting or behavior changes.

Pull requests are squash-merged, and the title becomes the commit message on `main`.
Start it with `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`, `ci:` or
`perf:`, like `fix: keep videos visible when the model fails`. A check enforces this.

## Common changes

**YouTube changed its layout.** The selectors live at the top of `src/content.js`
(the custom feed tab), `src/cards.js` (the video cards of every filtered list) and
`src/shorts.css` (Shorts), and `CARD_LINKS` in `src/menus.js` lists the video and channel
links that get the right-click entries. Update them, and update the matching markup in the
tests.
`test/fixtures/watch-sidebar.html`, `test/fixtures/home-grid.html` and
`test/fixtures/search-results.html` are YouTube's markup for each page; replace the one for a
page when that page changes. Capture Home and search signed in with a throwaway account that
has some watch history, then scrub anything personal before committing (see the list in the
fixture's first comment). The Subscriptions tests reuse the Home fixture with its page subtype
swapped, because the two grids share the same markup. Until signed-in captures replace them,
`home-grid.html` is written by hand and `search-results.html` was captured signed out; each
says so in its first comment.

If Shorts move to another address, update the redirect rule's `regexFilter` in
`src/rules/shorts-redirect.json`, `SHORT_PATH` in `src/shorts.js` and the `href` selectors in
`src/shorts.css` together, along with the addresses in `test/shorts-redirect.test.js`,
`test/shorts.test.js` and `test/cards.test.js`.

**A new language.** Add `_locales/<code>/messages.json` with every key from
`_locales/en/messages.json`. If YouTube names the custom feed tab differently in that
language, add the name to `src/labels.js`.
Found a wrong or awkward translation instead? Open a **Translation problem** issue.

**A new Transformers.js version.** Change the version in `package.json`, run
`pnpm install`, then `pnpm vendor` to copy the new files into `src/vendor/transformers/`.
Never edit those files by hand.

## Releases

Maintainers release by updating the version in `manifest.json` and `package.json`,
merging that change, then pushing a matching tag such as `v1.3.0`. A workflow runs
the checks, zips the extension and publishes the GitHub Release.
