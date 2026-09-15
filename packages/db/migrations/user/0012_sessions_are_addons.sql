-- The last three built-in sessions moved out of the app and into addons.
--
-- Breathing went first, in 0010, and the reasoning there applies unchanged to
-- these three: `preset_key` names what runs an activity, and a key that is
-- renamed underneath a user leaves them pressing Start on a block with no
-- session and no explanation. An addon *removed* leaves rows naming it and
-- those must keep working; an addon *renamed* has to bring its rows with it.
--
-- The keys are namespaced now - `addonId/activityTypeKey` - because that is
-- how the app finds the addon that owns one. Nothing else about these
-- activities changes: the same minutes, the same days, the same config column.
--
-- Config is deliberately not migrated. Eye rest and deep work keep the shape
-- they had (`metres`, `musicUrl`), and a stretch's stored `steps` array is no
-- longer a setting anyone could edit - the addon holds three routines and the
-- setting is which one. A config that no longer matches its schema falls back
-- to the schema's defaults on the next read, which is the rule the whole addon
-- boundary already follows, so an unmigrated stretch simply opens on the
-- default routine rather than breaking.

-- UPDATE
UPDATE "activities" SET "preset_key" = 'wiseroutine.eye-rest/look-away' WHERE "preset_key" = 'eye_rest';

-- UPDATE
UPDATE "activities" SET "preset_key" = 'wiseroutine.stretch/guided' WHERE "preset_key" = 'stretch';

-- UPDATE
UPDATE "activities" SET "preset_key" = 'wiseroutine.deep-work/focus' WHERE "preset_key" = 'deep_work';
