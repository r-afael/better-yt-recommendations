# Privacy policy

*Last updated: November 1, 2026*

Better YT Recommendations doesn't collect, track, sell or share any data about you.
Its developer never receives anything from the extension.

## What the extension reads

The extension runs only on YouTube. To filter recommendations, it reads the titles
and channel names of the videos in the lists it filters: next to the video you're
watching, on Home, and, if you turn them on, in your Subscriptions and search results.
It compares them with your topics on your computer and doesn't store them or send them
anywhere.
When you right-click a video and pick one of the extension's menu entries, it reads that
video's channel name and saves it to your list.

With Hide Shorts on, Chrome rewrites youtube.com/shorts/ addresses into youtube.com/watch
addresses before loading them, using a rule the extension ships. This happens inside Chrome,
and nothing is sent anywhere.

## What the extension stores

Your settings, including your topics, your topics to avoid, how well videos must match
each, your channel lists and your topic profiles, are saved in Chrome's extension
storage. If you use Chrome sync, Chrome syncs them across your computers under
[Google's privacy policy](https://policies.google.com/privacy). The extension also
keeps the model's loading status until you close Chrome, so the popup and the options
page can show it.

Uninstalling the extension deletes everything it stored.

## Hugging Face

The topic filter's model downloads once from huggingface.co (Hugging Face), the first
time it's needed on a computer: when you save your first topics there or turn the filter
back on with topics set, when you click Load now or try a title on the options page, or
when you open a page the filter works on. Chrome then caches it, and the model runs on
your computer. The download sends nothing about you or what you watch, but like any
download, Hugging Face sees your IP address. Its handling of that is covered by
[Hugging Face's privacy policy](https://huggingface.co/privacy).

The extension downloads nothing while the filter is off or has no topics to see or to
avoid.

## Changes

Changes to this policy are listed in the repository's
[history for this file](https://github.com/r-afael/better-yt-recommendations/commits/main/PRIVACY.md),
and the date above changes with them.

## Contact

Questions about privacy go in a
[GitHub issue](https://github.com/r-afael/better-yt-recommendations/issues). To report
the extension sending data anywhere, use the private
[security reporting form](https://github.com/r-afael/better-yt-recommendations/security/advisories/new)
instead.
