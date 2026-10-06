## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues on xKirtle/bandmate, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

Every change gets an issue before its PR, even a quick win whose spec is already a roadmap entry, so the work stays visible. Make issues with the `to-tickets` skill.

### Triage labels

Default vocabulary: needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix. This repo adds needs-grilling. See `docs/agents/triage-labels.md`.

### Pull request titles and labels

Title and label every PR as CONTRIBUTING's "Title it for the release notes" and "Label it" say. Issues carry only triage labels.

### Domain docs

Single-context: `GLOSSARY.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Releases

To decide whether to release, or to cut one, follow `docs/agents/release.md`. It ends in CONTRIBUTING's "Cutting a release": push the tag, wait for CI to publish the image, and only then create the GitHub Release.

## UI

Before writing or restyling UI, read `docs/design.md`: take every colour, size, space, radius, shadow and duration from its tokens.

## Formatting

Before committing web app changes, run `npm run format` and `npm run lint:css` in `web/`. CI fails a PR whose web code isn't formatted or whose styles don't pass Stylelint. Format Go with `gofmt` (CI doesn't check it).
