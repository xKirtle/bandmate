-- A name of its own a Backup can be given, shown in place of the automatic
-- one made from when it was made and what it holds. '' means none, so the
-- automatic one is shown.
ALTER TABLE backups ADD COLUMN name TEXT NOT NULL DEFAULT '';
