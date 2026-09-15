-- What the organiser wrote, and one more pass to fetch it.
--
-- Half the useful detail about a meeting is in its description - the agenda,
-- the dial-in, the "bring the deck" - and a great many meetings put their join
-- link in there and nowhere else: anything booked through Calendly, HubSpot or
-- a Zoom scheduler arrives with an empty `conferenceData` and a body full of
-- instructions. Reading only the structured field found the Google-booked
-- meetings and missed everything else.
--
-- Plain text, capped, and written only when the account stores titles - it is
-- the most personal thing a calendar holds.
--
-- The clears are the same pair as 0005 and 0006, for the same reason: a column
-- added to a table of rows the provider considers unchanged is a column that
-- stays empty until something makes the sync walk them all again.

-- AlterTable
ALTER TABLE "external_events" ADD COLUMN "description" TEXT;

-- AlterTable
UPDATE "external_events" SET "change_tag" = NULL;

-- AlterTable
UPDATE "calendar_sync_state" SET "sync_token" = NULL, "delta_link" = NULL;
