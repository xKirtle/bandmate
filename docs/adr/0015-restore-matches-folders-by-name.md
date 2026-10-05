# A Restore matches Folders by name, not by identity

A Backup carries the Folder each of its Songs sits in, and a Restore puts a Song into the Folder of the same name (ignoring case), making it if there's none; Replace and Keep both alike take the Backup's Folder. Songs and Beats are matched by an identity that survives moving installs (see 0013), but a Folder is only a name, unique on an install, so its name already says which Folder it is. Matching by name needs no identity column and no replace-or-keep-both choice for Folders.

The cost is that a Folder renamed on one install comes back from its Backups as a second Folder under the old name on another, to be merged by hand.

Tags are restored the same way: a Tag is only a name, unique on an install ignoring case, so a restored Song carries the Tags of the same names, made where there are none. A Song the Restore replaces takes exactly the Backup's Tags, as it takes the rest of the Song, rather than keeping its own as well.
