# Takes keep a frozen copy of the lyrics they were sung with

When a Take is recorded, it stores a copy of the lyrics that were active at that moment, instead of pointing at Alternates or Lines in the Lyric Sheet. The Lyric Sheet keeps changing after recording (Alternates are switched or deleted, Sections Detached, Snapshots restored), and pointers would leave Takes referring to text that no longer exists. The copy costs a few KB per Take and removes every dangling-reference edge case between Takes and the Lyric Sheet. The deliberate duplication is not a normalisation bug to "fix".

_(Sections are no longer shared or Detached since ADR 0010. The copy is still the right choice: Alternates are still switched and deleted, and Snapshots restored.)_
