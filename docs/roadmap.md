# Roadmap

A wishlist of what Bandmate might do next, not a schedule or an order. Each idea is listed with any decisions already made, so the spec session for it starts from them. What's being built now is in the open issues, and once a feature ships it leaves this page, and its release notes record it. Terms are defined in [GLOSSARY.md](../GLOSSARY.md).

Each feature gets a spec, as an issue, before it's built. Using a new feature for real turns up fixes, and those come before the next feature starts.

## Rebinding Shortcuts

- Every Shortcut can be rebound, including the ones that follow a convention (the ruler's arrows, Shift+F10, Ctrl+wheel) and the mouse ones (the Alt in Alt+drag). Rebinding happens in the Song page's shortcuts dialog, and is kept per device, like the Latency Offset and the Input.
- Shortcuts are unique across the Song page, wherever each one works. A key already taken is refused, naming the Shortcut that has it ("Already used by Record"); nothing is swapped or unbound behind the user's back. "Reset to defaults" puts every Shortcut back.
- Some keys can't be chosen, and the dialog says so: Tab and Shift+Tab, Esc, a bare Enter or Space, and the browser's own shortcuts a page can't take (Ctrl+W, Ctrl+T, Ctrl+N, Ctrl+Tab…). A Shortcut whose default is one of them can still be set back to it. Arrows can be taken, even from the controls that use them.
- A key is its exact modifiers: Shift+R isn't R. Ctrl on Windows and Linux and ⌘ on a Mac are one modifier, and either works everywhere. A Shift variant is a Shortcut of its own (seeking back 5 s and 15 s), so each is rebound on its own. Pinching always zooms, whatever Ctrl+wheel is rebound to.

## A count-in or click

- From the Song's BPM, for recording without a Beat, so a Beat added later can line up.

## Cues on Masters

- The Line highlight following a studio recording, as it follows the Timeline.

## Detecting a Beat's BPM and key

- From the audio itself, to pre-fill the Beat's details at upload.

## Real-time sync between tabs and devices

- Today a tab refetches the Song when it becomes visible again, and a write based on an old version is rejected.

## Playback in step with what's heard

- Show the playhead, the Line highlight and Sync mode's "Now" where the audio is heard, by the output latency the browser reports. It's unnoticeable through an interface, but 150–250 ms late over Bluetooth. A tap test to correct it, only if the reported figure proves off.

## Playback speed

- Slow the Timeline down, or speed it up, without changing its pitch, for learning a part, especially over a Loop.
- Whether Masters and Beat previews get it too is for the spec.

## Printing a Song

- A print layout for the Lyric Sheet, with its Chords, for a music stand.

## Track colours

- Each Track gets a muted colour of its own, assigned automatically from a small palette in the visual identity's tokens, so Clips on different Tracks can be told apart at a glance. Today every Clip is in the one accent colour.
- The colours stay muted so the Timeline doesn't take on the busy look of a DAW. Whether the user can pick a Track's colour, and how the Chosen Track still stands out, are for the spec.

## Rhymes by sound, not spelling

- Every rhyming dictionary but English's turns each word into how it's said before pairing Rhymes, so a Rhyme is matched on its sounds, as the glossary defines it. English is the exception because its dictionary came with pronunciations, so it goes by sound already. The Portuguese one pairs words by how they're written, so "depois" and "heróis" come up as perfect Rhymes, though "ois" and the open "óis" sound quite different.
- European and Brazilian Portuguese sound different, so they're separate Languages, each with a dictionary of its own.
- Candidate sources for the pronunciations: WikiPron, Wiktionary's pronunciations split by Language and variant (Brazil and Portugal apart), likely CC BY-SA; ipa-dict, MIT; the Montreal Forced Aligner's dictionaries, with both Portugueses; and eSpeak NG, GPL-3, which works a pronunciation out from spelling for any word, run once when the dictionary is built. One idea: Wiktionary's pronunciation where there is one, as it gets open and closed vowels right, and eSpeak NG's for the rest.
- It's the first job of the language data project below. Which sources each Language uses, and what becomes of Songs already sung in Portuguese, are for the spec.

## A language data project

- A project of its own, beside Bandmate, that builds each Language's data as a pack, so every Language's quirks are worked out there and Bandmate's Rhymes stay the same for any Language. It's big enough to be its own project, and the more Languages it covers, the more quirks it holds. Today's builders of the English and Portuguese data, and of their common-word rankings, move into it.
- Every pack has the same shape: its pronunciations, one word a line with its phonemes and stress, as the CMU Pronouncing Dictionary has English's, and credits for where each part came from. Everything else is optional: the ranking of common words, synonyms, antonyms, and whatever comes later. Bandmate offers what a Language's pack has, so a Language can start with pronunciations alone and grow.
- Synonyms would pair with Rhymes in Rhyme mode, for a word that has to mean one thing and rhyme with another. In Portuguese, they need a word's forms too, so "corri" finds the synonyms of "correr", in the same form.
- Whether Bandmate takes the packs when it's built, keeping Rhymes worked out in the browser (ADR 0018), or asks a service running beside it; how a pack lists its parts and which parts need which; which alphabet the phonemes are written in; how a Language is tested before it ships; and whether the user downloads only some of a pack's parts, are for the spec.
