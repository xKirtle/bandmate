-- The Beat Library, shared by all Songs. Each Beat's audio file is stored on
-- disk, named by the Beat's id; these columns describe it.
CREATE TABLE beats (
	id           INTEGER PRIMARY KEY,
	title        TEXT NOT NULL,
	producer     TEXT NOT NULL DEFAULT '',
	source_link  TEXT NOT NULL DEFAULT '',
	bpm          INTEGER CHECK (bpm BETWEEN 1 AND 999),
	beat_key     TEXT NOT NULL DEFAULT '',
	notes        TEXT NOT NULL DEFAULT '',
	-- The file as uploaded: its name, media type and size in bytes.
	file_name    TEXT NOT NULL,
	content_type TEXT NOT NULL,
	size         INTEGER NOT NULL,
	-- Worked out by the browser, which decodes the file: its length in
	-- seconds and its waveform peaks as a JSON array.
	duration     REAL NOT NULL,
	peaks        TEXT NOT NULL,
	created_at   TEXT NOT NULL,
	updated_at   TEXT NOT NULL
);

CREATE INDEX beats_created_at ON beats (created_at);
