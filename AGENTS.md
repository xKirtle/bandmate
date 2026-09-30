## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues on xKirtle/bandmate, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix, plus needs-grilling for issues that are wanted but not grilled enough to be ready. See `docs/agents/triage-labels.md`.

### Pull request labels

Every PR gets exactly one of `enhancement`, `bug` or `documentation`, since the release notes are grouped by those labels. Issues carry only triage labels.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Formatting

Before committing web app changes, run `npm run format` in `web/`. CI fails a PR whose web code isn't formatted. Format Go with `gofmt` (CI doesn't check it).
