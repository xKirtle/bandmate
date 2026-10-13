-- Snapshots: copies of a Song's Lyric Sheet and Scrapbook as they were,
-- which Bandmate takes on its own and the user can restore. Each holds the
-- sheet as one JSON document: the Arrangement's and the Scrapbook's order,
-- and every Section with its Label, every Alternate with its name and
-- whether it's active, and every Line's text and Cue, each with its id.
-- reason says why it was taken: 'editing' before an editing session, or
-- 'restoring' before a restore.
CREATE TABLE snapshots (
	id       INTEGER PRIMARY KEY AUTOINCREMENT,
	song_id  INTEGER NOT NULL REFERENCES songs (id) ON DELETE CASCADE,
	taken_at TEXT    NOT NULL,
	reason   TEXT    NOT NULL,
	sheet    TEXT    NOT NULL
);

CREATE INDEX snapshots_song ON snapshots (song_id, taken_at);

-- When a Song's Lyric Sheet or Scrapbook last changed, NULL if never since
-- this: an editing session starts with the first change 10 minutes or more
-- after it. Changes to Cues alone don't count.
ALTER TABLE songs ADD COLUMN sheet_changed_at TEXT;
