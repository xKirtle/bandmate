-- An Occurrence's Cue: when it starts on the Timeline, in milliseconds so
-- it keeps exactly the precision it's given. NULL means no Cue. Kept on the
-- Occurrence, never its Section, since a shared Section is sung at a
-- different time in each Occurrence (ADR 0005).
ALTER TABLE occurrences ADD COLUMN cue_ms INTEGER CHECK (cue_ms >= 0);
