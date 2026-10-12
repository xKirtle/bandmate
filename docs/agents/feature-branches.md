# Feature branches

A **feature branch** holds a feature the user hasn't decided to keep, whose design may still change: `feature/<slug>`, cut from `main` and pushed. Work goes there when the user says so. Its tickets get no PR of their own: each lands on the feature branch, and the feature reaches `main` in one PR, if it's kept.

## Issues

The feature has a spec issue (`to-spec`) and its tickets (`to-tickets`), made as for any other work. When the design changes mid-way (a part is dropped, a step reworked), edit the spec and the open tickets to say so, comment on the spec with what changed and why, and make new tickets for new work.

A ticket stays open until the feature lands. It's **done** once it's merged into the feature branch: its met acceptance criteria are ticked, and it has a comment saying so.

## Landing a ticket

1. Branch it from the latest `origin/feature/<slug>`, in its own worktree, named as for a PR.
2. Commit it there, and merge `origin/feature/<slug>` into it if the branch has moved.
3. Run the fast checks: every step of `.github/workflows/ci.yml`'s `test` job, locally. CI doesn't run on pushes to a feature branch, so these are the gate. The `e2e` and `bundle` jobs wait for the landing PR.
4. Once they pass, merge it into the feature branch with `git merge --no-ff`, a message of `Merge #<N>: <ticket title>`, and push the feature branch.
5. Tick the ticket's met acceptance criteria, and comment on it: `Merged into feature/<slug> in <short sha>.`

## Keeping up with main

Merge `origin/main` into the feature branch whenever `main` gains something the feature touches, and before landing. Merge, never rebase: the branch is pushed and the ticket branches are cut from it.

## Keeping or dropping the feature

- **Kept:** open one PR from `feature/<slug>` to `main`, titled and labelled as CONTRIBUTING says, its body written with the `pr` skill. It closes the spec and every done ticket, one `Closes #<N>` line each, so they close when it merges. Tickets dropped along the way are closed as not planned before it. It merges like any other PR, through the full CI. Tick the spec's acceptance criteria it meets.
- **Dropped:** close the spec and its open tickets as not planned, with a comment on the spec saying why. Leave the branch pushed: it's the record of what was tried.
