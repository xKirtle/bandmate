-- Scheduled Backups. A Backup the schedule made is marked scheduled, and only
-- those are ever deleted by it. Backups made by hand or uploaded, and those
-- made before this, are ordinary.
ALTER TABLE backups ADD COLUMN scheduled INTEGER NOT NULL DEFAULT 0 CHECK (scheduled IN (0, 1));

-- The schedule Scheduled Backups are made on, for the whole install: whether
-- it's on, how often one is made, and how many are kept. It's one row, or
-- none until it's first set, which reads as off, weekly, keeping 4.
-- last_made_at is when the schedule last made one, NULL if it never has.
CREATE TABLE backup_schedule (
	id           INTEGER PRIMARY KEY CHECK (id = 1),
	turned_on    INTEGER NOT NULL CHECK (turned_on IN (0, 1)),
	period       TEXT    NOT NULL CHECK (period IN ('daily', 'weekly', 'monthly')),
	keep         INTEGER NOT NULL CHECK (keep BETWEEN 1 AND 30),
	last_made_at TEXT
);
