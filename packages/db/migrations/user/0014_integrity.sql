CREATE TABLE "_write_lock" ("id" INTEGER PRIMARY KEY, "version" INTEGER NOT NULL DEFAULT 0);
INSERT INTO "_write_lock" ("id") VALUES (1);
CREATE TABLE "_event_privacy" ("id" INTEGER PRIMARY KEY, "store_titles" INTEGER NOT NULL DEFAULT 1);
INSERT INTO "_event_privacy" ("id") VALUES (1);
CREATE TABLE "_slot_actions" ("id" TEXT PRIMARY KEY, "slot_id" TEXT NOT NULL, "fingerprint" TEXT NOT NULL);
