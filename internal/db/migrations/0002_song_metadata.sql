-- How to play a Song, plus free-form notes. Only the title is required:
-- empty text and NULL numbers mean "not set".
ALTER TABLE songs ADD COLUMN song_key TEXT NOT NULL DEFAULT '';
ALTER TABLE songs ADD COLUMN bpm      INTEGER CHECK (bpm BETWEEN 1 AND 999);
ALTER TABLE songs ADD COLUMN capo     INTEGER CHECK (capo BETWEEN 0 AND 24);
ALTER TABLE songs ADD COLUMN tuning   TEXT NOT NULL DEFAULT '';
ALTER TABLE songs ADD COLUMN notes    TEXT NOT NULL DEFAULT '';

CREATE INDEX songs_status ON songs (status);
