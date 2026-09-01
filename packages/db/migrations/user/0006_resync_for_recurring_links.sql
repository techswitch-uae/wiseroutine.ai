-- One more full pass, for the recurring meetings.
--
-- 0005 got the links onto the one-off meetings and left every recurring one
-- empty-handed: Graph states a series' join link once, on the series master,
-- and sends occurrences without it - the same inheritance the subject needed
-- and did not get, one field along. The pass ran, wrote the occurrences, and
-- wrote null.
--
-- So the rows are current as far as the sync is concerned - tags restored,
-- tokens re-issued - and wrong. Same two clears as 0005, and a new file rather
-- than an edit to it, because a migration is applied by name: amending one
-- that has already run changes nothing on any database that has run it. That
-- mistake is what made 0005 necessary in the first place.

-- AlterTable
UPDATE "external_events" SET "change_tag" = NULL;

-- AlterTable
UPDATE "calendar_sync_state" SET "sync_token" = NULL, "delta_link" = NULL;
