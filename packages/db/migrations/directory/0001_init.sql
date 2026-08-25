-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "avatar_url" TEXT,
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "time_zone" TEXT NOT NULL DEFAULT 'UTC',
    "locale" TEXT NOT NULL DEFAULT 'en',
    "day_start_minutes" INTEGER NOT NULL DEFAULT 480,
    "day_end_minutes" INTEGER NOT NULL DEFAULT 1080,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "plan_source" TEXT NOT NULL DEFAULT 'default',
    "plan_expires_at" DATETIME,
    "store_event_titles" BOOLEAN NOT NULL DEFAULT true,
    "database_name" TEXT NOT NULL,
    "database_ready" BOOLEAN NOT NULL DEFAULT false,
    "last_seen_at" DATETIME,
    "created_at" DATETIME NOT NULL,
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires_at" DATETIME NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" DATETIME NOT NULL,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "access_token" TEXT,
    "refresh_token" TEXT,
    "id_token" TEXT,
    "access_token_expires_at" DATETIME,
    "refresh_token_expires_at" DATETIME,
    "scope" TEXT,
    "password" TEXT,
    "created_at" DATETIME NOT NULL,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "verifications" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expires_at" DATETIME NOT NULL,
    "created_at" DATETIME NOT NULL,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "rate_limits" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "last_request" BIGINT NOT NULL
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "user_id" TEXT NOT NULL PRIMARY KEY,
    "stripe_customer_id" TEXT NOT NULL,
    "stripe_subscription_id" TEXT,
    "stripe_price_id" TEXT,
    "status" TEXT NOT NULL,
    "current_period_end" DATETIME,
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "plan_grants" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "plan" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "granted_by" TEXT NOT NULL,
    "expires_at" DATETIME,
    "revoked_at" DATETIME,
    "created_at" DATETIME NOT NULL,
    CONSTRAINT "plan_grants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "scheduled_work" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "target_id" TEXT NOT NULL DEFAULT '',
    "due_at" DATETIME NOT NULL,
    "backoff_until" DATETIME,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL,
    CONSTRAINT "scheduled_work_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "watch_channels" (
    "channel_id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "calendar_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "expires_at" DATETIME NOT NULL,
    "created_at" DATETIME NOT NULL,
    CONSTRAINT "watch_channels_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "devices" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "onesignal_subscription_id" TEXT,
    "app_version" TEXT,
    "last_seen_at" DATETIME NOT NULL,
    "created_at" DATETIME NOT NULL,
    CONSTRAINT "devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "processed_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source" TEXT NOT NULL,
    "processed_at" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_database_name" ON "users"("database_name");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token" ON "sessions"("token");

-- CreateIndex
CREATE INDEX "sessions_user" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "accounts_user" ON "accounts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_issuer_account" ON "accounts"("issuer", "account_id");

-- CreateIndex
CREATE INDEX "verifications_identifier" ON "verifications"("identifier");

-- CreateIndex
CREATE UNIQUE INDEX "rate_limits_key" ON "rate_limits"("key");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_customer" ON "subscriptions"("stripe_customer_id");

-- CreateIndex
CREATE INDEX "plan_grants_user" ON "plan_grants"("user_id");

-- CreateIndex
CREATE INDEX "scheduled_work_due" ON "scheduled_work"("due_at");

-- CreateIndex
CREATE UNIQUE INDEX "scheduled_work_target" ON "scheduled_work"("user_id", "kind", "target_id");

-- CreateIndex
CREATE INDEX "watch_channels_user" ON "watch_channels"("user_id");

-- CreateIndex
CREATE INDEX "watch_channels_expiry" ON "watch_channels"("expires_at");

-- CreateIndex
CREATE INDEX "devices_user" ON "devices"("user_id");

-- CreateIndex
CREATE INDEX "processed_events_at" ON "processed_events"("processed_at");

