CREATE TYPE "public"."period_type" AS ENUM('month', 'quarter', 'fy');--> statement-breakpoint
CREATE TABLE "execution_items" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"execution_id" bigint NOT NULL,
	"item_name" text NOT NULL,
	"qty" numeric(14, 2) NOT NULL,
	"rate" numeric(14, 2) NOT NULL,
	"line_total" numeric(14, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "executions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"plan_row_id" bigint NOT NULL,
	"status" text,
	"unit_no" text,
	"per_unit_cost" numeric(14, 2),
	"total_cost" numeric(14, 2),
	"total_sqft" numeric(14, 2),
	"fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_master" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "periods" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"type" "period_type" NOT NULL,
	"label" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_rows" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"period_id" bigint NOT NULL,
	"activity" text NOT NULL,
	"sfid" text NOT NULL,
	"region" text,
	"state" text,
	"district" text,
	"taluka" text,
	"distributor" text,
	"dealer" text,
	"planned_cost" numeric(14, 2),
	"fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "plan_rows_match_key" UNIQUE("period_id","activity","sfid")
);
--> statement-breakpoint
ALTER TABLE "execution_items" ADD CONSTRAINT "execution_items_execution_id_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."executions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_plan_row_id_plan_rows_id_fk" FOREIGN KEY ("plan_row_id") REFERENCES "public"."plan_rows"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_rows" ADD CONSTRAINT "plan_rows_period_id_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "executions_plan_row_idx" ON "executions" USING btree ("plan_row_id");--> statement-breakpoint
CREATE INDEX "plan_rows_filter_idx" ON "plan_rows" USING btree ("period_id","activity","region","state","district");