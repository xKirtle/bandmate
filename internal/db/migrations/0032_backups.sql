-- The Backups kept in Bandmate. Each one's file is stored under backups/ in
-- the data directory, named by its id; these columns describe it. A Backup's
-- own database has this table too, always empty: a Backup is never listed
-- inside another. AUTOINCREMENT keeps a deleted Backup's id, and so its file
-- name, from being reused.
CREATE TABLE backups (
	id         INTEGER PRIMARY KEY AUTOINCREMENT,
	-- How many Songs it holds.
	songs      INTEGER NOT NULL CHECK (songs >= 0),
	-- Its file's size in bytes.
	size       INTEGER NOT NULL CHECK (size > 0),
	created_at TEXT NOT NULL
);
