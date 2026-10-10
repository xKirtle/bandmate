-- The Bandmate that last ran on the database, recorded at every start: the
-- next Upgrade copy is named after it. It's one row, or none until the
-- first start records it.
CREATE TABLE bandmate_version (
	id      INTEGER PRIMARY KEY CHECK (id = 1),
	version TEXT NOT NULL
);
