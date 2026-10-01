---
name: wishlist
description: Add ideas to the roadmap's wishlist in docs/roadmap.md, in its open wishlist PR. Use when the user hands over feature ideas to remember, or to grill later.
---

The user is jotting ideas down, not specifying them: record each one as they said it, and leave grilling it for its spec session.

Ideas collect in one open **wishlist PR**, labelled `documentation` and `no-release-notes` and titled "Add … to the wishlist". Only the user merges or closes it; until then, every new idea joins it.

1. Find the wishlist PR: `gh pr list --state open --label no-release-notes --json number,title,headRefName` and take the one whose title ends "to the wishlist". With one, check out its branch and pull. With none, branch from an up-to-date `main` as `docs/wishlist-<short-slug>`.

2. Read `CONTEXT.md` and `docs/roadmap.md`. For each idea, append a `## <Name>` section to `docs/roadmap.md`, matching the existing entries:
   - The heading names the feature as a noun phrase ("Merging Clips", "Playback speed").
   - Bullets say what it does, then why, using the user's own real-world case when they gave one ("after a bad Take, record again from the same place").
   - Write in the glossary's terms, and steer clear of each term's _Avoid_ words: the user's "mix" may be a Mixdown, or something new that needs a name of its own. Where an idea sits near an existing term or wishlist entry, say how it differs, or extend that entry instead of adding one.
   - What the user decided goes in as settled. Every question they left open goes in a closing "Whether …, and …, are for the spec." Settle nothing they didn't.

   If an idea is too unclear to name or to tell from an existing feature, ask before writing it.

   Done when every idea the user gave has its section, each open question you spotted is named in one, and the page still reads in the same voice.

3. Commit as "Add <ideas> to the wishlist", and push. Open the wishlist PR if there was none, with no issue: a wishlist entry changes no behaviour, so it skips the issue every other change gets. Either way, its title names every idea it now adds ("Add <ideas> to the wishlist"), and its body lists each in one bullet: its name in bold, what it does, and what's left to the spec.

4. Hand back the PR's link, each new idea in a line, and any naming choice you made for them, so the user can veto it.
