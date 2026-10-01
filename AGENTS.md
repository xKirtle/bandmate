## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues on xKirtle/bandmate, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix. This repo adds needs-grilling. See `docs/agents/triage-labels.md`.

### Pull request labels

Every PR gets exactly one of `enhancement`, `bug`, `documentation` or `refactor`, since the release notes are grouped by those labels (see `.github/release.yml`). `refactor` is for a change no self-hoster would notice, such as a refactor, tooling or CI, and the notes leave it out. Issues carry only triage labels.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Releases

To decide whether to release, or to cut one, follow `docs/agents/release.md`. It ends in CONTRIBUTING's "Cutting a release": push the tag, wait for CI to publish the image, and only then create the GitHub Release.

## Formatting

Before committing web app changes, run `npm run format` in `web/`. CI fails a PR whose web code isn't formatted. Format Go with `gofmt` (CI doesn't check it).
