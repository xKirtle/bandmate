-- Whether the Tour has been offered on the empty Songs page, for the whole
-- install: taken or turned down there, it's never offered again. Its one
-- row says it has been; with none, it hasn't yet.
CREATE TABLE tour_offered (
	id INTEGER PRIMARY KEY CHECK (id = 1)
);

-- An install that already has Songs isn't new, so it's never offered.
INSERT INTO tour_offered (id) SELECT 1 WHERE EXISTS (SELECT 1 FROM songs WHERE NOT demo);
