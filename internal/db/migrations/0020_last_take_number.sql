-- The highest number a Clip of Takes ever gave a Take, so the next one gets
-- the number after it, even once the Takes before it have left the Clip.
-- 0 for a Clip of a Beat.
ALTER TABLE clips ADD COLUMN last_take_number INTEGER NOT NULL DEFAULT 0;

UPDATE clips SET last_take_number = COALESCE((SELECT MAX(number) FROM takes WHERE clip_id = clips.id), 0);
