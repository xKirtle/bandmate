---
name: retake-screenshots
description: Retake the README's screenshots and animation from a fresh demo Bandmate, and merge them to main through an issue and a PR.
disable-model-invocation: true
---

If a `gh` command fails with `HTTP 403: GitHub GraphQL is not available`, use its `gh api` (REST) equivalent from `docs/agents/issue-tracker.md` instead.

`docs/screenshots/README.md` owns the capture: what each image shows, the tools it needs, and the steps under "Retaking them". Read it first. This skill wraps those steps in an issue and a PR, and changes where they run. Instructions the user gives with the skill, such as retaking only some images, take precedence.

## 1. Tools

Check every tool the README lists is installed, including `ffmpeg`'s `libwebp_anim` encoder. If Chromium isn't at the script's default path, point `CHROMIUM` at any Chromium-based browser on the machine. If a tool is missing, stop here and tell the user what to install.

## 2. Issue

File an issue labelled `ready-for-agent`, titled "Retake the README's screenshots", with the `to-tickets` issue template. It delivers screenshots and an animation that show the current UI. Its criterion is that each image shows what the README's table says it shows.

## 3. Capture

Branch from the latest `origin/main` as `docs/<N>-retake-screenshots`.

Run the README's steps against a **fresh** Bandmate of your own, on :8095 with an empty data directory in your scratchpad, so a dev stack on :8080 stays untouched:

- Bandmate: `BANDMATE_ADDR=:8095` and `BANDMATE_DATA_DIR=<scratchpad dir>`.
- Seed: `-url http://localhost:8095`.
- Capture: `BANDMATE_URL=http://localhost:8095`.

Capturing changes the demo, so every retry starts from a new empty data directory. Once the capture is done, stop Bandmate by killing the pid holding :8095 as well as the background command: `go run` leaves its `bandmate` binary listening.

## 4. Check

Open every new image with the Read tool beside its version on `main` (`git show origin/main:docs/screenshots/<file>`), and for `sync-mode.webp` a few frames pulled out with `ffmpeg`. The step is done when each image shows exactly what its row in the README's table describes, fully loaded, in the dark theme. Fix the cause of any image that falls short, and capture again.

If no image changed in a way a reader would notice, end here: discard the changes, close the issue with a comment that the screenshots are current, and tell the user.

## 5. PR

Commit only the images, push, and open a PR against `main` that closes the issue. Title it "Retake the README's screenshots" plus what changed in them, and label it `documentation` and `no-release-notes`. Write the body with the `pr` skill; its evidence is each changed image before and after, linked as `https://raw.githubusercontent.com/xKirtle/bandmate/<sha>/docs/screenshots/<file>` from `main`'s commit and the branch's. Then tick the issue's criteria the PR meets.

## 6. Merge

Watch the checks with `gh pr checks <PR> --watch` in the background, fixing and pushing again if they go red. Once they're green, merge with `gh pr merge <PR> --merge --delete-branch` and `git pull --ff-only` on `main`.

Report the PR link and which images changed.
