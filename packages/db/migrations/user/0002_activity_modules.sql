-- Which module runs an activity, how it starts, and the module's own settings.
--
-- `preset_key` is null for an activity with no module - a plain timed slot,
-- which is what every activity was before this. `config_json` is TEXT owned by
-- whichever module reads it: one column rather than a table per module, so a
-- new module is a file rather than a migration.

-- AlterTable
ALTER TABLE "activities" ADD COLUMN "preset_key" TEXT;

-- AlterTable
-- "manual" | "auto" | "prompt". Manual is what every existing activity already
-- does - shows a Start button, and moves itself after the grace period - so
-- the default is the behaviour nobody has to be migrated out of.
ALTER TABLE "activities" ADD COLUMN "start_policy" TEXT NOT NULL DEFAULT 'manual';

-- AlterTable
ALTER TABLE "activities" ADD COLUMN "config_json" TEXT;
