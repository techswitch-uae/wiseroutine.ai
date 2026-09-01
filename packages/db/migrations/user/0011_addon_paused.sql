-- Which activities an addon's switch turned off.
--
-- Switching an addon off has to take its activities off the day with it - an
-- activity whose session no longer exists is a slot that opens into nothing -
-- and switching it back on has to bring them back, or "off" is a one-way door
-- wearing a toggle's clothes.
--
-- That needs the two kinds of "paused" to be distinguishable. An activity the
-- *user* turned off must stay off when an addon is re-enabled; an activity the
-- *addon's switch* turned off should come back. `is_active` alone cannot tell
-- them apart, so the moment we did it is recorded here and cleared when they
-- are restored.
--
-- A timestamp rather than a flag, because the question "when did this stop
-- being on my day" is one a user eventually asks, and a boolean cannot answer
-- it.

-- ALTER
ALTER TABLE "activities" ADD COLUMN "paused_by_addon_at" INTEGER;
