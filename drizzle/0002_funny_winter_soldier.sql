ALTER TABLE "plan_rows" ADD COLUMN "source" text DEFAULT 'plan-upload' NOT NULL;--> statement-breakpoint
ALTER TABLE "plan_rows" ADD COLUMN "exception_reason" text;--> statement-breakpoint
ALTER TABLE "plan_rows" ADD COLUMN "created_via" text;--> statement-breakpoint
ALTER TABLE "plan_rows" ADD COLUMN "created_at" timestamp with time zone DEFAULT now();--> statement-breakpoint
ALTER TABLE "plan_rows" ADD CONSTRAINT "plan_rows_source_check" CHECK ("plan_rows"."source" in ('plan-upload', 'exception'));--> statement-breakpoint
-- GRID-10 backfill (D3.1-07): forward-only, idempotent. Hand-appended after drizzle-kit
-- generate (which emits DDL only, never data DML — RESEARCH R9). Second pass matches 0 rows.
-- executions.status stays nullable with NO DB default — the app (buildRowModel/cloneUnitForAdd)
-- is the source of truth for new-row defaults (D3.1-03). This is a one-time data correction.
UPDATE "executions" SET "status" = 'In Progress' WHERE "status" IS NULL;