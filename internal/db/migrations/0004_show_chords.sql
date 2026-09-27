-- Whether the Lyric Sheet shows a Song's Chords. They stay in the Lines
-- either way.
ALTER TABLE songs ADD COLUMN show_chords INTEGER NOT NULL DEFAULT 1 CHECK (show_chords IN (0, 1));
