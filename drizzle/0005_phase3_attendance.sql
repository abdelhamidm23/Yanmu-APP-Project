CREATE TABLE "device_login" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_login_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "import_mapping" (
	"branch_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"mapping" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT nullif(current_setting('app.user_id', true), '')::uuid,
	"updated_by" uuid DEFAULT nullif(current_setting('app.user_id', true), '')::uuid,
	CONSTRAINT "import_mapping_branch_id_kind_pk" PRIMARY KEY("branch_id","kind")
);
--> statement-breakpoint
CREATE TABLE "pickup_refusal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"person_name" text,
	"note" text,
	"happened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"client_uuid" uuid,
	"acknowledged_by" uuid,
	"acknowledged_at" timestamp with time zone,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT nullif(current_setting('app.user_id', true), '')::uuid,
	"updated_by" uuid DEFAULT nullif(current_setting('app.user_id', true), '')::uuid,
	CONSTRAINT "pickup_refusal_client_uuid_unique" UNIQUE("client_uuid")
);
--> statement-breakpoint
CREATE TABLE "ratio_snapshot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"room_id" uuid NOT NULL,
	"taken_at" timestamp with time zone DEFAULT now() NOT NULL,
	"children_present" integer NOT NULL,
	"carers_present" integer NOT NULL,
	"required_carers" integer NOT NULL,
	"is_breach" boolean NOT NULL,
	"reason" text NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_by" uuid DEFAULT nullif(current_setting('app.user_id', true), '')::uuid
);
--> statement-breakpoint
CREATE TABLE "room_roster" (
	"staff_id" uuid NOT NULL,
	"date" date NOT NULL,
	"branch_id" uuid NOT NULL,
	"room_id" uuid,
	"marked_present" boolean,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT nullif(current_setting('app.user_id', true), '')::uuid,
	"updated_by" uuid DEFAULT nullif(current_setting('app.user_id', true), '')::uuid,
	CONSTRAINT "room_roster_staff_id_date_pk" PRIMARY KEY("staff_id","date")
);
--> statement-breakpoint
CREATE TABLE "staff" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid,
	"full_name_ar" text NOT NULL,
	"full_name_en" text NOT NULL,
	"job_title" text NOT NULL,
	"is_qualified_carer" boolean DEFAULT true NOT NULL,
	"default_room_id" uuid,
	"device_employee_no" text,
	"shift_start" text DEFAULT '08:00' NOT NULL,
	"start_date" date,
	"end_date" date,
	"status" text DEFAULT 'active' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT nullif(current_setting('app.user_id', true), '')::uuid,
	"updated_by" uuid DEFAULT nullif(current_setting('app.user_id', true), '')::uuid,
	CONSTRAINT "staff_status_check" CHECK ("staff"."status" IN ('active', 'left')),
	CONSTRAINT "staff_shift_check" CHECK ("staff"."shift_start" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
);
--> statement-breakpoint
CREATE TABLE "staff_attendance_day" (
	"staff_id" uuid NOT NULL,
	"date" date NOT NULL,
	"branch_id" uuid NOT NULL,
	"first_in" timestamp with time zone,
	"last_out" timestamp with time zone,
	"status" text NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT nullif(current_setting('app.user_id', true), '')::uuid,
	"updated_by" uuid DEFAULT nullif(current_setting('app.user_id', true), '')::uuid,
	CONSTRAINT "staff_attendance_day_staff_id_date_pk" PRIMARY KEY("staff_id","date"),
	CONSTRAINT "staff_attendance_day_status_check" CHECK ("staff_attendance_day"."status" IN ('present', 'late', 'absent', 'leave'))
);
--> statement-breakpoint
CREATE TABLE "staff_punch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"staff_id" uuid,
	"device_employee_no" text NOT NULL,
	"person_name" text,
	"punched_at" timestamp with time zone NOT NULL,
	"device" text,
	"import_batch_id" uuid,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT nullif(current_setting('app.user_id', true), '')::uuid,
	"updated_by" uuid DEFAULT nullif(current_setting('app.user_id', true), '')::uuid,
	CONSTRAINT "staff_punch_unique" UNIQUE("branch_id","device_employee_no","punched_at")
);
--> statement-breakpoint
CREATE TABLE "student_attendance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"room_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"date" date NOT NULL,
	"status" text NOT NULL,
	"excuse_reason" text,
	"check_in_at" timestamp with time zone,
	"check_out_at" timestamp with time zone,
	"collected_by_guardian_id" uuid,
	"client_uuid" uuid,
	"client_at" timestamp with time zone,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT nullif(current_setting('app.user_id', true), '')::uuid,
	"updated_by" uuid DEFAULT nullif(current_setting('app.user_id', true), '')::uuid,
	CONSTRAINT "student_attendance_day_unique" UNIQUE("student_id","date"),
	CONSTRAINT "student_attendance_status_check" CHECK ("student_attendance"."status" IN ('present', 'absent', 'excused'))
);
--> statement-breakpoint
ALTER TABLE "app_user" ADD COLUMN "pin_hash" text;--> statement-breakpoint
ALTER TABLE "auth_session" ADD COLUMN "shared_device" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "auth_session" ADD COLUMN "last_active_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "device_login" ADD CONSTRAINT "device_login_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_mapping" ADD CONSTRAINT "import_mapping_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickup_refusal" ADD CONSTRAINT "pickup_refusal_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickup_refusal" ADD CONSTRAINT "pickup_refusal_student_id_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickup_refusal" ADD CONSTRAINT "pickup_refusal_acknowledged_by_app_user_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratio_snapshot" ADD CONSTRAINT "ratio_snapshot_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratio_snapshot" ADD CONSTRAINT "ratio_snapshot_room_id_room_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."room"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_roster" ADD CONSTRAINT "room_roster_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_roster" ADD CONSTRAINT "room_roster_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_roster" ADD CONSTRAINT "room_roster_room_id_room_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."room"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_default_room_id_room_id_fk" FOREIGN KEY ("default_room_id") REFERENCES "public"."room"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_attendance_day" ADD CONSTRAINT "staff_attendance_day_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_attendance_day" ADD CONSTRAINT "staff_attendance_day_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_punch" ADD CONSTRAINT "staff_punch_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_punch" ADD CONSTRAINT "staff_punch_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_punch" ADD CONSTRAINT "staff_punch_import_batch_id_import_batch_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_attendance" ADD CONSTRAINT "student_attendance_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_attendance" ADD CONSTRAINT "student_attendance_room_id_room_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."room"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_attendance" ADD CONSTRAINT "student_attendance_student_id_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_attendance" ADD CONSTRAINT "student_attendance_collected_by_guardian_id_guardian_id_fk" FOREIGN KEY ("collected_by_guardian_id") REFERENCES "public"."guardian"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "device_login_user_idx" ON "device_login" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "pickup_refusal_branch_idx" ON "pickup_refusal" USING btree ("branch_id","happened_at");--> statement-breakpoint
CREATE INDEX "ratio_snapshot_room_idx" ON "ratio_snapshot" USING btree ("room_id","taken_at");--> statement-breakpoint
CREATE INDEX "ratio_snapshot_branch_idx" ON "ratio_snapshot" USING btree ("branch_id","taken_at");--> statement-breakpoint
CREATE INDEX "room_roster_branch_date_idx" ON "room_roster" USING btree ("branch_id","date");--> statement-breakpoint
CREATE INDEX "staff_branch_idx" ON "staff" USING btree ("branch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_user_unique" ON "staff" USING btree ("user_id") WHERE "staff"."user_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "staff_device_no_unique" ON "staff" USING btree ("branch_id","device_employee_no") WHERE "staff"."device_employee_no" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "staff_attendance_day_branch_idx" ON "staff_attendance_day" USING btree ("branch_id","date");--> statement-breakpoint
CREATE INDEX "staff_punch_batch_idx" ON "staff_punch" USING btree ("import_batch_id");--> statement-breakpoint
CREATE INDEX "staff_punch_staff_idx" ON "staff_punch" USING btree ("staff_id","punched_at");--> statement-breakpoint
CREATE INDEX "student_attendance_branch_date_idx" ON "student_attendance" USING btree ("branch_id","date");