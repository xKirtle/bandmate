# yt-dlp, ffmpeg and QuickJS ship in Bandmate's own image

Adding a Beat from a link fetches it with yt-dlp, which needs ffmpeg (to keep every fetched Beat an m4a any browser plays) and a JavaScript runtime (to solve YouTube's challenges). All three are bundled into the one Bandmate image, whose final stage moves from `distroless/static` to `distroless/cc` for the glibc they need, taking it from about 24 MB to about 140 MB. That's still small, and nothing runs until a fetch does: yt-dlp is started per fetch and exits.

## Considered Options

- **A fetcher container** (the same binary, run as a separate service beside Bandmate) kept the main image as it was and would keep yt-dlp away from the data folder, but it holds memory the whole time it's deployed, to save disk, and is a second service to configure.
- **A second tag of the image** (a full one beside a slim one) makes the user choose at install, for a feature they may want later.

## Consequences

- When a site breaks yt-dlp, the fix is a newer yt-dlp. A Bandmate release brings one. In the meantime the About tab's "Update yt-dlp" button fetches one into the data folder, only when pressed (a third outbound call, to GitHub like the update check), or a user can mount their own over the bundled one. Whichever yt-dlp is newest is used.
- QuickJS is chosen over Deno, yt-dlp's default, for size. Moving to Deno is a Dockerfile change only, if QuickJS proves too slow.
