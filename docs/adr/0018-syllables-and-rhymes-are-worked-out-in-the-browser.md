# Syllable Counts and Rhymes are worked out in the browser

A Line's Syllable Count changes with every keystroke, so it's worked out in the browser, not asked of the server. The binary carries each Language's data (for English, from the CMU Pronouncing Dictionary) and serves it to the page once, where the browser keeps it. Counts and Rhymes then come instantly and need no request while the user types.

Asking the server for each Line's count would keep the page lighter, but the counts would lag behind typing, and a slow or dropped connection would leave them stale. The cost of the browser approach is a download of about a megabyte, compressed, the first time a Song in that Language is written in. Moving the lookup back to the server later would mean rewriting both the data format and every place that shows a count.
