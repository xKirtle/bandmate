# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues. Use the `gh` CLI for all operations, falling back to `gh api` where GraphQL is blocked (see below).

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --comments`, filtering comments by `jq` and also fetching labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

Infer the repo from `git remote -v`; `gh` does this automatically when run inside a clone.

## When `gh` can't reach GraphQL

Most `gh` commands (`gh issue`, `gh pr`, `gh run`) talk to GitHub's GraphQL API, which some environments block: a Claude Code cloud session answers them with `HTTP 403: GitHub GraphQL is not available`. `gh api` talks to the REST API and still works there, so fall back to it, with `R=repos/xKirtle/bandmate`:

- `gh issue view <n> --comments`: `gh api $R/issues/<n>`, then `gh api $R/issues/<n>/comments`
- `gh issue list --state open --label <l>`: `gh api "$R/issues?state=open&labels=<l>" --jq '[.[] | select(.pull_request | not)]'` (the endpoint returns PRs too)
- `gh issue create --title … --body-file f --label <l>`: `jq -n --rawfile body f '{title:"…", body:$body, labels:["<l>"]}' | gh api $R/issues --input -`
- `gh issue edit <n> --body-file f`: `jq -n --rawfile body f '{body:$body}' | gh api -X PATCH $R/issues/<n> --input -`
- `gh issue edit <n> --add-label <l>` / `--remove-label <l>`: `gh api $R/issues/<n>/labels -f 'labels[]=<l>'` / `gh api -X DELETE $R/issues/<n>/labels/<l>`
- `gh issue edit <n> --add-assignee @me`: `gh api $R/issues/<n>/assignees -f "assignees[]=$(gh api user --jq .login)"`
- `gh issue comment <n> --body …` (or `gh pr comment`): `gh api $R/issues/<n>/comments -f body=…`
- `gh issue close <n> --comment …`: the comment as above, then `gh api -X PATCH $R/issues/<n> -f state=closed -f state_reason=completed`
- `gh pr view <n> --comments` / `gh pr diff <n>`: `gh api $R/pulls/<n>` and `gh api $R/issues/<n>/comments` / `gh api $R/pulls/<n> -H "Accept: application/vnd.github.diff"`
- `gh pr list --state open --label <l>`: `gh api "$R/pulls?state=open" --jq '[.[] | select(any(.labels[]; .name=="<l>")) | {number, title, head: .head.ref}]'`
- `gh pr create --base main --head <b> --title … --body-file f`: `jq -n --rawfile body f '{title:"…", head:"<b>", base:"main", body:$body}' | gh api $R/pulls --input -`
- `gh pr edit <n> --title …`: `gh api -X PATCH $R/pulls/<n> -f title=…`
- `gh pr checks <n> --watch`: poll `gh api $R/commits/<head-sha>/check-runs --jq '.check_runs[] | [.name, .status, .conclusion]'` until every run is `completed`; a cloud session can instead subscribe to the PR and be woken when CI finishes
- `gh pr merge <n> --merge`: `gh api -X PUT $R/pulls/<n>/merge -f merge_method=merge`. REST has no `--admin`: if `main` requires an approving review the author can't give, stop and ask the user to merge
- `gh pr close <n>`: `gh api -X PATCH $R/pulls/<n> -f state=closed`
- `gh run watch`: poll `gh api "$R/actions/runs?head_sha=<sha>" --jq '.workflow_runs[] | [.name, .status, .conclusion]'`

Issues and PRs share their number space, so the `issues` endpoints for comments and labels work on a PR's number too. Sub-issues and dependencies below already use `gh api`.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

When set to `yes`, PRs run through the same labels and states as issues, using the `gh pr` equivalents:

- **Read a PR**: `gh pr view <number> --comments` and `gh pr diff <number>` for the diff.
- **List external PRs for triage**: `gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments` then keep only `authorAssociation` of `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR`, or `NONE` (drop `OWNER`/`MEMBER`/`COLLABORATOR`).
- **Comment / label / close**: `gh pr comment`, `gh pr edit --add-label`/`--remove-label`, `gh pr close`.

GitHub shares one number space across issues and PRs, so a bare `#42` may be either: resolve with `gh pr view 42` and fall back to `gh issue view 42`.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body. `gh issue create --label wayfinder:map`.
- **Child ticket**: an issue linked to the map as a GitHub sub-issue (`gh api` on the sub-issues endpoint). Where sub-issues aren't enabled, add the child to a task list in the map body and put `Part of #<map>` at the top of the child body. Labels: `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`). Once claimed, the ticket is assigned to the driving dev.
- **Blocking**: GitHub's **native issue dependencies**, the canonical, UI-visible representation. Add an edge with `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, where `<blocker-db-id>` is the blocker's numeric **database id** (`gh api repos/<owner>/<repo>/issues/<n> --jq .id`, _not_ the `#number` or `node_id`). GitHub reports `issue_dependencies_summary.blocked_by` (open blockers only, the live gate). Where dependencies aren't available, fall back to a `Blocked by: #<n>, #<n>` line at the top of the child body. A ticket is unblocked when every blocker is closed.
- **Frontier query**: list the map's open children (`gh issue list --state open`, scoped to the map's sub-issues / task list), drop any with an open blocker (`issue_dependencies_summary.blocked_by > 0`, or an open issue in the `Blocked by` line) or an assignee; first in map order wins.
- **Claim**: `gh issue edit <n> --add-assignee @me`, the session's first write.
- **Resolve**: `gh issue comment <n> --body "<answer>"`, then `gh issue close <n>`, then append a context pointer (gist + link) to the map's Decisions-so-far.
