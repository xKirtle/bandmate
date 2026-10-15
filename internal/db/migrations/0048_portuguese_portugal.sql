-- Languages are named by their BCP 47 codes, so a Song sung in Portuguese,
-- 'pt', is sung in Portuguese (Portugal), 'pt-PT', in the same place among
-- its Languages. A Backup made before this is restored the same way.
UPDATE songs SET languages = replace(languages, '"pt"', '"pt-PT"') WHERE languages LIKE '%"pt"%';
