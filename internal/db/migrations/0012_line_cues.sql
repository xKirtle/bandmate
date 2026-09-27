-- A Line's Cue within one Occurrence: when that Line is sung there, in
-- milliseconds. Keyed by Occurrence as well as Line, since a Line of a
-- shared Section is sung at a different time in each Occurrence (ADR 0005).
-- A Line of an inactive Alternate keeps its Cues, which lie dormant (ADR
-- 0007). Removing the Line or the Occurrence drops them.
CREATE TABLE line_cues (
	occurrence_id INTEGER NOT NULL REFERENCES occurrences (id) ON DELETE CASCADE,
	line_id       INTEGER NOT NULL REFERENCES lines (id) ON DELETE CASCADE,
	cue_ms        INTEGER NOT NULL CHECK (cue_ms >= 0),
	PRIMARY KEY (occurrence_id, line_id)
);

CREATE INDEX line_cues_line ON line_cues (line_id);

-- Whether Read mode shows the Cue gutter. The highlight works either way.
ALTER TABLE songs ADD COLUMN show_cues INTEGER NOT NULL DEFAULT 1 CHECK (show_cues IN (0, 1));
