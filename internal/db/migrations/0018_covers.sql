-- A Song's Cover. The browser makes its pictures, which are stored on disk
-- named by the Cover's id: the original (normalized to open in any browser),
-- and the crop square in the list and header sizes. AUTOINCREMENT keeps a
-- deleted Cover's id, and so its file names, from being reused while its
-- files are still being removed.
CREATE TABLE covers (
	id            INTEGER PRIMARY KEY AUTOINCREMENT,
	-- A Song has at most one Cover.
	song_id       INTEGER NOT NULL UNIQUE REFERENCES songs (id) ON DELETE CASCADE,
	-- The original's size in pixels.
	width         INTEGER NOT NULL CHECK (width > 0),
	height        INTEGER NOT NULL CHECK (height > 0),
	-- The square of the original the Cover shows, in its pixels.
	crop_x        INTEGER NOT NULL CHECK (crop_x >= 0),
	crop_y        INTEGER NOT NULL CHECK (crop_y >= 0),
	crop_size     INTEGER NOT NULL CHECK (crop_size > 0),
	-- The media type of each picture.
	original_type TEXT NOT NULL,
	list_type     TEXT NOT NULL,
	header_type   TEXT NOT NULL,
	added_at      TEXT NOT NULL
);
