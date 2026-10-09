-- A Clip's Pitch: how many semitones its audio is moved up or down, without
-- changing its Tempo. It's a whole number from -12 to +12, and every Clip
-- starts at 0.
ALTER TABLE clips ADD COLUMN pitch INTEGER NOT NULL DEFAULT 0
  CHECK (typeof(pitch) = 'integer' AND pitch BETWEEN -12 AND 12);
