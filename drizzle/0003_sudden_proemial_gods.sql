ALTER TABLE "plan_rows" ADD COLUMN "source" text DEFAULT 'plan-upload' NOT NULL;--> statement-breakpoint
ALTER TABLE "plan_rows" ADD COLUMN "exception_reason" text;--> statement-breakpoint
ALTER TABLE "plan_rows" ADD COLUMN "created_via" text;--> statement-breakpoint
ALTER TABLE "plan_rows" ADD COLUMN "created_at" timestamp with time zone DEFAULT now();--> statement-breakpoint
ALTER TABLE "plan_rows" ADD CONSTRAINT "plan_rows_source_check" CHECK ("plan_rows"."source" in ('plan-upload', 'exception'));--> statement-breakpoint
UPDATE "executions" SET "status" = 'In Progress' WHERE "status" IS NULL;
