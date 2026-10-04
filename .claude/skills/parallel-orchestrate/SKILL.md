---
name: parallel-orchestrate
description: Experimental. Work through an Epic's tickets from /parallel-to-tickets, running tickets that don't contend in parallel sub-agents, and merging each PR once its checks pass and a duplication check clears it.
disable-model-invocation: true
---

If a `gh` command fails with `HTTP 403: GitHub GraphQL is not available`, use its `gh api` (REST) equivalent from `docs/agents/issue-tracker.md` instead.

The argument is one Epic: a parent issue labelled `epic`, with an impact map, as `/parallel-to-tickets` writes it. Other instructions may follow it. Up to **2** tickets run at once, unless the user sets another limit. Run one Epic at a time, because an Epic's map only knows about its own tickets.

You are the orchestrator: you schedule, relay and merge, and the sub-agents implement. The impact map is your only source for scheduling, and you never plan beyond it.

Keep the user's dev stack on `main` at http://localhost:5173 as the `orchestrate` skill's "Dev servers" section says (`.claude/skills/orchestrate/SKILL.md`): start it before the first sub-agent, and refresh it after every merge.

## Reading the map

- A ticket is **done** once its issue is closed. Rows for closed tickets stay in the map as history.
- Two open tickets **contend** when their Changes share a module and neither blocks the other, directly or through others.
- An open sub-issue of the Epic with no row in the map contends with every ticket, so it runs alone.
- Read the map again every time you schedule, because the user may add tickets mid-run with `/parallel-to-tickets`.

## Schedule

A ticket is **ready** when it's open, all its blockers are done, and none of its contenders is running. Whenever a slot is free, start ready tickets in map order until the limit is reached.

A running ticket holds a **lease** on the modules in its Changes until its PR merges.

If nothing is running and nothing is ready but open tickets remain, the map is inconsistent: there's a cycle, or a blocker that will never close. Stop and tell the user.

## Per ticket

1. Spawn a background sub-agent with `isolation: "worktree"` and the brief below. Fill in its lease note from the leases held right now.
2. Handle a hand-back that asks a question:
   - **An ambiguity:** relay it to the user. The ticket keeps its slot and leases while it waits, and the other agents carry on.
   - **A lease conflict:** the agent needs a module leased to another running agent. The ticket goes back to waiting and gives up its slot. Once that lease is released, resume the same agent with SendMessage: tell it to rebase onto `origin/main` and carry on. If two agents each wait on the other, stop and ask the user.
3. When it hands back with a PR, pass the gate in order:
   1. **Current:** if `main` has moved since the branch was cut, send the agent back to rebase onto `origin/main` and force-push with lease. It resolves any conflicts itself, using the `resolving-merge-conflicts` skill. If its intent clashes with a merged sibling's, it stops and you ask the user.
   2. **Green:** watch the checks with `gh pr checks <PR> --watch` in the background. If they go red, send the failure to the same agent.
   3. **No duplication:** spawn a fresh read-only agent to compare the PR's diff with every PR merged since its branch was cut. It looks for a piece that reimplements something now on `main`, or two new pieces that do one job. Keep only its verdict. If it finds anything, send the findings to the implementing agent to consolidate onto the existing piece, then run the gate again from step 1.
   4. **Merge** with the repo's merge method, or a merge commit if nothing says otherwise. If the branch requires an approving review, add `--admin`: every agent's `gh` is the PR's author, and GitHub never counts an author's own approval. The gate above already stands in for review. Close the ticket's issue with `gh issue close <N> --comment "Fixed by #<PR>."`, because GitHub doesn't close it from a PR merged this way. Release the ticket's leases, remove its worktree and local branch, and refresh the dev stack. If the agent reported modules or shared pieces its row didn't list, add them to the row. Tell the user in one line: the PR link, what it did, and that the stack is refreshed.
4. A slot and some leases are now free, so schedule again.

Once every ticket in the map is done, close the Epic with `gh issue close <E>`, then give the user a summary: each ticket, its PR, and anything that needed their input.

## Sub-agent brief

Fill in `<N>`, the Epic, the repo, the lease note and the ports. Add any environment gotchas from your memory that the agent can't find in the repo, such as how pushing works here. Give each running agent its own dev-server ports, other than the stack's :8080 and :5173, because agents sharing ports collide.

```
You are implementing GitHub issue #<N> in <owner/repo>, part of Epic #<E>. You are in your own git worktree; other agents are working on other tickets of the Epic at the same time in theirs. Before starting, read AGENTS.md / CLAUDE.md and the docs they point to. If a `gh` command fails with `HTTP 403: GitHub GraphQL is not available`, use its `gh api` equivalent from `docs/agents/issue-tracker.md`.

Leases: these modules are being changed by other agents right now: <module (#ticket), ...>. If your work needs to change one of them, stop and hand back, naming the module and why.

Dev servers: if you run any, use ports <ports>.

1. Read the issue and its comments (`gh issue view <N> --comments`), then Epic #<E>'s Notes and your ticket's row in its impact map. The row says what you're expected to change, create and use. Pieces listed under "Uses" already exist on main, so build on them.
2. Branch from the latest origin/main: `git fetch origin && git switch -c <prefix>/<N>-<slug> origin/main`, using the repo's branch naming. Install dependencies if the worktree has none.
3. Read `.claude/skills/implement/SKILL.md` and follow it fully for issue #<N>, including its code review. Fix what the review finds. Invoke the skills it names (such as `tdd` and `code-review`) with the Skill tool.
4. If the issue's wording is ambiguous, or conflicts with the domain docs or the existing code, stop and hand back. Give the exact ambiguity, the options, your recommendation, and what is committed or pushed so far. Everything the issue states clearly, carry on with.
5. Push the branch. Open a PR against main with `gh pr create`, write its body with the `pr` skill, and have it close the issue.
6. Tick the acceptance criteria your PR fulfils. Edit the issue body with `gh issue edit <N> --body-file`, keeping the temp file outside the repo. Change only those `- [ ]` to `- [x]`.
7. Leave the PR unmerged. The orchestrator merges it.

Final report: the branch, the PR URL, a summary of the changes, the check results (paste the actual output), which acceptance criteria you ticked and which you left unticked (with reasons), any review findings you didn't fix and why, and any module you changed or shared piece you created that your row didn't list.
```
