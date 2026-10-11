# Syllable counts and rhymes

In Write mode, Bandmate counts the syllables of each line as you type, so you can keep the meter without counting on your fingers: check that verse 2 sings like verse 1, or that an alternate fits where the one it competes with sat. It also suggests rhymes for the word you're writing, so you needn't look them up elsewhere.

## Where the counts show

Each line's count sits in a muted column to the left of the line, so the counts line up down a section and you can compare them at a glance.

The counts also show beside each line when you choose between a section's [alternates](/features#write), and on the cards in the Scrapbook, so you can see whether a loose idea fits a section before you move it in.

Read mode doesn't show them: it stays as it was, to play from.

## What's counted

- **Chords aren't**: `[Am]Hello` counts as two syllables.
- **A line of chords alone, or a blank line,** gets no count.
- **A hyphenated word** counts as its parts: "ooh-ooh" counts like "ooh ooh".
- **English words** are looked up in the [CMU Pronouncing Dictionary](https://github.com/cmusphinx/cmudict), which knows over 130,000 of them.
- **Portuguese words** are counted by Portuguese spelling rules, syllable by syllable as they're written: "coração" counts three, "saudade" three and "dia" two. Words aren't run together where one ends in a vowel and the next starts with one, so count those you sing as one syllable yourself.

## Estimates

A word Bandmate can't read, like slang, a name or "skrrt" in an English song, or a word with no vowel in a Portuguese one, is guessed from its spelling. A number in digits, like "24", is counted as it's usually said in the song's first language. Either way, the line's count shows as an estimate, such as `~7`, so you know not to trust it exactly.

The counts are only numbers: nothing flags a line whose meter doesn't match, as you may change the meter on purpose.

## Rhymes

Rhymes are suggested for the word at the cursor in the line you're writing, or for the line's last word once the cursor is past it.

- **Perfect rhymes** come first: they sound the same from the word's last stressed vowel to its end, like "night" and "tonight".
- **Near rhymes** follow, in a group of their own: only their vowels match from there, like "night" and "life".

Each rhyme shows its syllable count beside it, and those nearest your word in syllables come first, so you can pick one that fits the meter. The suggestions are only there to read: clicking one never changes your lyrics.

- **English rhymes** come from the dictionary, so a word it doesn't know gets none.
- **Portuguese rhymes** come from a Portuguese word list, plurals and verb tenses included, and any Portuguese word gets them: "coração" rhymes with "canção", and "saudade" with "cidade". Endings spelt differently but said alike rhyme too, like "dança" and "cansa".

In a song with more than one language, a word's rhymes are in the language it's read in (see [Languages](#languages)), never mixing the two. To see rhymes for it in another of the song's languages, pick that language above the rhymes in the Rhymes card.

Where they show depends on how wide the window is:

- **On a wide window**, a **Rhymes** card sits beside the lyric sheet, above the Scrapbook. It folds away like the Scrapbook, and keeps showing the last word once you click elsewhere. To look up any other word, type it into its field.
- **On a phone, a tablet or a smaller window**, a strip of rhymes docks at the bottom of the screen while you're typing a line, above the on-screen keyboard. Swipe it sideways for more. It goes once you leave the line.

## Languages

Bandmate counts in the languages set in the song's details, which start as English. It knows English and Portuguese.

A song can be in both. Then each word is read in the language it belongs to: a word the English dictionary knows is counted as English, and any other word by Portuguese spelling rules, whichever order the languages are in. So a Portuguese word the English dictionary also lists is counted as English, and its count may be off: "eu" counts two, as the letters E.U.

## Turning them off

**Writing aids**, in the lyric sheet's toolbar in Write mode, turns the counts and rhymes on and off together, for every song. It's on to start with. Each device keeps its own choice, which is also in **Settings**, under **This device**.

## Offline

The counts and rhymes need no internet connection: the dictionary comes with Bandmate. The first time you write a song in English, your browser downloads the dictionary from your Bandmate, about a megabyte, once. The first time you write one in Portuguese, it downloads the Portuguese word list the same way, a little under a megabyte. While Writing aids is off, it downloads nothing.
