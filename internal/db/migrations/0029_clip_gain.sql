-- A Clip's Gain: how much louder or quieter it plays, in dB, before its
-- Track's volume applies. It goes from -36 to +36 dB, as a Track's volume
-- does, and every Clip starts at 0 dB.
ALTER TABLE clips ADD COLUMN gain REAL NOT NULL DEFAULT 0 CHECK (gain BETWEEN -36 AND 36);
