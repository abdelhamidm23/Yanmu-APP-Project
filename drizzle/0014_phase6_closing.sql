CREATE TABLE "balance_snapshot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"month" date NOT NULL,
	"cash_piastres" bigint,
	"bank_piastres" bigint,
	"batch_id" uuid,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT nullif(current_setting('app.user_id', true), '')::uuid,
	"updated_by" uuid DEFAULT nullif(current_setting('app.user_id', true), '')::uuid
);
--> statement-breakpoint
CREATE TABLE "daily_close" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"date" date NOT NULL,
	"sections" jsonb NOT NULL,
	"notes" text,
	"closed_by" uuid,
	"closed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_late" boolean DEFAULT false NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT nullif(current_setting('app.user_id', true), '')::uuid,
	"updated_by" uuid DEFAULT nullif(current_setting('app.user_id', true), '')::uuid,
	CONSTRAINT "daily_close_branch_date" UNIQUE("branch_id","date")
);
--> statement-breakpoint
CREATE TABLE "kpi_daily_snapshot" (
	"branch_id" uuid NOT NULL,
	"date" date NOT NULL,
	"kpi_key" text NOT NULL,
	"value" numeric,
	"status" text NOT NULL,
	"coverage" text,
	"taken_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kpi_daily_snapshot_branch_id_date_kpi_key_pk" PRIMARY KEY("branch_id","date","kpi_key"),
	CONSTRAINT "kpi_snapshot_status_check" CHECK ("kpi_daily_snapshot"."status" IN ('verified', 'provisional', 'incomplete', 'not_submitted', 'confirmed'))
);
--> statement-breakpoint
CREATE TABLE "period_close" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"month" date NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"closed_by" uuid,
	"closed_at" timestamp with time zone,
	"reopen_requested_by" uuid,
	"reopen_requested_at" timestamp with time zone,
	"reopen_reason" text,
	"reopened_by" uuid,
	"reopened_at" timestamp with time zone,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT nullif(current_setting('app.user_id', true), '')::uuid,
	"updated_by" uuid DEFAULT nullif(current_setting('app.user_id', true), '')::uuid,
	CONSTRAINT "period_close_branch_month" UNIQUE("branch_id","month"),
	CONSTRAINT "period_close_status_check" CHECK ("period_close"."status" IN ('open', 'closed')),
	CONSTRAINT "period_close_month_check" CHECK (extract(day from "period_close"."month") = 1)
);
--> statement-breakpoint
CREATE TABLE "period_import_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period_close_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"line_key" text NOT NULL,
	"category_id" uuid,
	"app_piastres" bigint,
	"amount_piastres" bigint NOT NULL,
	"note" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT nullif(current_setting('app.user_id', true), '')::uuid,
	"updated_by" uuid DEFAULT nullif(current_setting('app.user_id', true), '')::uuid,
	CONSTRAINT "period_import_line_kind_check" CHECK ("period_import_line"."kind" IN ('check', 'central', 'balance'))
);
--> statement-breakpoint
ALTER TABLE "balance_snapshot" ADD CONSTRAINT "balance_snapshot_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "balance_snapshot" ADD CONSTRAINT "balance_snapshot_batch_id_import_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_close" ADD CONSTRAINT "daily_close_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_close" ADD CONSTRAINT "daily_close_closed_by_app_user_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_daily_snapshot" ADD CONSTRAINT "kpi_daily_snapshot_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_close" ADD CONSTRAINT "period_close_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_close" ADD CONSTRAINT "period_close_closed_by_app_user_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_close" ADD CONSTRAINT "period_close_reopen_requested_by_app_user_id_fk" FOREIGN KEY ("reopen_requested_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_close" ADD CONSTRAINT "period_close_reopened_by_app_user_id_fk" FOREIGN KEY ("reopened_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_import_line" ADD CONSTRAINT "period_import_line_period_close_id_period_close_id_fk" FOREIGN KEY ("period_close_id") REFERENCES "public"."period_close"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_import_line" ADD CONSTRAINT "period_import_line_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_import_line" ADD CONSTRAINT "period_import_line_batch_id_import_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_import_line" ADD CONSTRAINT "period_import_line_category_id_expense_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."expense_category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "balance_snapshot_branch_month_idx" ON "balance_snapshot" USING btree ("branch_id","month");--> statement-breakpoint
CREATE INDEX "period_import_line_period_idx" ON "period_import_line" USING btree ("period_close_id");