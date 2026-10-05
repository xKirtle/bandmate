-- A Folder keeps some Songs together on the Songs page. It's only a name,
-- unique ignoring case: folded is the name as compared, lowercased by the
-- app, since SQLite's NOCASE only folds ASCII.
CREATE TABLE folders (
	id     INTEGER PRIMARY KEY,
	name   TEXT NOT NULL CHECK (name <> ''),
	folded TEXT NOT NULL UNIQUE
);

-- The Folder a Song sits in, or NULL for none. A Folder deleted leaves its
-- Songs in none.
ALTER TABLE songs ADD COLUMN folder_id INTEGER REFERENCES folders (id) ON DELETE SET NULL;

CREATE INDEX songs_folder_id ON songs (folder_id);
