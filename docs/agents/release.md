# Release

## 1. List what's unreleased

Diff against the last tag (`git describe --tags --abbrev=0`), never the last Release's date: a Release can be published well after its tag, so PRs merged in between are still unreleased.

For each PR merged since the tag, note its label and the issue it closes, and roll sub-issues up to their parent issue. A parent issue is a feature; the rest are fixes, docs and refactors. Done when every merged PR sits under a feature, a fix, a docs change or a refactor.

## 2. Judge whether it's ready

- **Half-shipped features**: an open parent issue with some sub-issues merged means a feature is mid-build. Release only if what's merged stands on its own for a user.
- **Fixes from real use**: the roadmap puts them before the next feature. Open bug issues against a feature in this release are a reason to wait.
- **CI**: the latest run on `main` is green.
- **Risk**: changes outside `web/` and `docs/`, especially database migrations, which can't be rolled back by pulling the old image. Name each one.

## 3. Pick the version

Apply CONTRIBUTING's "Versions" to the PRs' labels: any `enhancement` bumps the minor, only `bug` and `documentation` bump the patch, and a PR labelled `no-release-notes` doesn't count, whatever else it's labelled.

## 4. Clear the roadmap

Every shipped feature leaves `docs/roadmap.md`. A wishlist idea that shipped in part keeps only its unshipped bullets. Open this as a PR labelled `documentation` and `no-release-notes`, merged before the tag so the release carries it.

## 5. Preview the notes

Generate the notes the Release will get, without publishing anything:

```sh
gh api repos/xKirtle/bandmate/releases/generate-notes \
  -f tag_name=vX.Y.Z -f target_commitish=main -f previous_tag_name=<last tag> --jq .body
```

Every self-hoster reads them in About, in Settings. Check each line reads as a change they'd notice, under the right heading, and note every line that doesn't. Each is fixed on its PR, where the notes come from:

- A line that describes the code rather than what changed for a self-hoster gets a new title (`gh pr edit <number> --title`), which works on merged PRs too.
- A line with nothing a self-hoster would notice gets the `no-release-notes` label, which drops it from the notes.

## 6. Recommend, then stop

Give the verdict (release now or wait, and why), the version, a table of what ships grouped by feature, and each flagged line with the title or label proposed for it. Wait for the go-ahead: a tag publishes an image every self-hoster's About tab offers as an update.

## 7. Cut it

Retitle and relabel the PRs the preview flagged, then follow CONTRIBUTING's "Cutting a release". Write the notes by hand only for what a title or label can't fix.
