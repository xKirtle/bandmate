-- A Clip's Fades: how long it rises from silence at its start (fade_in) and
-- falls to silence at its end (fade_out), in seconds, each measured from
-- that edge as trimmed. Together they never run longer than the Clip, and
-- every Clip starts with none.
ALTER TABLE clips ADD COLUMN fade_in REAL NOT NULL DEFAULT 0 CHECK (fade_in >= 0);
ALTER TABLE clips ADD COLUMN fade_out REAL NOT NULL DEFAULT 0 CHECK (fade_out >= 0 AND fade_in + fade_out <= length + 0.000001);
