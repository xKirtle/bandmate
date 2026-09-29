-- With each Section appearing at most once (ADR 0010), the Occurrence goes:
-- a Section has a position while it's in the Arrangement and none while
-- it's in the Scrapbook, and a Line has at most one Cue, kept on the Line.
-- After 0016, Occurrences are 1:1 with the Sections in the Arrangement.
ALTER TABLE sections ADD COLUMN position INTEGER;
UPDATE sections SET position = (SELECT o.position FROM occurrences o WHERE o.section_id = sections.id);

CREATE INDEX sections_arrangement ON sections (song_id, position);

-- A Line's Cue: when it's sung, in milliseconds. NULL means no Cue. A Line
-- of an inactive Alternate keeps its Cue, which lies dormant (ADR 0007).
ALTER TABLE lines ADD COLUMN cue_ms INTEGER CHECK (cue_ms >= 0);
UPDATE lines SET cue_ms = (SELECT c.cue_ms FROM line_cues c WHERE c.line_id = lines.id);

DROP TABLE line_cues;
DROP TABLE occurrences;
