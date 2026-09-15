-- Addon-level settings. Per-activity settings live on the activity; these are
-- for the addon as a whole, edited on the Addons page. Secrets are never
-- stored here.

-- ALTER TABLE
ALTER TABLE "addons" ADD COLUMN "settings_json" TEXT NOT NULL DEFAULT '{}';
