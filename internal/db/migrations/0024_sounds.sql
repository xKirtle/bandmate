-- An audio file imported into one Song, placed in Clips like a Beat, but
-- without a credit or a library. It's kept under audio/sounds/ by id,
-- exactly as uploaded (ADR 0003); these columns describe it. Its name comes
-- from the file when imported, and never changes.
CREATE TABLE sounds (
	id           INTEGER PRIMARY KEY AUTOINCREMENT,
	song_id      INTEGER NOT NULL REFERENCES songs (id) ON DELETE CASCADE,
	name         TEXT NOT NULL,
	-- The file as uploaded: its name, media type and size in bytes.
	file_name    TEXT NOT NULL,
	content_type TEXT NOT NULL,
	size         INTEGER NOT NULL,
	-- Worked out by the browser, which decodes the file: its length in
	-- seconds and its waveform peaks as a JSON array.
	duration     REAL NOT NULL CHECK (duration > 0),
	peaks        TEXT NOT NULL,
	added_at     TEXT NOT NULL
);

CREATE INDEX sounds_song ON sounds (song_id);

-- A Clip plays exactly one of a Beat, Takes (by its active Take) or a
-- Sound. clips is rebuilt for its check to take in the Sound, keeping its
-- ids and never reusing one deleted before. Dropping the old table takes
-- the Takes out of their Clips, by the foreign key, so they're put back.
CREATE TABLE takes_in_clips AS SELECT id, clip_id FROM takes WHERE clip_id IS NOT NULL;

CREATE TABLE clips_new (
	id               INTEGER PRIMARY KEY AUTOINCREMENT,
	track_id         INTEGER NOT NULL REFERENCES tracks (id) ON DELETE CASCADE,
	beat_id          INTEGER REFERENCES beats (id),
	active_take_id   INTEGER REFERENCES takes (id),
	sound_id         INTEGER REFERENCES sounds (id),
	last_take_number INTEGER NOT NULL DEFAULT 0,
	name             TEXT,
	start            REAL NOT NULL CHECK (start >= 0),
	source_offset    REAL NOT NULL CHECK (source_offset >= 0),
	length           REAL NOT NULL CHECK (length > 0),
	CHECK ((beat_id IS NOT NULL) + (active_take_id IS NOT NULL) + (sound_id IS NOT NULL) = 1)
);

INSERT INTO clips_new (id, track_id, beat_id, active_take_id, last_take_number, name, start, source_offset, length)
SELECT id, track_id, beat_id, active_take_id, last_take_number, name, start, source_offset, length FROM clips;

DELETE FROM sqlite_sequence WHERE name = 'clips_new';
INSERT INTO sqlite_sequence (name, seq) SELECT 'clips_new', seq FROM sqlite_sequence WHERE name = 'clips';

DROP TABLE clips;
ALTER TABLE clips_new RENAME TO clips;

CREATE INDEX clips_track ON clips (track_id, start);
CREATE INDEX clips_beat ON clips (beat_id);
CREATE INDEX clips_sound ON clips (sound_id);

UPDATE takes SET clip_id = (SELECT clip_id FROM takes_in_clips WHERE takes_in_clips.id = takes.id)
WHERE id IN (SELECT id FROM takes_in_clips);

DROP TABLE takes_in_clips;
