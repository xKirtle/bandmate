-- A Clip's own name, so two Clips of the same audio can be told apart. Null
-- until it's named, as it then goes by its source's name.
ALTER TABLE clips ADD COLUMN name TEXT;
