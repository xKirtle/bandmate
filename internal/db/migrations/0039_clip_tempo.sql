-- A Clip's Tempo: how fast it plays its audio, as a ratio of as recorded,
-- without changing its pitch. It goes from 0.5 (50%) to 2 (200%), and every
-- Clip starts at 1 (100%).
ALTER TABLE clips ADD COLUMN tempo REAL NOT NULL DEFAULT 1 CHECK (tempo BETWEEN 0.5 AND 2);
