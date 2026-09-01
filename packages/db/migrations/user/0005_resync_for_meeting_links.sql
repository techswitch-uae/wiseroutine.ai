-- Make the next sync notice the column 0004 added.
--
-- Separate from 0004, and that separation is the point: migrations are applied
-- by *name*, so a database that has already run 0004 will never run it again
-- however much it is edited afterwards. These statements began life appended
-- to that file, on a database that had run it half an hour earlier, and were
-- therefore dead on arrival - the column was there, and nothing ever filled
-- it. An applied migration is history; a change of mind is a new file.
--
-- Two things stand between an existing row and its join link, and clearing one
-- without the other changes nothing:
--
--  1. An incremental sync only returns what *changed*, and nothing has - the
--     link was always there, we just never asked for it. Dropping the sync
--     token makes the next pass a full one, which walks every event again.
--     (Graph's delta token also has the old `$select` frozen inside it, so it
--     could not return the field even if it did resend the event.)
--
--  2. `upsertEvents` skips a write when the provider's etag/changeKey matches
--     what we hold - which is exactly right for saving writes and exactly
--     wrong here, because the tag says the *event* has not changed while what
--     changed is the shape we keep it in. Clearing the tag makes that first
--     full pass write the row rather than skip it.
--
-- The cost is one rewrite of the event table per calendar, once. After that
-- the tags are back and the skip works as before.

-- AlterTable
UPDATE "external_events" SET "change_tag" = NULL;

-- AlterTable
UPDATE "calendar_sync_state" SET "sync_token" = NULL, "delta_link" = NULL;
