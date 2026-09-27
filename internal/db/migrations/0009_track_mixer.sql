-- Each Track's mixer: its volume in dB, from silence (-60, the fader's
-- floor) to +6, and whether it's muted or soloed. Several Tracks can be
-- soloed at once.
ALTER TABLE tracks ADD COLUMN volume REAL NOT NULL DEFAULT 0 CHECK (volume BETWEEN -60 AND 6);
ALTER TABLE tracks ADD COLUMN muted INTEGER NOT NULL DEFAULT 0 CHECK (muted IN (0, 1));
ALTER TABLE tracks ADD COLUMN soloed INTEGER NOT NULL DEFAULT 0 CHECK (soloed IN (0, 1));
