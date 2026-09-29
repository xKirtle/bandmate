-- A Section appears at most once in the Arrangement (ADR 0010). Each shared
-- Section keeps its first appearance by position; the others are deleted,
-- their Cues with them. Positions are then renumbered to stay contiguous.
DELETE FROM occurrences WHERE EXISTS (
	SELECT 1 FROM occurrences first
	WHERE first.section_id = occurrences.section_id
		AND (first.position < occurrences.position
			OR (first.position = occurrences.position AND first.id < occurrences.id))
);

UPDATE occurrences SET position = renumbered.position
FROM (
	SELECT id, ROW_NUMBER() OVER (PARTITION BY song_id ORDER BY position, id) - 1 AS position
	FROM occurrences
) AS renumbered
WHERE renumbered.id = occurrences.id;
