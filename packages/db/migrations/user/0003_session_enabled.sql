-- Whether a library activity's guided session takes over when its slot starts.
--
-- Separate from `preset_key`, which stays put as the activity's identity - it
-- is what says "this is the eye rest one", and clearing it to mean "off" would
-- lose which module to turn back on. Off is a plain timed slot: the slot still
-- runs, it just does not put anything on the screen.

-- AlterTable
ALTER TABLE "activities" ADD COLUMN "session_enabled" BOOLEAN NOT NULL DEFAULT true;
