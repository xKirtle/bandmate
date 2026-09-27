-- A Song's Loop: the stretch of its Timeline, in seconds, that playback
-- repeats while it's on. A Song has at most one; without it, there's no Loop.
CREATE TABLE loops (
	song_id INTEGER PRIMARY KEY REFERENCES songs (id) ON DELETE CASCADE,
	start   REAL NOT NULL CHECK (start >= 0),
	end     REAL NOT NULL CHECK (end > start),
	is_on   INTEGER NOT NULL DEFAULT 0 CHECK (is_on IN (0, 1))
);
