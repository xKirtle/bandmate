-- Read mode shows the Cue gutter under the same rule as Write mode, so a
-- Song has no setting to hide it. The CHECK is on show_cues itself, so
-- SQLite drops it along with the column.
ALTER TABLE songs DROP COLUMN show_cues;
