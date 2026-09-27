-- Goes up by one with every change to a Song, so a write based on an older
-- version (e.g. from a stale tab) can be refused.
ALTER TABLE songs ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
