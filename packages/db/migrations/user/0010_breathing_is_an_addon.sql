-- Breathing moved out of the app and into an addon.
--
-- `preset_key` names what runs an activity, and the app's own breathing pacer
-- used to be called `breathing`. It is now `addons/breathing`, installed the
-- way any community addon is, and the key it claims is namespaced:
-- `wiseroutine.breathing/pacer`.
--
-- Without this, every activity already configured as breathing keeps a key
-- nothing claims. That degrades safely - the slot runs as a plain timed block
-- rather than crashing, which is the behaviour an uninstalled addon is
-- supposed to have - but it is not what happened here. Nobody uninstalled
-- anything; the key was renamed underneath them, and a user pressing Start
-- would get a block with no session and no explanation.
--
-- The distinction is worth keeping straight, because it is the difference
-- between a migration and a bug: an addon *removed* leaves rows naming it, and
-- those must keep working. An addon *renamed* has to bring its rows with it.

-- UPDATE
UPDATE "activities"
SET "preset_key" = 'wiseroutine.breathing/pacer'
WHERE "preset_key" = 'breathing';
