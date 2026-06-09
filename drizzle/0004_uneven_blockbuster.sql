CREATE TABLE "adhoc_expenses" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"period_id" bigint NOT NULL,
	"region" text,
	"state" text,
	"district" text,
	"taluka" text,
	"activity" text,
	"activity_date" date,
	"budget_header" text,
	"expense_amount" numeric(14, 2),
	"vendor_name" text,
	"remarks" text,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "adhoc_expenses" ADD CONSTRAINT "adhoc_expenses_period_id_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "adhoc_expenses_period_idx" ON "adhoc_expenses" USING btree ("period_id");