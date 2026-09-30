## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues on xKirtle/bandmate, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Formatting

Before committing web app changes, run `npm run format` in `web/`. CI fails a PR whose web code isn't formatted. Format Go with `gofmt` (CI doesn't check it).
