---
name: wishlist
description: Add ideas to the roadmap's wishlist in docs/roadmap.md and open a PR for them. Use when the user hands over feature ideas to remember, or to grill later.
---

The user is jotting ideas down, not specifying them: record each one as they said it, and leave grilling it for its spec session.

1. Branch from an up-to-date `main` as `docs/wishlist-<short-slug>`.

2. Read `CONTEXT.md` and `docs/roadmap.md`. For each idea, append a `## <Name>` section to `docs/roadmap.md`, matching the existing entries:
   - The heading names the feature as a noun phrase ("Merging Clips", "Playback speed").
   - Bullets say what it does, then why, using the user's own real-world case when they gave one ("after a bad Take, record again from the same place").
   - Write in the glossary's terms, and steer clear of each term's _Avoid_ words: the user's "mix" may be a Mixdown, or something new that needs a name of its own. Where an idea sits near an existing term or wishlist entry, say how it differs, or extend that entry instead of adding one.
   - What the user decided goes in as settled. Every question they left open goes in a closing "Whether …, and …, are for the spec." Settle nothing they didn't.

   If an idea is too unclear to name or to tell from an existing feature, ask before writing it.

   Done when every idea the user gave has its section, each open question you spotted is named in one, and the page still reads in the same voice.

3. Commit as "Add <ideas> to the wishlist". Push, and open a PR with the same title, labelled `documentation` and `no-release-notes`, with no issue: a wishlist entry changes no behaviour, so it skips the issue every other change gets. The body lists each idea in one bullet: its name in bold, what it does, and what's left to the spec.

4. Leave the PR open for the user to merge. Hand back its link, each idea in a line, and any naming choice you made for them, so they can veto it.
