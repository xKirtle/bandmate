-- A Song's Lyric Sheet. A Section with no Occurrences is in the Scrapbook;
-- that is derived, not stored.
--
-- AUTOINCREMENT keeps a deleted row's id from being reused: later steps
-- attach Cues to Occurrences and Lines by id.
CREATE TABLE sections (
	id      INTEGER PRIMARY KEY AUTOINCREMENT,
	song_id INTEGER NOT NULL REFERENCES songs (id) ON DELETE CASCADE,
	label   TEXT NOT NULL DEFAULT ''
);

CREATE INDEX sections_song ON sections (song_id);

-- The Arrangement: Occurrences ordered by position within their Song.
CREATE TABLE occurrences (
	id         INTEGER PRIMARY KEY AUTOINCREMENT,
	song_id    INTEGER NOT NULL REFERENCES songs (id) ON DELETE CASCADE,
	section_id INTEGER NOT NULL REFERENCES sections (id) ON DELETE CASCADE,
	position   INTEGER NOT NULL
);

CREATE INDEX occurrences_song ON occurrences (song_id, position);
CREATE INDEX occurrences_section ON occurrences (section_id);

-- Exactly one Alternate of a Section is active.
CREATE TABLE alternates (
	id         INTEGER PRIMARY KEY AUTOINCREMENT,
	section_id INTEGER NOT NULL REFERENCES sections (id) ON DELETE CASCADE,
	name       TEXT NOT NULL DEFAULT '',
	active     INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0, 1))
);

CREATE INDEX alternates_section ON alternates (section_id);
CREATE UNIQUE INDEX alternates_one_active ON alternates (section_id) WHERE active = 1;

-- A Line's text is ChordPro inline notation. Its id is stable across edits.
CREATE TABLE lines (
	id           INTEGER PRIMARY KEY AUTOINCREMENT,
	alternate_id INTEGER NOT NULL REFERENCES alternates (id) ON DELETE CASCADE,
	position     INTEGER NOT NULL,
	text         TEXT NOT NULL
);

CREATE INDEX lines_alternate ON lines (alternate_id, position);
