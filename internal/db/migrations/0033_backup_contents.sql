-- What a Backup holds besides its Songs, so it can be named for it: whether
-- its Songs are every Song there was, and whether it holds the whole Beat
-- Library. Both together are Everything.
ALTER TABLE backups ADD COLUMN all_songs INTEGER NOT NULL DEFAULT 0 CHECK (all_songs IN (0, 1));
ALTER TABLE backups ADD COLUMN beat_library INTEGER NOT NULL DEFAULT 0 CHECK (beat_library IN (0, 1));
