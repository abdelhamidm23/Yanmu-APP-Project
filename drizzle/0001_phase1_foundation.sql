CREATE TABLE "academic_year" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"label" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT nullif(current_setting('app.user_id', true), '')::uuid,
	"updated_by" uuid DEFAULT nullif(current_setting('app.user_id', true), '')::uuid
);
--> statement-breakpoint
CREATE TABLE "age_band" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text NOT NULL,
	"min_age_months" integer NOT NULL,
	"max_age_months" integer NOT NULL,
	"children_per_staff" integer NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT nullif(current_setting('app.user_id', true), '')::uuid,
	"updated_by" uuid DEFAULT nullif(current_setting('app.user_id', true), '')::uuid,
	CONSTRAINT "age_band_key_unique" UNIQUE("org_id","key")
);
--> statement-breakpoint
CREATE TABLE "audit_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" uuid,
	"branch_id" uuid,
	"table_name" text NOT NULL,
	"row_id" text NOT NULL,
	"action" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "branch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text NOT NULL,
	"code" text NOT NULL,
	"licensed_capacity" integer DEFAULT 100 NOT NULL,
	"physical_capacity" integer DEFAULT 200 NOT NULL,
	"licence_no" text,
	"licence_expiry" date,
	"timezone" text DEFAULT 'Africa/Cairo' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT nullif(current_setting('app.user_id', true), '')::uuid,
	"updated_by" uuid DEFAULT nullif(current_setting('app.user_id', true), '')::uuid,
	CONSTRAINT "branch_code_unique" UNIQUE("org_id","code")
);
--> statement-breakpoint
CREATE TABLE "calendar_day" (
	"branch_id" uuid NOT NULL,
	"date" date NOT NULL,
	"is_working_day" boolean NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT nullif(current_setting('app.user_id', true), '')::uuid,
	"updated_by" uuid DEFAULT nullif(current_setting('app.user_id', true), '')::uuid,
	CONSTRAINT "calendar_day_branch_id_date_pk" PRIMARY KEY("branch_id","date")
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT nullif(current_setting('app.user_id', true), '')::uuid,
	"updated_by" uuid DEFAULT nullif(current_setting('app.user_id', true), '')::uuid
);
--> statement-breakpoint
CREATE TABLE "room" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text NOT NULL,
	"age_band_id" uuid NOT NULL,
	"capacity" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT nullif(current_setting('app.user_id', true), '')::uuid,
	"updated_by" uuid DEFAULT nullif(current_setting('app.user_id', true), '')::uuid
);
--> statement-breakpoint
CREATE TABLE "setting" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"branch_id" uuid,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT nullif(current_setting('app.user_id', true), '')::uuid,
	"updated_by" uuid DEFAULT nullif(current_setting('app.user_id', true), '')::uuid,
	CONSTRAINT "setting_unique" UNIQUE NULLS NOT DISTINCT("org_id","branch_id","key")
);
--> statement-breakpoint
CREATE TABLE "term" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"label" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT nullif(current_setting('app.user_id', true), '')::uuid,
	"updated_by" uuid DEFAULT nullif(current_setting('app.user_id', true), '')::uuid
);
--> statement-breakpoint
ALTER TABLE "app_user" ADD COLUMN "credentials_reset_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "academic_year" ADD CONSTRAINT "academic_year_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "age_band" ADD CONSTRAINT "age_band_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch" ADD CONSTRAINT "branch_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_day" ADD CONSTRAINT "calendar_day_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room" ADD CONSTRAINT "room_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room" ADD CONSTRAINT "room_age_band_id_age_band_id_fk" FOREIGN KEY ("age_band_id") REFERENCES "public"."age_band"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setting" ADD CONSTRAINT "setting_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setting" ADD CONSTRAINT "setting_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "term" ADD CONSTRAINT "term_academic_year_id_academic_year_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_year"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_event_at_idx" ON "audit_event" USING btree ("at");--> statement-breakpoint
CREATE INDEX "audit_event_table_row_idx" ON "audit_event" USING btree ("table_name","row_id");--> statement-breakpoint
CREATE INDEX "room_branch_idx" ON "room" USING btree ("branch_id");--> statement-breakpoint
ALTER TABLE "user_branch_role" ADD CONSTRAINT "user_branch_role_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_branch_role_branch_idx" ON "user_branch_role" USING btree ("branch_id");