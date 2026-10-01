-- Whether Read mode shows a Song's Chords is kept on each device, not on
-- the Song, so a Song has no setting for it. The CHECK is on show_chords
-- itself, so SQLite drops it along with the column.
ALTER TABLE songs DROP COLUMN show_chords;
