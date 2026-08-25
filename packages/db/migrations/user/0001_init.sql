-- CreateTable
CREATE TABLE "calendar_connections" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "provider_account_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "scopes" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "oauth_tokens" (
    "connection_id" TEXT NOT NULL PRIMARY KEY,
    "access_token_ciphertext" TEXT NOT NULL,
    "access_token_iv" TEXT NOT NULL,
    "refresh_token_ciphertext" TEXT,
    "refresh_token_iv" TEXT,
    "key_version" INTEGER NOT NULL DEFAULT 1,
    "expires_at" DATETIME NOT NULL,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "oauth_tokens_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "calendar_connections" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "calendars" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "connection_id" TEXT NOT NULL,
    "provider_calendar_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "time_zone" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "is_selected" BOOLEAN NOT NULL DEFAULT true,
    "access_role" TEXT,
    "created_at" DATETIME NOT NULL,
    CONSTRAINT "calendars_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "calendar_connections" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "calendar_sync_state" (
    "calendar_id" TEXT NOT NULL PRIMARY KEY,
    "sync_token" TEXT,
    "delta_link" TEXT,
    "last_full_sync_at" DATETIME,
    "last_incremental_at" DATETIME,
    "window_rebased_at" DATETIME,
    "watch_channel_id" TEXT,
    "watch_resource_id" TEXT,
    "watch_secret" TEXT,
    "watch_expires_at" DATETIME,
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "sync_generation" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "calendar_sync_state_calendar_id_fkey" FOREIGN KEY ("calendar_id") REFERENCES "calendars" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "external_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "calendar_id" TEXT NOT NULL,
    "provider_event_id" TEXT NOT NULL,
    "ical_uid" TEXT,
    "series_master_id" TEXT,
    "title" TEXT,
    "starts_at" DATETIME NOT NULL,
    "ends_at" DATETIME NOT NULL,
    "time_zone" TEXT,
    "is_all_day" BOOLEAN NOT NULL DEFAULT false,
    "kind" TEXT NOT NULL DEFAULT 'default',
    "busy_status" TEXT NOT NULL DEFAULT 'busy',
    "response_status" TEXT NOT NULL DEFAULT 'none',
    "is_cancelled" BOOLEAN NOT NULL DEFAULT false,
    "change_tag" TEXT,
    "provider_updated_at" DATETIME,
    "deleted_at" DATETIME,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "external_events_calendar_id_fkey" FOREIGN KEY ("calendar_id") REFERENCES "calendars" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "activities" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "icon" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "minimum_type" TEXT NOT NULL,
    "minimum_value" INTEGER NOT NULL,
    "session_minutes" INTEGER NOT NULL,
    "days_of_week" INTEGER NOT NULL DEFAULT 127,
    "importance" TEXT NOT NULL DEFAULT 'normal',
    "grace_minutes" INTEGER NOT NULL DEFAULT 3,
    "buffer_before_meeting_minutes" INTEGER NOT NULL DEFAULT 0,
    "write_to_calendar" BOOLEAN NOT NULL DEFAULT false,
    "write_target_connection_id" TEXT,
    "created_at" DATETIME NOT NULL,
    "archived_at" DATETIME
);

-- CreateTable
CREATE TABLE "activity_windows" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "activity_id" TEXT NOT NULL,
    "anchor_minutes" INTEGER NOT NULL,
    CONSTRAINT "activity_windows_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "activities" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "slots" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "activity_id" TEXT,
    "reminder_id" TEXT,
    "title" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "starts_at" DATETIME NOT NULL,
    "ends_at" DATETIME NOT NULL,
    "time_zone" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "is_locked" BOOLEAN NOT NULL DEFAULT false,
    "conflict_event_id" TEXT,
    "conflict_severity" TEXT,
    "auto_move_count" INTEGER NOT NULL DEFAULT 0,
    "plan_run_id" TEXT,
    "created_at" DATETIME NOT NULL,
    CONSTRAINT "slots_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "activities" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "slot_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slot_id" TEXT NOT NULL,
    "at" DATETIME NOT NULL,
    "type" TEXT NOT NULL,
    "reason_code" TEXT,
    "reason_text" TEXT,
    "from_starts_at" DATETIME,
    "to_starts_at" DATETIME,
    "actor" TEXT NOT NULL,
    CONSTRAINT "slot_events_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "slots" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "reminders" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "due_window" TEXT NOT NULL,
    "due_date" TEXT,
    "estimated_minutes" INTEGER,
    "needs_focus" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'open',
    "slot_id" TEXT,
    "created_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "plan_runs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "local_date" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "engine_version" TEXT NOT NULL,
    "inputs_hash" TEXT NOT NULL,
    "placed_count" INTEGER NOT NULL DEFAULT 0,
    "unplaced_count" INTEGER NOT NULL DEFAULT 0,
    "duration_ms" INTEGER,
    "created_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "dashboard_modules" (
    "module_key" TEXT NOT NULL PRIMARY KEY,
    "position" INTEGER NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true
);

-- CreateTable
CREATE TABLE "desk_sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "started_at" DATETIME NOT NULL,
    "ended_at" DATETIME
);

-- CreateIndex
CREATE UNIQUE INDEX "connections_provider_account" ON "calendar_connections"("provider", "provider_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "calendars_provider_id" ON "calendars"("connection_id", "provider_calendar_id");

-- CreateIndex
CREATE INDEX "sync_state_watch_channel" ON "calendar_sync_state"("watch_channel_id");

-- CreateIndex
CREATE INDEX "events_start" ON "external_events"("starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "events_provider_id" ON "external_events"("calendar_id", "provider_event_id");

-- CreateIndex
CREATE INDEX "activities_active" ON "activities"("is_active");

-- CreateIndex
CREATE INDEX "activity_windows_activity" ON "activity_windows"("activity_id");

-- CreateIndex
CREATE INDEX "slots_start" ON "slots"("starts_at");

-- CreateIndex
CREATE INDEX "slots_status" ON "slots"("status", "starts_at");

-- CreateIndex
CREATE INDEX "slot_events_slot" ON "slot_events"("slot_id");

-- CreateIndex
CREATE INDEX "slot_events_at" ON "slot_events"("at");

-- CreateIndex
CREATE INDEX "reminders_status" ON "reminders"("status");

-- CreateIndex
CREATE INDEX "plan_runs_date" ON "plan_runs"("local_date");

-- CreateIndex
CREATE INDEX "desk_sessions_started" ON "desk_sessions"("started_at");

