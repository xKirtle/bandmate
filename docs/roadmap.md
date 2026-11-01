# Roadmap

A wishlist of what Bandmate might do next, not a schedule or an order. Each idea is listed with any decisions already made, so the spec session for it starts from them. What's being built now is in the open issues, and once a feature ships it leaves this page, and its release notes record it. Terms are defined in [GLOSSARY.md](../GLOSSARY.md).

Each feature gets a spec, as an issue, before it's built. Using a new feature for real turns up fixes, and those come before the next feature starts.

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

## Track colours

- Each Track gets a Track Colour of its own automatically, so Clips on different Tracks can be told apart at a glance. Today every Clip is in the one accent colour.
- The Track keeps its colour however Tracks are added, deleted or reordered, and the user doesn't pick it. A later picker from the same set stays possible, if using the feature shows a need.
- Each Palette has its own shades of the set, in light and dark, so the colours follow the Palette, and a Track stores which colour of the set it has, not a colour value.
- There are six, enough for every Song so far without a repeat. A new Track gets the one least used on the Song's Tracks, ties going to the earliest in the set, so a Song's first Track is always the first colour. The first two are chosen with most care, as most Songs only ever show those.
- The Tracks a paste makes, and the one a Clip moves to when slowed by its Tempo, take the source Track's colour. The Track a Merge makes gets one like any new Track, and undoing a Track's deletion brings its colour back.
- Existing Tracks, older Backups and the Demo Song get theirs in one upgrade step, in order from the top of each Song.
- The colours stay muted so the Timeline doesn't take on the busy look of a DAW: only a Clip's border and waveform take the colour, and the Track header doesn't show it. They're held to the 3:1 contrast floor against a Clip's background all the same.
- The accent is left to what's active, so the Chosen Track's marking, the Selection and focus stay as they are, and the Clip being recorded stays in the danger colour. No Track Colour can be close to the accent.

## A language data project

- A someday idea, only worth it if a community grows around Bandmate and asks for Languages one maintainer can't look after; until then, Languages are added in Bandmate, as CONTRIBUTING's "Adding a rhyming language" says.
- A project of its own, beside Bandmate, that builds each Language's data as a pack, so every Language's quirks are worked out there and Bandmate's Rhymes stay the same for any Language. It's big enough to be its own project, and the more Languages it covers, the more quirks it holds. Today's builders of the English and Portuguese data, and of their common-word rankings, move into it.
- Above all, it should be easy for others to add a Language, so Languages can grow past what one maintainer can look after. Adding one should take only that Language's own work, its sources, its quirks and a list of words that must and mustn't rhyme to check it by, with nothing to change in the project's shared code or in Bandmate. CONTRIBUTING's "Adding a rhyming language" moves there too.
- Nothing like it exists yet, but ipa-dict comes closest: a community-built list of pronunciations, with stress, for about 30 Languages and variants. The project could take its pronunciations from there and send missing Languages and fixes upstream, so it only does what ipa-dict doesn't, and skips sources whose licence Bandmate can't ship, like ipa-dict's few CC BY-NC ones.
- Every pack has the same shape: its pronunciations, one word a line with its phonemes and stress, as the CMU Pronouncing Dictionary has English's, and credits for where each part came from. Everything else is optional: the ranking of common words, synonyms, antonyms, and whatever comes later. Bandmate offers what a Language's pack has, so a Language can start with pronunciations alone and grow.
- Synonyms would pair with Rhymes in Rhyme mode, for a word that has to mean one thing and rhyme with another. In Portuguese, they need a word's forms too, so "corri" finds the synonyms of "correr", in the same form.
- Whether Bandmate takes the packs when it's built, keeping Rhymes worked out in the browser (ADR 0018), or asks a service running beside it; how a pack lists its parts and which parts need which; which alphabet the phonemes are written in; how a Language is tested before it ships, and who looks after one once its contributor moves on; and whether the user downloads only some of a pack's parts, are for the spec.
