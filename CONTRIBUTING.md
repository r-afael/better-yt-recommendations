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
- Add new popup text to every `_locales/*/messages.json`.
- Update the README when a setting or behavior changes.

Pull requests are squash-merged, and the title becomes the commit message on `main`.
Start it with `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`, `ci:` or
`perf:`, like `fix: keep videos visible when the model fails`. A check enforces this.

## Common changes

**YouTube changed its layout.** The selectors live at the top of `src/content.js`
(the custom feed tab), `src/sidebar.js` (the recommended videos) and `src/shorts.css`
(Shorts). Update them, and update the matching markup in the tests.
`test/fixtures/watch-sidebar.html` is a copy of real YouTube markup; replace it with a
fresh copy when the sidebar changes.

**A new language.** Add `_locales/<code>/messages.json` with every key from
`_locales/en/messages.json`. If YouTube names the custom feed tab differently in that
language, add the name to `src/labels.js`.

**A new Transformers.js version.** Change the version in `package.json`, run
`pnpm install`, then `pnpm vendor` to copy the new files into `src/vendor/transformers/`.
Never edit those files by hand.

## Releases

Maintainers release by updating the version in `manifest.json` and `package.json`,
merging that change, then pushing a matching tag such as `v1.3.0`. A workflow runs
the checks, zips the extension and publishes the GitHub Release.
