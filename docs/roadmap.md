# Roadmap

A wishlist of what Bandmate might do next, not a schedule or an order. Each idea is listed with any decisions already made, so the spec session for it starts from them. What's being built now is in the open issues, and once a feature ships it leaves this page, and its release notes record it. Terms are defined in [CONTEXT.md](../CONTEXT.md).

Each feature gets a spec, as an issue, before it's built. Using a new feature for real turns up fixes, and those come before the next feature starts.

## Rebinding Shortcuts

- Every Shortcut can be rebound, including the ones that follow a convention (the ruler's arrows, Shift+F10, Ctrl+wheel) and the mouse ones (the Alt in Alt+drag). Rebinding happens in the Song page's shortcuts dialog, and is kept per device, like the Latency Offset and the Input.
- Shortcuts are unique across the Song page, wherever each one works. A key already taken is refused, naming the Shortcut that has it ("Already used by Record"); nothing is swapped or unbound behind the user's back. "Reset to defaults" puts every Shortcut back.
- Some keys can't be chosen, and the dialog says so: Tab and Shift+Tab, Esc, a bare Enter or Space, and the browser's own shortcuts a page can't take (Ctrl+W, Ctrl+T, Ctrl+N, Ctrl+Tab…). A Shortcut whose default is one of them can still be set back to it. Arrows can be taken, even from the controls that use them.
- A key is its exact modifiers: Shift+R isn't R. Ctrl on Windows and Linux and ⌘ on a Mac are one modifier, and either works everywhere. A Shift variant is a Shortcut of its own (seeking back 5 s and 15 s), so each is rebound on its own. Pinching always zooms, whatever Ctrl+wheel is rebound to.

## Snapshots

- **Snapshots** cover the whole Lyric Sheet. They're taken automatically (e.g. after a pause in editing, thinned out over time) and can be named by hand. Restoring one first snapshots the current Lyric Sheet, so a restore can always be undone.
- They're the way back from unwanted edits, since saving is automatic and Read mode only decides when editing is offered.
- The Lyric Sheet's structure (deleting a Section, reordering, switching an Alternate, moving to or from the Scrapbook) has no undo. With dormant Cues (ADR 0007) an Alternate switch is undone by switching back; whether Snapshots cover the rest, or it gets an undo of its own, is for this spec to decide.

## ChordPro export

- It covers the Arrangement's active Alternates. Scrapbook Sections are left out.

## A count-in or click

- From the Song's BPM, for recording without a Beat, so a Beat added later can line up.

## Cues on Masters

- The Line highlight following a studio recording, as it follows the Timeline.

## Detecting a Beat's BPM and key

- From the audio itself, to pre-fill the Beat's details at upload.

## A backup before migrating

- Copy the database before a release's migrations run, so rolling back never depends on remembering to take a backup first.

## Real-time sync between tabs and devices

- Today a tab refetches the Song when it becomes visible again, and a write based on an old version is rejected.

## Playback in step with what's heard

- Show the playhead, the Line highlight and Sync mode's "Now" where the audio is heard, by the output latency the browser reports. It's unnoticeable through an interface, but 150–250 ms late over Bluetooth. A tap test to correct it, only if the reported figure proves off.

## A tutorial

- A first-time walkthrough of Bandmate. It can be dismissed, and taken again whenever the user wants.
- It comes with a demo Song and Beat to work through, created when the user asks for them, from audio built into the binary. A migration would add them to every existing install on upgrade, and a Beat's audio is a file in the data directory, not a row, so SQL alone can't ship it. Created on request, a deleted demo can be added again. The Beat's audio needs a licence that allows shipping it.

## Hear a Chord in the Chord Finder

- A synthesised strum of a Voicing being looked up, or of a suggested Chord, to hear it before playing it. The sound is made in the browser, like the rest of the Chord Finder, with no samples to download.
- Which Voicing a suggested Chord is strummed with, and whether it can be arpeggiated too, are for the spec.

## Playback speed

- Slow the Timeline down, or speed it up, without changing its pitch, for learning a part, especially over a Loop.
- Whether Masters and Beat previews get it too is for the spec.

## Printing a Song

- A print layout for the Lyric Sheet, with its Chords, for a music stand.

## Syllable counts and rhymes

- Each Line shows its syllable count, to keep the meter matching across verses and between Alternates. Rhymes are suggested for a word.
- Both work offline, from data built into the binary, since the update check stays Bandmate's only outbound call. English comes first, from the CMU Pronouncing Dictionary. Each language is data Bandmate loads, so others can follow: by spelling rules where a language is spelled as it sounds, or from Wiktionary's pronunciations.
- A Song's Details gain its languages, more than one if it mixes them. How a Line in a mixed Song picks its language (each word looked up in each of the Song's languages, or a language set per Section) is for the spec.

## Scheduled Backups

- Backups made on a schedule (say, Everything weekly), not only when the user makes one. Scheduled ones can keep only the last N, which hand-made Backups never do: nothing deletes a Backup the user made.

## A lyric size for Read mode

- Make the Lines and Chords larger or smaller in Read mode (A− and A+), kept per device, for reading from a music stand or a phone at whatever distance it sits. It builds on the larger default Read mode gets from the visual identity (#565).
- Whether the Chord Chart and the Section Labels follow the size, and how far it goes each way, are for the spec.

## Every device setting in Settings

- The Settings tab (#578) starts with the Palette and System, Light or Dark. The other settings kept per device, such as the Latency Offset, the Input and left-handed Chord diagrams, could be listed there too, so there's one place to find them.
- Whether they also stay where they're used today is for the spec.

## Track colours

- Each Track gets a muted colour of its own, assigned automatically from a small palette in the visual identity's tokens, so Clips on different Tracks can be told apart at a glance. Today every Clip is in the one accent colour.
- The colours stay muted so the Timeline doesn't take on the busy look of a DAW. Whether the user can pick a Track's colour, and how the Chosen Track still stands out, are for the spec.

## Song tags

- Songs carry tags of the user's own (e.g. "Album 2023"), to mark them with what's relevant and find them by it. A Song can have any number of tags, where it sits in only one folder, so tags are how a Song belongs to several groups at once.
- They aren't a Section's Label, which names a block of Lines within a Song.
- Whether a tag is free text or picked from tags already used, whether the Songs page filters by them, and whether tags have colours, are for the spec.

## The Left-handed toggle on a phone

- At phone width, the Chord Finder's Left-handed toggle doesn't fit beside its tabs and drops onto a line of its own, which looks like an afterthought. It wants a place that feels deliberate on a phone, without losing the one-tap toggle on desktop.
- It's a different thing from listing left-handed Chord diagrams in Settings (see Every device setting in Settings), though moving it there is one way out.
- Where it goes instead (beside the tuning, in an overflow menu, as an icon, or only in Settings on a phone), and whether the tabs themselves change at that width, are for the spec.
