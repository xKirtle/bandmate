# Feature branches

A **feature branch** holds a feature the user hasn't decided to keep, whose design may still change: `feature/<slug>`, cut from `main` and pushed. Work goes there when the user says so. Its steps skip the per-change issue and PR that AGENTS.md asks for; the feature as a whole still gets one spec issue and, if it's kept, one PR.

## The spec

The feature has one spec issue, written with `to-spec`. Its steps live in that issue's `## Steps` task list, which `to-tickets` writes in place of separate issues: one `- [ ]` per step, in dependency order, each with what it delivers and its blockers. A step is ticked once it's merged into the feature branch.

When the design changes mid-way (a part is dropped, a step reworked), edit the spec and its Steps to say so, and comment on the issue with what changed and why. The spec stays the one record of the feature.

## Landing a step

1. Branch the step from the latest `origin/feature/<slug>`, in its own worktree.
2. Commit it there, and merge `origin/feature/<slug>` into it if the branch has moved.
3. Run the fast checks: every step of `.github/workflows/ci.yml`'s `test` job, locally. CI doesn't run on pushes to a feature branch, so these are the gate. The `e2e` and `bundle` jobs wait for the landing PR.
4. Once they pass, merge the step into the feature branch with `git merge --no-ff`, a message of `Merge step: <step title>`, and push the feature branch.
5. Tick the step in the spec.

## Keeping up with main

Merge `origin/main` into the feature branch whenever `main` gains something the feature touches, and before landing. Merge, never rebase: the branch is pushed and shared with the step worktrees.

## Keeping or dropping the feature

- **Kept:** open one PR from `feature/<slug>` to `main` that closes the spec, titled and labelled as CONTRIBUTING says, its body written with the `pr` skill. It merges like any other PR, through the full CI. Tick the spec's acceptance criteria it meets.
- **Dropped:** close the spec as not planned, with a comment saying why. Leave the branch pushed: it's the record of what was tried.
