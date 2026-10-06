-- A Tag marks Songs with a name of the user's own. Like a Folder it's only a
-- name, unique ignoring case: folded is the name as compared, lowercased by
-- the app, since SQLite's NOCASE only folds ASCII.
CREATE TABLE tags (
	id     INTEGER PRIMARY KEY,
	name   TEXT NOT NULL CHECK (name <> ''),
	folded TEXT NOT NULL UNIQUE
);

-- The Tags each Song carries, any number of them.
CREATE TABLE song_tags (
	song_id INTEGER NOT NULL REFERENCES songs (id) ON DELETE CASCADE,
	tag_id  INTEGER NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
	PRIMARY KEY (song_id, tag_id)
) WITHOUT ROWID;

CREATE INDEX song_tags_tag_id ON song_tags (tag_id);

-- A Tag lasts only while some Song carries it: whatever takes it off its
-- last Song, a Song's Tags being set or the Song deleted, removes it.
CREATE TRIGGER tags_go_with_their_last_song AFTER DELETE ON song_tags
WHEN NOT EXISTS (SELECT 1 FROM song_tags WHERE tag_id = OLD.tag_id)
BEGIN
	DELETE FROM tags WHERE id = OLD.tag_id;
END;
