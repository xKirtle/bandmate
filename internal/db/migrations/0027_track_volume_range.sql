-- A Track's volume now goes from -36 to +36 dB, and even at its lowest the
-- Track is heard. A Track that was Silent (-60 dB) is muted so it stays
-- unheard, and every Track below -36 dB comes up to it. SQLite can't change
-- a column's CHECK, so the column is swapped for a new one.
UPDATE tracks SET muted = 1 WHERE volume <= -60;
ALTER TABLE tracks ADD COLUMN new_volume REAL NOT NULL DEFAULT 0 CHECK (new_volume BETWEEN -36 AND 36);
UPDATE tracks SET new_volume = max(volume, -36);
ALTER TABLE tracks DROP COLUMN volume;
ALTER TABLE tracks RENAME COLUMN new_volume TO volume;
