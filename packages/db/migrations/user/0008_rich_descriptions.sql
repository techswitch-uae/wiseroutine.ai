-- Fetch the descriptions again, now that their formatting survives the trip.
--
-- 0007 stored them flattened: an agenda arrived as a wall of text with its
-- emphasis gone and its links no longer links. They are kept as a small
-- notation now - `**bold**`, `_italic_`, `[label](url)` - which the reader
-- turns into elements without ever parsing markup, so the rows written by 0007
-- are the right column with the wrong contents in it.
--
-- Same two clears as 0005, 0006 and 0007, for the same reason, and a new file
-- rather than an edit for the same reason again: a migration is applied by
-- name, so amending one that has run changes nothing anywhere it has run.
--
-- Four of these in a row is three too many. The thing actually being asked for
-- each time is "read this calendar again", which belongs in the app as an
-- action rather than in a migration as a side effect.

-- AlterTable
UPDATE "external_events" SET "change_tag" = NULL;

-- AlterTable
UPDATE "calendar_sync_state" SET "sync_token" = NULL, "delta_link" = NULL;
