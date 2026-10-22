# Release

## 1. List what's unreleased

Diff against the last tag (`git describe --tags --abbrev=0`), never the last Release's date: a Release can be published well after its tag, so PRs merged in between are still unreleased.

For each PR merged since the tag, note its label and the issue it closes, and roll sub-issues up to their parent issue. A parent issue is a feature; the rest are fixes, docs and refactors. Done when every merged PR sits under a feature, a fix, a docs change or a refactor.

## 2. Judge whether it's ready

- **Half-shipped features**: an open parent issue with some sub-issues merged means a feature is mid-build. Release only if what's merged stands on its own for a user.
- **Fixes from real use**: the roadmap puts them before the next feature. Open bug issues against a feature in this release are a reason to wait.
- **CI**: the latest run on `main` is green.
- **Risk**: changes outside `web/` and `docs/`, especially database migrations, which can't be rolled back by pulling the old image. Name each one.

## 3. Check what's bundled

Compare what the image bundles and what Bandmate is built with against each one's newest release:

| What | Pinned in | Newest release | Changelog |
|---|---|---|---|
| yt-dlp | `Dockerfile`'s `YT_DLP_VERSION` | `gh api repos/yt-dlp/yt-dlp/releases/latest --jq .tag_name` | each release's notes on https://github.com/yt-dlp/yt-dlp/releases |
| ffmpeg | `Dockerfile`'s `FFMPEG_VERSION` | the newest `ffmpeg-*.tar.xz` on https://ffmpeg.org/releases/ | `Changelog` on FFmpeg's `release/X.Y` branch |
| QuickJS | `Dockerfile`'s `QUICKJS_VERSION` | the newest `quickjs-*.tar.xz` on https://bellard.org/quickjs/ | https://bellard.org/quickjs/Changelog |
| Go | `go.mod`'s `go` line | `curl -fsSL 'https://go.dev/dl/?mode=json'` | https://go.dev/doc/devel/release |
| SQLite | `go.mod`'s `modernc.org/sqlite` | `go list -m -u modernc.org/sqlite` | `CHANGELOG.md` in https://gitlab.com/cznic/sqlite, and https://sqlite.org/changes.html for the SQLite it moves to |

CI and the binaries build with exactly the `go.mod` Go version, while the image's `golang` base takes the newest patch, so a `go.mod` behind the newest patch means the image and the binaries report different Go versions in About.

For each one that's behind, read every changelog entry between the pinned version and the newest, and weigh the bump for Bandmate:

- **What it earns**: fixes and features Bandmate would notice, above all security fixes, and for yt-dlp the sites it reads that it fixes. Say "nothing Bandmate uses" when that's so.
- **What it costs**: breaking or removed behaviour Bandmate relies on, and the work the bump brings with it, such as a module that must be pinned alongside it, a new build flag, or a bigger image.

Each one that's behind goes in the recommendation, with the changelog links, what it earns, what it costs, and the bump proposed for it. Bumping is the user's choice: one left out doesn't hold the release back. A new major version (ffmpeg 8 to 9, say) isn't bumped in a release: file a `needs-grilling` issue for it instead, with its earn and cost, and say so.

## 4. Pick the version

Apply CONTRIBUTING's "Versions" to the PRs' labels: any `enhancement` bumps the minor, only `bug` and `documentation` bump the patch, and a PR labelled `no-release-notes` doesn't count, whatever else it's labelled. A database migration since the last tag bumps the minor too, whatever the labels. A change that breaks one of the promises "Versions" lists bumps the major, and is named in the verdict.

## 5. Clear the roadmap

Every shipped feature leaves `docs/roadmap.md`. A wishlist idea that shipped in part keeps only its unshipped bullets. Open this as a PR labelled `documentation` and `no-release-notes`, merged before the tag so the release carries it.

## 6. Preview the notes

Generate the notes the Release will get, without publishing anything:

```sh
gh api repos/xKirtle/bandmate/releases/generate-notes \
  -f tag_name=vX.Y.Z -f target_commitish=main -f previous_tag_name=<last tag> --jq .body
```

Every self-hoster reads them in About, in Settings. Check each line reads as a change they'd notice, under the right heading, and note every line that doesn't. Each is fixed on its PR, where the notes come from:

- A line that describes the code rather than what changed for a self-hoster gets a new title (`gh pr edit <number> --title`), which works on merged PRs too.
- A line with nothing a self-hoster would notice gets the `no-release-notes` label, which drops it from the notes.

## 7. Recommend, then stop

Give the verdict (release now or wait, and why), the version, a table of what ships grouped by feature, each flagged line with the title or label proposed for it, and a table of the bumps proposed in step 3 (pinned and newest version, changelog links, what each earns and costs). Wait for the go-ahead, and for which bumps to take: a tag publishes an image every self-hoster's About tab offers as an update.

## 8. Cut it

Land the bumps the go-ahead took first, each merged before the tag so the release carries it:

- **yt-dlp**: start the weekly workflow by hand (`gh workflow run yt-dlp.yml`), so its pull request comes out as the weekly one does, and merge it once CI passes. It's labelled `enhancement`, so it bumps the minor version.
- **The rest**: each gets an issue and a pull request of its own, labelled as CONTRIBUTING's "Label it" says.

Preview the notes again for the bumps' lines, and pick the version again if a bump's label changed it.

Then retitle and relabel the PRs the preview flagged, then follow CONTRIBUTING's "Cutting a release". Write the notes by hand only for what a title or label can't fix.
