---
name: parallel-to-tickets
description: Break a plan, spec or conversation into tickets as /to-tickets does, grouped under an Epic whose impact map lets /parallel-orchestrate run them in parallel. Pass an Epic to add tickets to it.
disable-model-invocation: true
---

Read `.claude/skills/to-tickets/SKILL.md` and follow it with the amendments below. Where the two differ, the amendments win.

## The Epic

An **Epic** is the parent issue of a set of tickets, labelled `epic`. Its **impact map** is the one record `/parallel-orchestrate` schedules from, and the scheduler trusts it without reading the code. Pick the Epic before step 1:

- **An Epic passed as the argument:** read it, including its map and its sub-issues. You are adding tickets to it.
- **No argument, but a spec was published in this conversation:** that spec becomes the Epic.
- **Neither:** you'll create a new Epic when you publish.

## Map rows (amends step 3)

For each new ticket, draft a row for the impact map alongside its blocking edges:

- **Changes:** the modules or areas it modifies, named as the codebase and glossary name them (a component, a module, a package, a route). Use names rather than file paths, since paths go stale. Reuse the exact names already in the map, and coin a new name only for a module the map doesn't have yet. Contention is spotted by matching names, so one module under two names hides a collision.
- **Creates:** shared pieces it introduces that other code could reuse: a helper, a component, an endpoint, a schema.
- **Uses:** shared pieces it relies on that it doesn't create itself.
- **Blocked by:** its blocking edges, the same ones its ticket declares.

Explore the code as far as it takes to get these right.

**Foundations.** If a ticket uses a piece that another ticket creates, it's blocked by that ticket, directly or through others. If two or more tickets would each need a shared piece that doesn't exist yet, give that piece its own foundation ticket, and make it block every ticket that uses the piece. Then no two tickets build the same piece.

**Contention.** Two open tickets contend when their Changes share a module and neither blocks the other, directly or through others. The scheduler runs contending tickets one after the other. Count a shared module as an overlap even when the two changes look unrelated. If splitting a ticket along module lines would remove an overlap and still keep it a vertical slice, prefer the split.

## Quiz (amends step 4)

Show each new ticket's row alongside its blockers. List every contention, including those with open tickets already in the map. Then give a **wave preview**: the open tickets that could run together first. Also ask the user whether the rows and contentions are right.

## Publish (amends step 5)

0. **Land the docs first.** Before creating the Epic or any ticket, check for documentation changes made while planning that aren't merged yet: the glossary (`CONTEXT.md`, `CONTEXT-MAP.md`), ADRs, the roadmap, and any other docs the conversation changed. Look in `git status` and at commits not yet on the default branch. If there are any, first open a **docs issue** labelled `documentation` (create the label if the repo lacks it), titled for what the docs settle, with a body listing each doc changed and what it now says. Then follow the repo's own conventions (formatting, commit attribution) and put the changes on a branch of their own. Commit them, push, open a PR that closes the docs issue, and merge it. After the merge, close the docs issue with `gh issue close <D> --comment "Merged in #<PR>."` if it's still open. If branch protection makes the merge wait on checks, use auto-merge and wait for the merge to complete. If it also requires an approving review, auto-merge would wait forever, because GitHub never counts the author's own approval. Instead, watch the checks until they pass, then merge with `--admin` to bypass the review. Checks gate every merge; admin rights bypass only the review. A docs-only PR often skips the heavy CI jobs, but a gating job (e.g. a `changes` job that decides from the diff whether further jobs need to run) still runs every time. Expect the skipped jobs to show as "skipping" rather than "pass", and wait only for the gating job; the merge usually goes through within seconds. Then pull the default branch. If the PR can't be merged, stop and ask the user before publishing anything. Tickets and the Epic may point readers at the merged docs, but never at wording that's still unmerged.

1. **The Epic.** If you're creating a new one, give it the `epic` label, a title naming the work, and this body:

   ```
   ## Goal

   <one paragraph: what this set of tickets achieves together>

   ## Notes

   <findings that bear on several tickets: shared constraints, gotchas, decisions from grilling. Omit the section if there are none.>

   ## Impact map

   | Ticket | Changes | Creates | Uses | Blocked by |
   | ------ | ------- | ------- | ---- | ---------- |
   ```

   If the Epic is a spec, add the `epic` label, and append the Notes and Impact map sections to its body without changing the rest of it.

   If step 0 opened a docs issue, Notes starts with `Docs: #<D>, merged in #<PR>.`, and keeps the section even when nothing else goes in it. When adding tickets to an existing Epic, add the new docs issue to that line. Don't link the docs issue as a sub-issue: it isn't a ticket and has no row in the map.

2. **The tickets.** Publish them in dependency order, as `to-tickets` does, with the Epic as their Parent. Link each one as a native sub-issue of the Epic (GitHub's sub-issues API, through `gh api`). If step 0 opened a docs issue, each ticket that relies on those docs adds `Docs: #<D>` under its Parent section.
3. **The map.** Add a row for each new ticket, as `| #<N> <title> | <modules> | <pieces> or — | <pieces> or — | #<N>, ... or — |`. Leave the existing rows as they are. Add to Notes if grilling turned up anything new that bears on several tickets.
