-- A Snapshot taken just before deleting a Scrapbook Section or an Alternate
-- has reason 'deleting', and deleted names what was deleted, as the Song
-- page names it: a Section by its Label, else its first Line, and an
-- Alternate by its name, else its place, e.g. 'Alternate 2'. NULL for
-- Snapshots taken for any other reason, and for a Section with no Label and
-- no words.
ALTER TABLE snapshots ADD COLUMN deleted TEXT;
