# Rhymes

In Write mode, Bandmate can suggest rhymes for the word you're writing, so you needn't look them up elsewhere.

## Setting up dictionaries

Rhymes come from a dictionary for each language, which you set up on each device you write on: open **Settings → Writing**, on the This device tab, and click **Set up** beside each language you write in. It lists each one's download size, whether it's set up on this device, and when it was last updated. **Remove** takes one off the device.

Until you set one up, Bandmate downloads nothing, and the Rhymes card links to Settings to set it up.

## Turning them on

Click **Rhymes**, beside **Sync lyrics** in the lyric sheet's toolbar, and click it again when you're done. Rhymes need a wide window, like a desktop's: on a phone, a tablet or a smaller window, the button isn't there.

Rhymes start off each time you open a song, and go off when you switch to Read mode or the window gets too narrow. They can't be on while you [sync lyrics](/features#sync): turning one on turns the other off.

While they're on, a **Rhymes** card sits beside the lyric sheet, above the Scrapbook. It folds away like the Scrapbook.

It shows rhymes for the word at the cursor in the line you're writing, or for the line's last word once the cursor is past it, and keeps showing that word once you click elsewhere. To look up any other word, type it into its field.

## What's suggested

- **Perfect rhymes** come first: they sound the same from the word's last stressed vowel to its end, like "night" and "tonight".
- **Near rhymes** follow, in a group of their own: only their vowels match from there, like "night" and "life".

In each group, the most common words come first, so "wrong" suggests "long", "song" and "strong" before rare words and names. How common a word is comes from [FrequencyWords](https://github.com/hermitdave/FrequencyWords), which counts how often each word is said in film and TV subtitles. Words too rare to be counted come last.

Each rhyme shows how many syllables it has, so you can pick one that fits the meter. The suggestions are only there to read: clicking one never changes your lyrics.

- **English rhymes** come from the [CMU Pronouncing Dictionary](https://github.com/cmusphinx/cmudict), which knows over 130,000 words, so a word it doesn't know gets none.
- **Portuguese rhymes** come from a Portuguese word list, plurals and verb tenses included, and any Portuguese word gets them: "coração" rhymes with "canção", and "saudade" with "cidade". Endings spelt differently but said alike rhyme too, like "dança" and "cansa". Their syllables are counted as they're written: "coração" has three, and "dia" two.

## Languages

Bandmate suggests rhymes in the languages set in the song's details, which start as English. It knows English and Portuguese. You can pick either for a song, whether or not its dictionary is set up on this device.

A song can be in both. Then a word's rhymes are in the first of the song's languages, in their order, whose dictionary has the word, never mixing the two. So with English first, a word both dictionaries have, like "eu", gets English rhymes, and with Portuguese first, Portuguese ones. To see rhymes for a word in another of the song's languages, pick that language above the rhymes in the Rhymes card.

A word in none of the dictionaries:

- **When all the song's languages are set up**, it gets rhymes guessed from its spelling, in Portuguese if the song is in Portuguese, and the card says they're a guess. A song only in English has none for it.
- **When some aren't set up**, Bandmate doesn't guess: the card says which dictionaries it isn't in, and links to Settings to set up the others, so you can look it up there.

In the Rhymes card, a language that isn't set up shows a link to Settings in place of rhymes.

## Offline

Rhymes need no internet connection: the dictionaries come with Bandmate. Setting one up downloads it from your Bandmate once, about a megabyte, and your browser keeps it, so rhymes work offline and after you reload. When you upgrade Bandmate and a dictionary has changed, it updates itself the next time you use it.
