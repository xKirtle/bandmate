-- Whether the Tour has been offered on the empty Songs page, for the whole
-- install: taken or turned down there, it's never offered again. It's one
-- row, or none until it's first offered, which reads as not offered yet.
CREATE TABLE tour (
	id      INTEGER PRIMARY KEY CHECK (id = 1),
	offered INTEGER NOT NULL CHECK (offered IN (0, 1))
);

-- An install that already has Songs isn't new, so it's never offered.
INSERT INTO tour (id, offered) SELECT 1, 1 WHERE EXISTS (SELECT 1 FROM songs WHERE NOT demo);
