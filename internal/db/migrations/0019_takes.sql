-- A recording made in the app: a mono 24-bit WAV at the rate it was
-- recorded at, kept under audio/takes/ by id. It belongs to its Song, and to
-- a Clip while it's in one. Deleting its Clip or Track detaches it instead
-- (clip_id is then null, and detached_at says since when), so undo can put
-- it back.
--
-- Its position is in seconds from its Clip's source span origin (the Clip's
-- start minus its offset): the Timeline time capture began, less the
-- latency offset applied to it, in seconds.
CREATE TABLE takes (
	id             INTEGER PRIMARY KEY AUTOINCREMENT,
	song_id        INTEGER NOT NULL REFERENCES songs (id) ON DELETE CASCADE,
	clip_id        INTEGER REFERENCES clips (id) ON DELETE SET NULL,
	number         INTEGER NOT NULL CHECK (number > 0),
	size           INTEGER NOT NULL,
	duration       REAL NOT NULL CHECK (duration > 0),
	sample_rate    INTEGER NOT NULL CHECK (sample_rate > 0),
	peaks          TEXT NOT NULL,
	latency_offset REAL NOT NULL,
	position       REAL NOT NULL,
	recorded_at    TEXT NOT NULL,
	detached_at    TEXT
);

-- A Clip plays a Beat or Takes, never both. A Clip of Takes plays its
-- active Take, so it has one exactly when it has no Beat. clips is rebuilt
-- for its beat_id to become optional, keeping its ids and never reusing one
-- deleted before.
CREATE TABLE clips_new (
	id             INTEGER PRIMARY KEY AUTOINCREMENT,
	track_id       INTEGER NOT NULL REFERENCES tracks (id) ON DELETE CASCADE,
	beat_id        INTEGER REFERENCES beats (id),
	active_take_id INTEGER REFERENCES takes (id),
	start          REAL NOT NULL CHECK (start >= 0),
	source_offset  REAL NOT NULL CHECK (source_offset >= 0),
	length         REAL NOT NULL CHECK (length > 0),
	CHECK ((beat_id IS NULL) <> (active_take_id IS NULL))
);

INSERT INTO clips_new (id, track_id, beat_id, start, source_offset, length)
SELECT id, track_id, beat_id, start, source_offset, length FROM clips;

DELETE FROM sqlite_sequence WHERE name = 'clips_new';
INSERT INTO sqlite_sequence (name, seq) SELECT 'clips_new', seq FROM sqlite_sequence WHERE name = 'clips';

DROP TABLE clips;
ALTER TABLE clips_new RENAME TO clips;

CREATE INDEX clips_track ON clips (track_id, start);
CREATE INDEX clips_beat ON clips (beat_id);

CREATE INDEX takes_clip ON takes (clip_id);
CREATE INDEX takes_song ON takes (song_id);
