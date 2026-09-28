-- Read mode now shows the Cue gutter whenever Write mode does, so there is
-- no setting to hide it. The column's CHECK is its own, so it drops with it.
ALTER TABLE songs DROP COLUMN show_cues;
