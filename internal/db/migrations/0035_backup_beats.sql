-- How many Beats a Backup holds, with those its Songs bring, so it can be
-- named for them: "3 Songs + 5 Beats". Backups made before this hold Beats
-- uncounted, as 0; none had been released.
ALTER TABLE backups ADD COLUMN beats INTEGER NOT NULL DEFAULT 0 CHECK (beats >= 0);
