-- The Demo Song and Demo Beat the Tour shows (ADR 0020): a Song and a Beat
-- restored from the Backup built into Bandmate, marked demo = 1. They're
-- left out wherever the user's Songs and Beats are listed, counted or backed
-- up. Every other Song and Beat is the user's.
ALTER TABLE songs ADD COLUMN demo INTEGER NOT NULL DEFAULT 0 CHECK (demo IN (0, 1));
ALTER TABLE beats ADD COLUMN demo INTEGER NOT NULL DEFAULT 0 CHECK (demo IN (0, 1));
