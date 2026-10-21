-- A Nudge belongs to the Clip, not the Take (ADR 0028): how far a Clip's
-- audio has been moved by hand inside it, in seconds of the audio's own
-- time, later if positive. Every Clip starts unnudged.
ALTER TABLE clips ADD COLUMN nudge REAL NOT NULL DEFAULT 0;

-- Each Clip takes its active Take's Nudge.
UPDATE clips SET nudge = (SELECT nudge FROM takes WHERE takes.id = clips.active_take_id)
WHERE active_take_id IS NOT NULL;

-- A Take's position held the Nudge it was moved by, so it gives it up: the
-- position is where the Take was recorded again, and its Clip's Nudge is
-- what moves its audio. The active Take's audio stays exactly where it was;
-- a Take that had a different Nudge shifts by the difference, which is
-- silent until that Take is chosen. A detached Take is left as it is: it's
-- in no Clip, so no Nudge would put back what this took off, and whatever
-- places it again says where it goes.
UPDATE takes SET position = position - nudge WHERE clip_id IS NOT NULL;

ALTER TABLE takes DROP COLUMN nudge;
