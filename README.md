# Better YT Recommendations

**You opened YouTube to learn one thing. An hour later you're deep in cat videos and
travel vlogs.**

YouTube's recommendations are built to keep you watching, not to keep you focused.
Better YT Recommendations puts you back in control of what you see.

**Start every visit on your terms.** Set up YouTube's **Your custom feed** with the
topics you care about. The extension opens it every time you land on Home, even when
you click the YouTube logo. If you need more willpower, turn on enforcement mode and
Home stays on your feed.

**Keep the sidebar on topic.** Watching a coding tutorial? Tell the extension you
want "programming, JavaScript, web development". It hides the gaming clips,
talk-show segments and get-rich-quick videos next to it, so only recommendations
worth your time remain. It can filter Home, your Subscriptions and search results too.

**Private by design.** A small, lightweight embedding model runs right on your
computer. The AI doesn't chat or write: it turns each video's title and
your topics into numbers that capture their meaning, then keeps the videos whose
meaning is close to your topics. The extension never sends what you watch anywhere.

*The Home feature needs **Your custom feed** to be available on your YouTube account
on desktop.*

## Settings

Click the extension's icon in the Chrome toolbar for the main switches. Click **All
settings** (or the gear) to open the options page in a tab, with everything else. Open
YouTube tabs pick up changes right away.

### In the popup

- **Open custom feed on Home** (on by default): switches to Your custom feed when
  Home opens. Turn it off to stay on whichever Home tab you pick. The topic filter
  has its own toggle, below.
- **Enforcement mode** (off by default): keeps you on Your custom feed. Clicking
  another Home tab, like Podcasts or All, does nothing, and if YouTube switches tabs
  on its own, the extension switches back.
- **Hide Shorts** (off by default): hides the Shorts entry in the side menu, Shorts
  shelves on Home, Subscriptions and channel pages, and Shorts in search results and
  the sidebar. A link to a Short opens it as a regular video, without the endless feed of
  Shorts after it. Opening a Short's address directly (typed, bookmarked or reloaded) loads the
  regular player right away.
- **Filter recommendations** (on by default): hides videos that don't match your
  topics on the pages you pick under Where to filter, that are closer to a topic to
  avoid, or that come from a channel you always hide. It does nothing until you type
  some topics to see or to avoid, or a channel to hide. Turn it off to show every
  video again, including blocked channels, and free the model's memory.
- A summary of your topics to see and to avoid; click it to change them.

### On the options page

The **Filter recommendations** switch is on both pages.

- **Topics you want to see**: the topics to keep, separated by commas. The field is
  disabled while the filter is off.
- **Topics to avoid**: topics whose videos you don't want, separated by commas. A
  video is hidden when it's closer to one of them than to the closest topic you want.
  With only topics to avoid, a video is hidden when it's closer to one of them than
  the filter sensitivity.
- **Filter sensitivity** (0.25 by default): how close to your topics a video must be
  to stay visible, from 0.10 to 0.40. Move it up to hide more videos, or down if the
  filter hides videos you'd want. YouTube pages update as you move it. With only
  topics to avoid, it works the other way round: move it up to hide fewer videos.
- **Try a title**: type a video title to see how close it is to your topics and
  whether the filter would show or hide it. Move the sensitivity to see the verdict
  change. The first try loads the model if it isn't loaded yet.
- **Where to filter**: Next to the video you're watching (on by default), Home (on by
  default, including Your custom feed), Subscriptions (off by default) and Search
  results (off by default). Subscriptions and search results show what you asked for,
  so filtering them is up to you. Subscriptions is filtered in its grid layout only. In
  search results, the shelves YouTube mixes in, such as "People also watched", are
  filtered like the results. Playlists and mixes on Home and in search results are
  judged by their title, like videos. The page checkboxes are disabled while the filter is off.
- **Never hide these channels** and **Always hide these channels**: one channel name per
  line, as YouTube shows it, up to 50 per list. Videos from a channel you never hide stay
  visible whatever their topic; videos from a channel you always hide are hidden on every
  page you filter, without the model. Names match ignoring case and spacing, so two
  channels with the same name both match, and a channel that changes its name needs adding
  again. Typing a name into one list removes it from the other. The lists are disabled
  while the filter is off. You can also right-click a video's thumbnail or title on
  YouTube (or its channel name on Home and in search results) and pick **Never hide this
  channel** or **Always hide this channel**. A message at the bottom of the page confirms it.
  Ads and the shelves the filter leaves alone, such as Home's, stay as they are when you pick
  a channel from them; the channel is listed for every page the filter works on.

Settings synced from another computer are kept within the limits the options page allows.

When the filter hides videos, the list starts with a row such as "12 videos hidden".
**Show them** shows them, dimmed and outlined, until you go to another page. The
extension's icon in the toolbar shows how many videos are hidden on the page you're on.

The filter judges each video by its title and channel, so it makes mistakes: it may
hide a few videos you'd want, or keep a few you wouldn't. A handful of specific
topics works better than one broad word. For example, "programming, JavaScript, web
development" keeps more coding videos than "programming" alone.

