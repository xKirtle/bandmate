-- Every Song and Beat has an identity that survives moving between installs,
-- unlike its id, which is local to one database. A Restore tells the same
-- Song or Beat from one with the same title by it. It's 32 random hex digits.
-- SQLite can't give an added column a default made fresh for each row, so
-- existing ones get theirs here, and a trigger gives one to each Song or
-- Beat made without one, however it's made: created, imported, or added
-- alongside by a Restore. A Restore replacing one sets the identity it has.
ALTER TABLE songs ADD COLUMN identity TEXT;
UPDATE songs SET identity = lower(hex(randomblob(16)));
CREATE UNIQUE INDEX songs_identity ON songs (identity);
CREATE TRIGGER songs_new_identity AFTER INSERT ON songs WHEN NEW.identity IS NULL
BEGIN
	UPDATE songs SET identity = lower(hex(randomblob(16))) WHERE id = NEW.id;
END;

ALTER TABLE beats ADD COLUMN identity TEXT;
UPDATE beats SET identity = lower(hex(randomblob(16)));
CREATE UNIQUE INDEX beats_identity ON beats (identity);
CREATE TRIGGER beats_new_identity AFTER INSERT ON beats WHEN NEW.identity IS NULL
BEGIN
	UPDATE beats SET identity = lower(hex(randomblob(16))) WHERE id = NEW.id;
END;
