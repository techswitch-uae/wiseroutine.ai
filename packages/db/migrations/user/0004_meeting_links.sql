-- Where a meeting is held: the Meet, Teams or Zoom link off the calendar event.
--
-- Both providers already send it - Google on `conferenceData`, Graph on
-- `onlineMeeting` - and until now it was read off the wire and thrown away, so
-- a block on the day said when a call was and never how to get into it.
--
-- Nullable, and null is the common case: most events are not online meetings.
-- Existing rows stay null until their calendar's next sync rewrites them,
-- which needs no backfill - a sync token that has not moved means nothing has
-- changed, and an event nobody has touched has no link to find.

-- AlterTable
ALTER TABLE "external_events" ADD COLUMN "join_url" TEXT;

-- And a way for the events already stored to pick one up.
--
-- Two things stand between an existing row and its link, and clearing one
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
