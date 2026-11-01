-- A Track's Track Colour: which of the six it has, never a colour value, so
-- its shade follows each Device's Palette. A Song's Tracks start on the first
-- colours of the set, in order from the top, going round again past six.
ALTER TABLE tracks ADD COLUMN colour INTEGER NOT NULL DEFAULT 1 CHECK (colour BETWEEN 1 AND 6);
UPDATE tracks SET colour = ordered.colour
FROM (
	SELECT id, (row_number() OVER (PARTITION BY song_id ORDER BY position, id) - 1) % 6 + 1 AS colour
	FROM tracks
) AS ordered
WHERE ordered.id = tracks.id;
