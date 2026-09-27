-- Finished recordings of a Song made elsewhere. Each Master's audio file is
-- stored on disk, named by the Master's id; these columns describe it.
CREATE TABLE masters (
	id           INTEGER PRIMARY KEY,
	song_id      INTEGER NOT NULL REFERENCES songs (id) ON DELETE CASCADE,
	name         TEXT NOT NULL,
	-- Exactly one of a Song's Masters is its main Master.
	main         INTEGER NOT NULL DEFAULT 0 CHECK (main IN (0, 1)),
	notes        TEXT NOT NULL DEFAULT '',
	-- The file as uploaded: its name, media type and size in bytes.
	file_name    TEXT NOT NULL,
	content_type TEXT NOT NULL,
	size         INTEGER NOT NULL,
	-- Worked out by the browser, which decodes the file: its length in
	-- seconds and its waveform peaks as a JSON array.
	duration     REAL NOT NULL,
	peaks        TEXT NOT NULL,
	added_at     TEXT NOT NULL
);

CREATE INDEX masters_song ON masters (song_id);
CREATE UNIQUE INDEX masters_one_main ON masters (song_id) WHERE main = 1;
