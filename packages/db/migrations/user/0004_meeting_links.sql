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
