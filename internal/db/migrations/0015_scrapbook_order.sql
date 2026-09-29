-- The Scrapbook lists its Sections in the order they came into it, so a
-- Section taken out of the Arrangement goes to its end. Sections already
-- there keep the order they had, by id.
ALTER TABLE sections ADD COLUMN scrapbook_position INTEGER NOT NULL DEFAULT 0;
UPDATE sections SET scrapbook_position = id;
