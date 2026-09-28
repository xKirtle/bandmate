-- Only Lines are cued: an Occurrence starts where its first Line is cued
-- (ADR 0009). An Occurrence's own Cue moves to its first Line (the first
-- non-blank Line of its active Alternate) when that Line has none, and is
-- dropped otherwise, as is the Cue of an Occurrence with no Lines.
INSERT OR IGNORE INTO line_cues (occurrence_id, line_id, cue_ms)
SELECT id, first_line, cue_ms FROM (
	SELECT o.id, o.cue_ms, (
		SELECT l.id FROM lines l JOIN alternates a ON a.id = l.alternate_id AND a.active = 1
		WHERE a.section_id = o.section_id AND trim(l.text, ' ' || char(9, 10, 11, 12, 13)) <> ''
		ORDER BY l.position LIMIT 1
	) AS first_line
	FROM occurrences o WHERE o.cue_ms IS NOT NULL
) WHERE first_line IS NOT NULL;

-- The CHECK is on cue_ms itself, so SQLite drops it along with the column.
ALTER TABLE occurrences DROP COLUMN cue_ms;
