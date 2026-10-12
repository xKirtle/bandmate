-- The Scheduled Backups' status, and skipping one when nothing has changed.
--
-- last_made_id is the Backup the schedule last made, kept or not, and
-- made_fingerprint a hash of what it held, as the backups package works it
-- out: a due Scheduled Backup is skipped while that Backup is still there and
-- the hash of what one would hold now is the same. NULL if it never made one,
-- which counts as changed.
--
-- tried_at, outcome and failure are the schedule's last try at one: when, and
-- whether it made one, made none as nothing had changed or there was nothing
-- to back up, or failed and why. The next is due a period after a try that
-- didn't fail.
ALTER TABLE backup_schedule ADD COLUMN last_made_id INTEGER;
ALTER TABLE backup_schedule ADD COLUMN made_fingerprint TEXT;
ALTER TABLE backup_schedule ADD COLUMN tried_at TEXT;
ALTER TABLE backup_schedule ADD COLUMN outcome TEXT CHECK (outcome IN ('made', 'unchanged', 'empty', 'failed'));
ALTER TABLE backup_schedule ADD COLUMN failure TEXT;

UPDATE backup_schedule SET tried_at = last_made_at, outcome = 'made' WHERE last_made_at IS NOT NULL;
