-- A Track's volume now tops out at +24 dB: past that it only ever distorted,
-- and a Clip's Gain is there to lift a quiet recording further. Every Track
-- above it comes down to it. SQLite can't change a column's CHECK, so the
-- column is swapped for a new one.
ALTER TABLE tracks ADD COLUMN new_volume REAL NOT NULL DEFAULT 0 CHECK (new_volume BETWEEN -36 AND 24);
UPDATE tracks SET new_volume = min(volume, 24);
ALTER TABLE tracks DROP COLUMN volume;
ALTER TABLE tracks RENAME COLUMN new_volume TO volume;
