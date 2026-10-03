---
name: orchestrate
description: Work through a queue of GitHub issues one at a time, delegating each to a sub-agent that runs /implement and opens a PR, then waiting for the user's review or, in auto-merge mode, for CI to pass.
disable-model-invocation: true
---

The arguments are the issues to work through, plus any instructions. Work the issues in the order given, unless the user says otherwise. By default each PR is reviewed by hand. If the user says PRs can be merged once their checks pass, run in **auto-merge mode**.

You are the orchestrator: you delegate, relay and gate, and each sub-agent does the implementing. Exactly one sub-agent works at a time. A gate separates each issue from the next: the user's go-ahead by default, or a green, merged PR in auto-merge mode.

## Loop

For each issue in order:

1. Spawn one background sub-agent with the brief below.
2. When it hands back, relay its report to the user. Put anything that needs a decision first. Then give the PR link, the changes, the check results as reported, the acceptance criteria ticked and left unticked, the review findings left unfixed, and any open questions.
3. Pass the gate.
   - **Default:** wait for the user. They review PRs by hand and can take a while, so leave the PR status alone until they say to proceed. If a notification arrives for an agent you've already reported on, answer it with one line.
   - **Auto-merge mode:** watch the checks with `gh pr checks <PR> --watch` in the background. If they go red, send the failure to the same sub-agent to fix, then watch again. Once they're green, merge using the repo's merge method, a merge commit if nothing says otherwise. If the branch requires an approving review, add `--admin`: the sub-agent's `gh` is the PR's author, and GitHub never counts an author's own approval. Then `git switch main && git pull --ff-only`, tell the user the PR is merged, and move on without waiting. Stop and ask the user if the PR can't merge cleanly, or the sub-agent can't make the checks go green.
4. Send follow-ups on the open PR (review changes, the answer to an ambiguity) to the same sub-agent with SendMessage, so it keeps its context. You can make small edits to the issue body's wording yourself.
5. Once the gate passes, move on to the next issue.

A sub-agent that hands back with an ambiguity blocks the queue in either mode: relay the question and wait for the user's answer. Once the queue is empty, say so.

## Sub-agent brief

Fill in `<N>` and the repo. Add any environment gotchas from your memory that the agent can't find in the repo, such as how pushing works in this environment. Leave domain facts out, because the agent reads the repo's own docs.

```
You are implementing GitHub issue #<N> in <repo path> (<owner/repo>). Before starting, read AGENTS.md / CLAUDE.md and the docs they point to.

1. Read the issue and its comments: `gh issue view <N> --comments`.
2. Branch from the latest origin/main: `git fetch origin && git switch -c <prefix>/<N>-<slug> origin/main`, using the repo's branch naming. If a local branch with that name already exists, check it before you reuse it.
3. Read `.claude/skills/implement/SKILL.md` and follow it fully for issue #<N>, including its code review. Fix what the review finds. Invoke the skills it names (such as `tdd` and `code-review`) with the Skill tool.
4. If the issue's wording is ambiguous, or conflicts with the domain docs or the existing code, stop and hand back. Give the exact ambiguity, the options, your recommendation, and what is committed or pushed so far. Everything the issue states clearly, carry on with.
5. Push the branch. Open a PR against main with `gh pr create`, write its body with the `pr` skill, and have it close the issue.
6. Tick the acceptance criteria your PR fulfils. Edit the issue body with `gh issue edit <N> --body-file`, keeping the temp file outside the repo. Change only those `- [ ]` to `- [x]`.
7. Leave the PR unmerged, because it gets reviewed by hand. Switch back to main.

Final report: the branch, the PR URL, a summary of the changes, the check results (paste the actual output), which acceptance criteria you ticked and which you left unticked (with reasons), any review findings you didn't fix and why, and any open questions.
```
