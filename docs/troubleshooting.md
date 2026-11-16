# Troubleshooting

Solutions to common issues with Better YT Recommendations.

## Home doesn't switch to Your custom feed

The extension automatically switches to Your custom feed when YouTube Home opens,
provided the feature is turned on in the popup or options page:

- **Check feed availability**: Your custom feed must be set up and available on your
  YouTube account on desktop. If YouTube does not offer the feed for your account,
  the extension cannot open it.
- **Check YouTube's language**: The extension identifies the feed tab by its name in
  `src/labels.js`. It supports the ten currently supported languages: English,
  Chinese, Hindi, Spanish, Arabic, French, Bengali, Portuguese, Russian, and
  Indonesian. If YouTube is set to another language or YouTube changes the tab
  wording, the extension cannot recognize the tab.

## Videos I want are hidden, or videos I don't want stay

The topic filter hides videos based on how closely their titles match your topics.
You can adjust the filter using the sliders under **Topics** in **All settings**:

- **Match needed to show** (default 0.25, range 0.10 to 0.40): Sets how well a video
  title must match a topic you want to see. Moving the slider higher makes the filter
  stricter and hides more videos; moving it lower lets more videos through. This
  slider has no effect until you add at least one topic to see.
- **Match that hides** (default 0.24, range 0.10 to 0.40): Sets how well a video title
  must match a topic to avoid before being hidden. Moving the slider lower makes it
  stricter and hides more videos; moving it higher hides fewer. A video is only hidden
  if it reaches this threshold and matches a topic to avoid more than your wanted
  topics. This slider has no effect until you add at least one topic to avoid.
- **Channels**: Videos from channels in **Never hide these channels** are always shown,
  and videos from **Always hide these channels** are always hidden without needing
  the model.
- **Tune with "Try a title"**: On the options page, type a video title into the **Try a
  title** box. It queries the model and displays the title's match scores alongside a
  verdict (for example, whether the title is shown or hidden and why). Moving the
  sliders updates the verdict immediately so you can find the right values for your
  topics.

## The model doesn't load

The extension uses a small AI model (`hotchpotch/bekko-embedding-v1-a8m`) to evaluate
video titles:

- **Initial download**: The model downloads once from Hugging Face (approximately
  160 MB) when first needed, then runs locally on your computer.
- **Loading status**: While downloading or loading, the popup and options page
  display "Loading the model…" with a progress bar.
- **Errors and retries**: If downloading fails, the status displays "Couldn't load
  the model. It will try again shortly." You can click the **Load now** button next to
  the status to retry immediately. While the model is loading or in an error state,
  unfiltered videos remain visible so you can still use YouTube.

## Shorts still appear

If Shorts continue to appear on YouTube:

- **Check Hide Shorts**: Make sure **Hide Shorts** is switched on in the extension
  popup or in **All settings**.
- **YouTube layout changes**: YouTube regularly updates its interface and class names.
  When this happens, existing CSS rules and selectors may fail to detect Shorts until
  the extension is updated.
Report layout changes: If YouTube changed its layout, submit a report using the [YouTube changed its layout](https://github.com/r-afael/better-yt-recommendations/issues/new?template=youtube_layout.yml) issue form on GitHub.

## A keyboard shortcut does nothing

The extension configures default shortcuts for toggling the filter (`Alt+Shift+F`
on Windows/Linux, `Control+Shift+F` on Mac) and toggling Hide Shorts (`Alt+Shift+S`
on Windows/Linux, `Control+Shift+S` on Mac, and `Alt+Shift+H` on ChromeOS):

- **Conflicting shortcuts**: If another Chrome extension already uses a shortcut,
  Chrome leaves it unset. The options page will display **Not set** next to that
  action.
- **Reassigning shortcuts**: You can assign or change shortcuts at any time by
  navigating to `chrome://extensions/shortcuts` in Chrome, or by clicking the
  **Change shortcuts** button at the bottom of the options page.
