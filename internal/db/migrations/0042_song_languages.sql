-- A Song's Languages: the languages its Lines are sung in, in the order the
-- user lists them, as a JSON array of codes, e.g. ["en"]. A Song always has
-- at least one, and every Song so far, as every new one, is sung in English.
ALTER TABLE songs ADD COLUMN languages TEXT NOT NULL DEFAULT '["en"]' CHECK (json_array_length(languages) > 0);
