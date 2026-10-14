# The Demo is a hidden Song restored from a built-in Backup

The Tour shows a Demo Song and Demo Beat (#986, #1001). They're an ordinary Song and Beat on the server, marked as the demo, and every list leaves them out: the Songs page, the Beat Library and Beat Picker, Backups, Folders, Tags and search. They come from a one-Song Backup built into the binary. Each time the Tour starts, that Backup is restored over them, so a newer Bandmate's Demo replaces an older one. The Demo is seen only during the Tour, which blocks the page under it, so nothing ever changes it.

A demo held only in the browser was the alternative. The Song page loads everything through the server, though: the Song, its Timeline and the Beat's audio. Running it on data held in the browser would be a second way for the page to load, and it would drift from the first. Seeding code that builds the Song and Beat through the stores was the other option. It would have to grow with every change to how a Song is stored, and it would need the Beat's duration and peaks worked out ahead of time, since the server doesn't decode audio. A Backup already holds a Song with its Timeline and the Beats it uses, and a newer Bandmate restores an older one, so the built-in Backup keeps working through upgrades without being touched.

Putting the Demo in the user's Songs was rejected: a newcomer's first Song shouldn't be one they didn't write.

The cost is a rule: anything new that lists, counts, backs up or changes Songs or Beats across the install must leave the Demo out. Scheduled Backups, for one, mustn't count restoring it as a change.
