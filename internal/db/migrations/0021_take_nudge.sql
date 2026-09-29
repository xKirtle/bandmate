-- How far a Take has been nudged by hand from where it was recorded, in
-- seconds, later if positive. Its position already includes it.
ALTER TABLE takes ADD COLUMN nudge REAL NOT NULL DEFAULT 0;
