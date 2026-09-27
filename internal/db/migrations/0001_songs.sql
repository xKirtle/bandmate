CREATE TABLE songs (
	id         INTEGER PRIMARY KEY,
	title      TEXT NOT NULL,
	status     TEXT NOT NULL DEFAULT 'idea' CHECK (status IN ('idea', 'drafting', 'finished')),
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

CREATE INDEX songs_updated_at ON songs (updated_at);
