---
name: release
description: Decide whether main is worth releasing, pick the version, clear shipped features off the roadmap, and cut the release. Use when asked whether to release, or to cut one.
---

# Release

## 1. List what's unreleased

Diff against the last tag (`git describe --tags --abbrev=0`), never the last Release's date: a Release can be published well after its tag, so PRs merged in between are still unreleased.

For each PR merged since the tag, note its label and the issue it closes, and roll sub-issues up to their parent issue. A parent issue is a feature; the rest are fixes and docs. Done when every merged PR sits under a feature, a fix or a docs change.

## 2. Judge whether it's ready

- **Half-shipped features**: an open parent issue with some sub-issues merged means a feature is mid-build. Release only if what's merged stands on its own for a user.
- **Fixes from real use**: the roadmap puts them before the next feature. Open bug issues against a feature in this release are a reason to wait.
- **CI**: the latest run on `main` is green.
- **Risk**: changes outside `web/` and `docs/`, especially database migrations, which can't be rolled back by pulling the old image. Name each one.

## 3. Pick the version

Apply CONTRIBUTING's "Versions" to the PRs' labels: any `enhancement` bumps the minor, only `bug` and `documentation` bump the patch.

## 4. Clear the roadmap

Every shipped feature leaves `docs/roadmap.md`. A wishlist idea that shipped in part keeps only its unshipped bullets. The README's Roadmap section names a few ideas as examples; swap out any that shipped. Open this as a `documentation` PR, merged before the tag so the release carries it.

## 5. Recommend, then stop

Give the verdict (release now or wait, and why), the version, and a table of what ships grouped by feature. Wait for the go-ahead: a tag publishes an image every self-hoster's About page offers as an update.

## 6. Cut it

Follow CONTRIBUTING's "Cutting a release". Read the generated notes before publishing, since the About page shows them.
