# Rhymes are worked out in the browser

The Rhymes suggested follow the word at the caret, which changes with every keystroke, so they're worked out in the browser, not asked of the server. The binary carries each Language's data (for English, from the CMU Pronouncing Dictionary) and serves it to the page once, where the browser keeps it. Rhymes, and each one's Syllable Count, then come instantly and need no request while the user types.

Asking the server for each word's Rhymes would keep the page lighter, but they would lag behind typing, and a slow or dropped connection would leave them stale. The cost of the browser approach is a download of about a megabyte, compressed, the first time a Song in that Language is written in. Moving the lookup back to the server later would mean rewriting both the data format and the Rhymes card's lookup.
