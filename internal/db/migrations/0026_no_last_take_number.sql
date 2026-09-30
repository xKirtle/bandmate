-- A new Take is numbered after the highest still in its Clip, worked out
-- from the Takes it holds, so a Clip no longer keeps the highest number it
-- ever gave.
ALTER TABLE clips DROP COLUMN last_take_number;
