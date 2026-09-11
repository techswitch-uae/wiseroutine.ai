CREATE TABLE "_write_lock" ("id" INTEGER PRIMARY KEY, "version" INTEGER NOT NULL DEFAULT 0);
INSERT INTO "_write_lock" ("id") VALUES (1);
