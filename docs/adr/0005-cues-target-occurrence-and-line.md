# Cues point to an Occurrence (and optionally one of its Lines), not to Section text

A Cue links a time on the Timeline to an Occurrence, or to one Line within an Occurrence. It never attaches to the Section or its text, because a shared Section (a chorus appearing three times) is sung at a different time in each Occurrence. Consequences:

- Line-level Cues rely on Lines keeping their identity when text is edited (the Lyric Sheet matches old and new Lines by a line-level diff).
- Editing a Line's text keeps its Cue. Deleting the Line drops it.
- Switching a Section's active Alternate clears the line-level Cues on its Occurrences and keeps the Occurrence-level ones.
- Detaching an Occurrence carries its Cues over to the copy.
- Restoring a Snapshot drops Cues whose Lines no longer exist.
