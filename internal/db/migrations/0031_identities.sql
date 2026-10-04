-- Every Song and Beat has an identity that survives moving between installs,
-- unlike its id, which is local to one database. A Restore tells the same
-- Song or Beat from one with the same title by it. It's 32 random hex digits,
-- given when the Song or Beat is made; SQLite can't give an added column a
-- default made fresh for each row, so existing ones get theirs here.
ALTER TABLE songs ADD COLUMN identity TEXT;
UPDATE songs SET identity = lower(hex(randomblob(16)));
CREATE UNIQUE INDEX songs_identity ON songs (identity);

ALTER TABLE beats ADD COLUMN identity TEXT;
UPDATE beats SET identity = lower(hex(randomblob(16)));
CREATE UNIQUE INDEX beats_identity ON beats (identity);
