-- A Song's Timeline: Tracks, top to bottom by position, holding Clips.
-- AUTOINCREMENT keeps ids from being reused, so a stale tab never edits a
-- new Track or Clip thinking it is the one it knew.
CREATE TABLE tracks (
	id       INTEGER PRIMARY KEY AUTOINCREMENT,
	song_id  INTEGER NOT NULL REFERENCES songs (id) ON DELETE CASCADE,
	name     TEXT NOT NULL,
	position INTEGER NOT NULL
);

CREATE INDEX tracks_song ON tracks (song_id, position);

-- A stretch of a Beat placed on a Track, in seconds: where it starts on the
-- Timeline, where in the Beat it starts playing (the trim), and for how long.
-- A Beat used by a Clip can't be deleted.
CREATE TABLE clips (
	id            INTEGER PRIMARY KEY AUTOINCREMENT,
	track_id      INTEGER NOT NULL REFERENCES tracks (id) ON DELETE CASCADE,
	beat_id       INTEGER NOT NULL REFERENCES beats (id),
	start         REAL NOT NULL CHECK (start >= 0),
	source_offset REAL NOT NULL CHECK (source_offset >= 0),
	length        REAL NOT NULL CHECK (length > 0)
);

CREATE INDEX clips_track ON clips (track_id, start);
CREATE INDEX clips_beat ON clips (beat_id);
