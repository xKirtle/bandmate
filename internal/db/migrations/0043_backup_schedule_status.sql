-- The Scheduled Backups' status, and skipping one when nothing has changed.
--
-- changes counts every row added, changed or deleted in a table a Backup
-- copies, by triggers the backups package makes each time Bandmate starts
-- (so a migration rebuilding a table never leaves it uncounted).
-- changes_when_made is what it was when the schedule last made a Scheduled
-- Backup, so an equal count means nothing has changed since; NULL if it never
-- has, which counts as changed.
--
-- tried_at, outcome and failure are the schedule's last try at one: when, and
-- whether it made one, found nothing changed, or failed and why. The next is
-- due a period after a try that didn't fail.
ALTER TABLE backup_schedule ADD COLUMN changes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE backup_schedule ADD COLUMN changes_when_made INTEGER;
ALTER TABLE backup_schedule ADD COLUMN tried_at TEXT;
ALTER TABLE backup_schedule ADD COLUMN outcome TEXT CHECK (outcome IN ('made', 'unchanged', 'failed'));
ALTER TABLE backup_schedule ADD COLUMN failure TEXT;

UPDATE backup_schedule SET tried_at = last_made_at, outcome = 'made' WHERE last_made_at IS NOT NULL;
