-- Snapshots: copies of a Song's Lyric Sheet and Scrapbook as they were,
-- which Bandmate takes on its own and the user can restore. Each holds the
-- sheet as one JSON document: the Arrangement's and the Scrapbook's order,
-- and every Section with its Label, every Alternate with its name and
-- whether it's active, and every Line's text and Cue, each with its id.
-- reason says why it was taken: 'editing' before an editing session,
-- 'deleting' just before deleting a Scrapbook Section or an Alternate, or
-- 'restoring' before a restore. deleted names what a 'deleting' one was
-- taken before, as the Song page names it: a Section by its Label, else its
-- first Line, and an Alternate by its name, else its place, e.g.
-- 'Alternate 2'. It's NULL for the other reasons, and for a Section with no
-- Label and no words.
CREATE TABLE snapshots (
	id       INTEGER PRIMARY KEY AUTOINCREMENT,
	song_id  INTEGER NOT NULL REFERENCES songs (id) ON DELETE CASCADE,
	taken_at TEXT    NOT NULL,
	reason   TEXT    NOT NULL,
	deleted  TEXT,
	sheet    TEXT    NOT NULL
);

CREATE INDEX snapshots_song ON snapshots (song_id, taken_at);

-- When a Song's Lyric Sheet or Scrapbook last changed, NULL if never since
-- this: an editing session starts with the first change 10 minutes or more
-- after it. Changes to Cues alone don't count.
ALTER TABLE songs ADD COLUMN sheet_changed_at TEXT;
