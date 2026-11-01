# Privacy policy

*Last updated: November 1, 2026*

Better YT Recommendations doesn't collect, track, sell or share any data about you.
Its developer never receives anything from the extension.

## What the extension reads

The extension runs only on YouTube. To filter recommendations, it reads the titles
and channel names of the videos in the sidebar next to the one you're watching. It
compares them with your topics on your computer and doesn't store them or send them
anywhere.

## What the extension stores

Your settings, including your topics and the filter sensitivity, are saved in
Chrome's extension storage. If you use Chrome sync, Chrome syncs them across your
computers under [Google's privacy policy](https://policies.google.com/privacy). The
extension also keeps the model's loading status until you close Chrome, so the
settings popup can show it.

Uninstalling the extension deletes everything it stored.

## Hugging Face

The topic filter's model downloads once from huggingface.co (Hugging Face), the first
time you open a video with the filter on and some topics set. Chrome then caches it,
and the model runs on your computer. The download sends nothing about you or what you
watch, but like any download, Hugging Face sees your IP address. Its handling of that
is covered by [Hugging Face's privacy policy](https://huggingface.co/privacy).

The extension downloads nothing while the filter is off or has no topics.

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
