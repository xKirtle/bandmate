-- The date each Snapshot was taken on, e.g. '2026-10-19', in the time zone
-- of the Device whose change took it: thinning keeps the newest of each such
-- day, then of each one's ISO week. A Snapshot taken before this, or held in
-- a Backup made before this, gets its date in UTC.
ALTER TABLE snapshots ADD COLUMN taken_on TEXT NOT NULL DEFAULT '';
UPDATE snapshots SET taken_on = substr(taken_at, 1, 10);
