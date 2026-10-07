-- foreign_keys: off
-- A fourth Status, shelved: a Song set aside for now. SQLite can't change a
-- CHECK in place, so songs is rebuilt as its docs lay out
-- (https://www.sqlite.org/lang_altertable.html#otheralter), with foreign keys
-- off so that dropping the old table deletes nothing that refers to it. Its
-- columns, indexes and trigger are as before.
CREATE TABLE songs_new (
	id         INTEGER PRIMARY KEY,
	title      TEXT NOT NULL,
	status     TEXT NOT NULL DEFAULT 'idea' CHECK (status IN ('idea', 'drafting', 'finished', 'shelved')),
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	song_key   TEXT NOT NULL DEFAULT '',
	bpm        INTEGER CHECK (bpm BETWEEN 1 AND 999),
	capo       INTEGER CHECK (capo BETWEEN 0 AND 24),
	tuning     TEXT NOT NULL DEFAULT '',
	notes      TEXT NOT NULL DEFAULT '',
	version    INTEGER NOT NULL DEFAULT 1,
	identity   TEXT,
	folder_id  INTEGER REFERENCES folders (id) ON DELETE SET NULL
);

INSERT INTO songs_new (id, title, status, created_at, updated_at, song_key, bpm, capo, tuning, notes, version, identity, folder_id)
SELECT id, title, status, created_at, updated_at, song_key, bpm, capo, tuning, notes, version, identity, folder_id FROM songs;

DROP TABLE songs;
ALTER TABLE songs_new RENAME TO songs;

CREATE INDEX songs_updated_at ON songs (updated_at);
CREATE INDEX songs_status ON songs (status);
CREATE UNIQUE INDEX songs_identity ON songs (identity);
CREATE INDEX songs_folder_id ON songs (folder_id);

CREATE TRIGGER songs_new_identity AFTER INSERT ON songs WHEN NEW.identity IS NULL
BEGIN
	UPDATE songs SET identity = lower(hex(randomblob(16))) WHERE id = NEW.id;
END;
