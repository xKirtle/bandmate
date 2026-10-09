---
name: orchestrate
description: Work through a queue of GitHub issues one at a time, delegating each to a sub-agent that runs /implement and opens a PR, then waiting for the user's review or, in auto-merge mode, for CI to pass.
disable-model-invocation: true
---

If a `gh` command fails with `HTTP 403: GitHub GraphQL is not available`, use its `gh api` (REST) equivalent from `docs/agents/issue-tracker.md` instead.

The arguments are the issues to work through, plus any instructions. Work the issues in the order given, unless the user says otherwise. By default each PR is reviewed by hand. If the user says PRs can be merged once their checks pass, run in **auto-merge mode**.

You are the orchestrator: you delegate, relay and gate, and each sub-agent does the implementing. Exactly one sub-agent works at a time. A gate separates each issue from the next: the user's go-ahead by default, or a green, merged PR in auto-merge mode.

## Dev servers

You keep a dev stack running from the main checkout on `main`, so the user can check progress at http://localhost:5173 at any point in the run. Sub-agents work in their own worktrees and ports, which leaves the main checkout and its ports to the stack.

- **Start** it before spawning the first sub-agent: `go run ./cmd/bandmate` (API on :8080) and `npm --prefix web run dev` (Vite on :5173). In the CLI, run each as a background Bash command. In the desktop app, use `preview_start` with the `api` and `web` configurations in `.claude/launch.json`, adding them if they're missing. If a port is already taken, see what holds it with `lsof -nP -iTCP:<port> -sTCP:LISTEN`. Stop it if it's this repo's `bandmate` or Vite, and ask the user otherwise. Give the user the URL.
- **Refresh** it after every merge: `git switch main && git pull --ff-only`, run `npm --prefix web install` if `web/package-lock.json` changed, then restart both servers. Vite reloads the SPA by itself, but the Go server runs the new code only once restarted. To stop a server, kill the pid holding its port as well as the background task or preview: `go run` leaves its `bandmate` binary listening. Say the stack is refreshed in the same line that reports the merge.
- Leave it running when the queue is empty.

## Loop

For each issue in order:

1. Spawn one background sub-agent with `isolation: "worktree"` and the brief below.
2. When it hands back, relay its report to the user. Put anything that needs a decision first. Then give the PR link, the changes, the check results as reported, the acceptance criteria ticked and left unticked, the review findings left unfixed, and any open questions.
3. Pass the gate.
   - **Default:** wait for the user. They review PRs by hand and can take a while, so leave the PR status alone until they say to proceed. When they do, check `gh pr view <PR> --json state`, and refresh the dev stack if it's merged. If a notification arrives for an agent you've already reported on, answer it with one line.
   - **Auto-merge mode:** watch the checks with `gh pr checks <PR> --watch` in the background. If they go red, send the failure to the same sub-agent to fix, then watch again. Once they're green, check what the PR touches with `gh pr diff <PR> --name-only`: if it edits `CONTRIBUTING.md`, `AGENTS.md`, `docs/agents/` or `docs/adr/` and the issue didn't ask for that, stop and ask the user before merging, since a sub-agent may have loosened a rule to fit its change. Otherwise merge using the repo's merge method, a merge commit if nothing says otherwise. If the branch requires an approving review, add `--admin`: the sub-agent's `gh` is the PR's author, and GitHub never counts an author's own approval. Then refresh the dev stack, tell the user the PR is merged, and move on without waiting. Stop and ask the user if the PR can't merge cleanly, or the sub-agent can't make the checks go green.
4. Send follow-ups on the open PR (review changes, the answer to an ambiguity) to the same sub-agent with SendMessage, so it keeps its context. You can make small edits to the issue body's wording yourself.
5. Once the PR is merged, remove the sub-agent's worktree and its branches, which `gh pr merge --delete-branch` can't delete locally while the worktree holds them. The agent's task-notification gives `worktreePath` and `worktreeBranch`: `git worktree remove -f -f <worktreePath> && git branch -D <worktreeBranch> <PR branch>`.
6. Once the gate passes, move on to the next issue.

A sub-agent that hands back with an ambiguity blocks the queue in either mode: relay the question and wait for the user's answer. Once the queue is empty, say so.

## Sub-agent brief

Fill in `<N>`, the repo and the ports, which can be any pair other than :8080 and :5173. Keep the step 7 line for this run's mode and drop the other. Add any environment gotchas from your memory that the agent can't find in the repo, such as how pushing works in this environment. Leave domain facts out, because the agent reads the repo's own docs.

```
You are implementing GitHub issue #<N> in <owner/repo>. You are in your own git worktree. Before starting, read AGENTS.md / CLAUDE.md and the docs they point to. If a `gh` command fails with `HTTP 403: GitHub GraphQL is not available`, use its `gh api` equivalent from `docs/agents/issue-tracker.md`.

Dev servers: if you run any, use ports <ports>. The orchestrator's stack holds :8080 and :5173.

1. Read the issue and its comments: `gh issue view <N> --comments`.
2. Branch from the latest origin/main: `git fetch origin && git switch -c <prefix>/<N>-<slug> origin/main`, using the repo's branch naming. Install dependencies if the worktree has none. If a local branch with that name already exists, check it before you reuse it.
3. Read `.claude/skills/implement/SKILL.md` and follow it fully for issue #<N>, including its code review. Fix what the review finds. Invoke the skills it names (such as `tdd` and `code-review`) with the Skill tool.
4. If the issue's wording is ambiguous, or conflicts with the domain docs or the existing code, stop and hand back. Meet CONTRIBUTING's rules as written; where the change can't, hand back the same way rather than adding an exception. Give the exact ambiguity, the options, your recommendation, and what is committed or pushed so far. Everything the issue states clearly, carry on with.
5. Push the branch. Open a PR against main with `gh pr create`, write its body with the `pr` skill, and have it close the issue.
6. Tick the acceptance criteria your PR fulfils. Edit the issue body with `gh issue edit <N> --body-file`, keeping the temp file outside the repo. Change only those `- [ ]` to `- [x]`.
7. (Default) Leave the PR unmerged, because it gets reviewed by hand.
7. (Auto-merge) Leave the PR unmerged; the orchestrator merges it once CI is green. If you are later sent a CI failure, fix it on the same branch and push.

Final report: the branch, the PR URL, a summary of the changes, the check results (paste the actual output), which acceptance criteria you ticked and which you left unticked (with reasons), any review findings you didn't fix and why, and any open questions.
```
