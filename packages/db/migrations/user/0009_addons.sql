-- Addons: the package, and who owns what.
--
-- Three things at once, because they are one idea. An addon is a package
-- somebody outside this repo wrote; a widget is one card it may put in the
-- rail; `owner_addon_id` is what lets the server enforce "an addon may change
-- what it created, and nothing else" rather than trusting the client to.
--
-- Nothing loads an addon yet. The table exists now so that the thing which
-- does needs no migration, and so that the ownership columns have something to
-- refer to.

-- RenameTable
--
-- "Module" already meant the guided session an activity runs - `preset_key` on
-- `activities`, added in 0002. Reusing it for a rail card made every sentence
-- about either one ambiguous. A card in the rail is a widget.
--
-- Safe as a rename rather than a drop-and-create because nothing has ever read
-- or written this table: `/today` passed a hard-coded empty list to
-- `visibleWidgets`, so no row was ever consulted. It is still a rename, so a
-- database that somehow does hold rows keeps them.
ALTER TABLE "dashboard_modules" RENAME TO "widgets";
ALTER TABLE "widgets" RENAME COLUMN "module_key" TO "widget_key";

-- CreateTable
CREATE TABLE "addons" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "version" TEXT NOT NULL,
    "manifest_json" TEXT NOT NULL,
    "granted_json" TEXT NOT NULL,
    "bundle_hash" TEXT NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "installed_at" DATETIME NOT NULL
);

-- AlterTable
--
-- Null is the app's own, which is every row that exists today and most rows
-- that ever will. Deliberately not a foreign key: uninstalling an addon must
-- not take the user's history with it, and a slot whose owner is gone is a
-- slot nobody may touch rather than a slot to delete.
ALTER TABLE "activities" ADD COLUMN "owner_addon_id" TEXT;

-- AlterTable
--
-- Usually the same answer as the activity's owner, and stored anyway: an addon
-- may place a one-off slot directly rather than through an activity, and a
-- slot with no activity would otherwise have no owner to check.
ALTER TABLE "slots" ADD COLUMN "owner_addon_id" TEXT;

-- CreateIndex
--
-- "Everything this addon owns" is the query uninstall runs and every ownership
-- check narrows with. Both are nearly all NULL, which SQLite indexes happily.
CREATE INDEX "activities_owner_addon" ON "activities"("owner_addon_id");
CREATE INDEX "slots_owner_addon" ON "slots"("owner_addon_id");
