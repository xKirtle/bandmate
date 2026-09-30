-- A Sound lives only as long as its Song uses it. Once no Clip uses it,
-- unused_since says since when, and it's kept a while longer so undo can
-- place its Clip again, then swept. It's null while a Clip uses it.
ALTER TABLE sounds ADD COLUMN unused_since TEXT;

-- Sounds no Clip uses already are counted as unused from now, in the app's
-- time format.
UPDATE sounds SET unused_since = strftime('%Y-%m-%dT%H:%M:%S', 'now') || '.000000000Z'
WHERE id NOT IN (SELECT sound_id FROM clips WHERE sound_id IS NOT NULL);