While the filter is on and has topics to see or to avoid, a line in the popup and on
the options page shows the model's status: waiting to be needed, loading, ready, or
failed. While it's waiting or after a failure, **Load now** next to the status loads it
right away. Videos stay visible while the model loads, and if it fails to load or to
answer. After a failure, it tries again a little later.

![The settings popup, with all three toggles on, the topics programming, software engineering and chess, the filter sensitivity at 0.25, and the status The model is ready](docs/settings-popup.png)

### Keyboard shortcuts

**Alt+Shift+F** turns Filter recommendations on or off, and **Alt+Shift+S** turns Hide
Shorts on or off. On a Mac they are **Control+Shift+F** and **Control+Shift+S**, and on
ChromeOS **Alt+Shift+F** and **Alt+Shift+H**. On YouTube, a message confirms the change. If
another extension already uses a combination, Chrome leaves it unset; **Change shortcuts**
on the options page opens `chrome://extensions/shortcuts`, where you can pick your own.

## Performance

The topic filter costs nothing until you type some topics to see or to avoid. The
model then starts loading as soon as you save your first topics, or turn the filter
back on with topics set, so it's usually ready when you open YouTube. With Home
filtered, the model loads as soon as you open YouTube with topics set. Only the computer
where you made the change loads it early; your other computers load it when they need it:

- The model downloads once, about 160 MB. Chrome caches it, so later videos don't
  download it again.
- While in use, the model takes about 0.5 to 0.7 GB of memory. The extension frees it
  after 5 minutes without new videos to check, even if it was loaded early and never
  used, or as soon as you turn the filter off or clear your topics to see and to avoid.

When most videos on a page are off topic, YouTube loads more to fill it (the sidebar
and Home both do this), and the filter checks those too. On some pages, that means
checking more than a hundred videos before the list settles.

Channel lists cost nothing: they don't need the model.

On a low-end computer, checking videos may feel slow. If it does, turn off **Filter
recommendations**.

## Languages

The extension recognizes the custom feed tab when YouTube is in any of the ten most
spoken languages: English, Mandarin Chinese (Simplified and Traditional), Hindi,
Spanish, Arabic, French, Bengali, Portuguese, Russian, and Indonesian. The settings
popup, the options page and the messages the extension shows on YouTube are translated
into the same languages.

YouTube first launched the custom feed in English, so tab names in other languages
are based on YouTube's Help Center. If the extension doesn't find the tab in your
language, add the name YouTube shows to `src/labels.js` and open an issue.

The topic model understands more than 100 languages, so your topics and the video
titles don't have to be in the same language. How well it matches varies by
language.

## Setup

1. Download the zip from the
   [latest release](https://github.com/r-afael/better-yt-recommendations/releases/latest)
   and unzip it.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** in the top-right corner.
4. Click **Load unpacked** and choose the unzipped folder containing `manifest.json`.
5. Refresh YouTube. Your custom feed will open automatically.

Keep the folder on your computer. To update, replace its files with the ones from a
newer release, click the extension's reload button at `chrome://extensions`, then
refresh YouTube.

## Privacy

The extension runs only on YouTube. It doesn't track you or collect your data. It
saves your settings, including your topics to see and to avoid and your channel lists,
in Chrome, which syncs them across your computers if you use Chrome sync.

The topic filter's model and its files download once from huggingface.co (Hugging
Face). After that, the model runs on your computer. The titles and channels of the
videos you see are never sent anywhere. The extension asks for the "offscreen"
permission to run the model in a hidden page of its own. It asks for the "contextMenus"
permission to add Never hide this channel and Always hide this channel to the right-click
menu on YouTube. It asks for "declarativeNetRequestWithHostAccess" and access to
youtube.com so Chrome can rewrite Shorts addresses to regular video addresses before loading
them. The rewrite happens inside Chrome.

Read the full [privacy policy](PRIVACY.md).

## Development

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
  page, translation, saving, and the model status.
- `_locales/` has the translations of the popup, the options page and the messages the
  extension shows on YouTube.
- `src/protocol.js` names the messages the extension's parts send each other.
- `src/topics.js` turns the topics field into a list of topics.
- `src/verdict.js` decides from a video's scores whether it is hidden, and whether the
  filter needs the model.
- `src/channels.js` reads the channel lists and says whether a channel is always shown
  or always hidden.
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
- `src/matcher.js` compares video titles with your topics.
- `src/model.js` loads the model with Transformers.js.
- `src/vendor/transformers/` holds Transformers.js and ONNX Runtime Web, copied from
  `node_modules` by `scripts/vendor.js`. Don't edit these files.

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

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) to get
started, and report security problems privately as described in
[SECURITY.md](SECURITY.md). Everyone taking part follows the
[code of conduct](CODE_OF_CONDUCT.md).

## Credits

- [Transformers.js](https://github.com/huggingface/transformers.js) (Apache-2.0) and
  [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) (MIT) are included in
  `src/vendor/transformers/` with their licenses.
- The topic model is
  [hotchpotch/bekko-embedding-v1-a8m](https://huggingface.co/hotchpotch/bekko-embedding-v1-a8m)
  (MIT).

[MIT license](LICENSE)
