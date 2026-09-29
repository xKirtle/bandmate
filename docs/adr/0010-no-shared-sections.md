# No shared Sections: a Section appears once, and Cues live on its Lines

Supersedes ADR 0005's reasoning. A Section used to be able to appear several times in the Arrangement as Occurrences sharing its Lines, so editing a chorus once changed every chorus. Now each Section appears at most once, a repeat is a Duplicate (an independent copy), and the Occurrence is gone from the model: the Arrangement is an order over Sections.

Sharing was the root of most of the Lyric Sheet's complexity. Because one Line was sung at several times, a Cue had to point to an Occurrence and a Line (ADR 0005). That in turn meant Detach, a Shared badge, per-Occurrence copies of dormant Cues, and Cues dropped whenever a Section or Alternate went to the Scrapbook or joined another Section, since there was no Occurrence left for them to belong to. What sharing saved was copy-pasting a changed chorus into its repeats, which is quick even for four or five of them.

Without sharing, a Line is sung at one time, so a Cue lives on the Line itself. Cues then go wherever their Lines go, into the Scrapbook, back out, and into another Section as an Alternate, where they lie dormant (ADR 0007) and may be out of order once made active. Nothing written or synced is lost by moving it. A Duplicate copies Lines but not Cues, since the copy is sung at another time: timings belong to one place in the Song, and a second version of the same place is an Alternate.

Considered and rejected: keeping sharing and storing Cues as offsets from the start of their Section plus a start time per Occurrence. It would let Cues travel with Lines while keeping sharing, but assumes a shared Section is sung at the same pace every time and would have reversed ADR 0009 and reworked Sync mode.

Existing shared Sections are split by keeping each one's first appearance and deleting the others, as the app was still in development and its data disposable. Paste-import no longer shares either: a repeated labelled Section becomes its own Section, and a heading on its own becomes a Duplicate of the most recent Section with that Label.
