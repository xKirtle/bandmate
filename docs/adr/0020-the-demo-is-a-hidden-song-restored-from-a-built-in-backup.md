# The Demo is a hidden Song restored from a built-in Backup

The Tour works through a Demo Song and Demo Beat (#986). They're an ordinary Song and Beat on the server, marked as the demo, and every list leaves them out: the Songs page, the Beat Library and Beat Picker, Backups, Folders, Tags and search. They come from a one-Song Backup built into the binary, and each time the Tour starts that Backup is restored over them, so the Tour always starts from the same Demo, and whatever was recorded in it last time is thrown away.

A demo that lives only in the browser was the alternative, so that nothing is saved. The Song page is wired to the server throughout, though: saving with versions, Undo, Takes uploaded as they're recorded. Running it on data held in the browser would be a second way for every part of the page to work, and it would drift from the first. Seeding code that builds the Song and Beat through the stores was the other option, but it would have to grow with every change to how a Song is stored, and it would need the Beat's duration and peaks worked out ahead of time, since the server doesn't decode audio. A Backup already holds a Song with its Timeline and the Beats it uses, and a newer Bandmate restores an older one, so the built-in Backup keeps working through upgrades without being touched.

Putting the Demo in the user's Songs was rejected: a newcomer's first Song shouldn't be one they didn't write, and taking the Tour again would leave copies behind.

The cost is a rule: anything new that lists, counts, backs up or changes Songs or Beats across the install must leave the Demo out. Scheduled Backups, for one, mustn't count changes to it.
