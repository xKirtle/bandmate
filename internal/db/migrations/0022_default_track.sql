-- A Song always has at least one Track: those that have none get "Track 1".
INSERT INTO tracks (song_id, name, position)
SELECT id, 'Track 1', 0 FROM songs
WHERE NOT EXISTS (SELECT 1 FROM tracks WHERE tracks.song_id = songs.id);
