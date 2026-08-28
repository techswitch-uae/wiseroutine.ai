-- AlterTable
ALTER TABLE "users" ADD COLUMN "custom_range_label" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN "custom_range_start_minutes" INTEGER;

-- AlterTable
ALTER TABLE "users" ADD COLUMN "custom_range_end_minutes" INTEGER;

-- AlterTable
ALTER TABLE "users" ADD COLUMN "day_opens_on" TEXT NOT NULL DEFAULT 'working';

-- AlterTable
ALTER TABLE "users" ADD COLUMN "show_outside_range" BOOLEAN NOT NULL DEFAULT true;
