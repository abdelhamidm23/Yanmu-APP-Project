CREATE TABLE "pickup_card" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"guardian_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT nullif(current_setting('app.user_id', true), '')::uuid,
	"updated_by" uuid DEFAULT nullif(current_setting('app.user_id', true), '')::uuid,
	CONSTRAINT "pickup_card_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "student_attendance" ADD COLUMN "check_out_method" text;--> statement-breakpoint
ALTER TABLE "pickup_card" ADD CONSTRAINT "pickup_card_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickup_card" ADD CONSTRAINT "pickup_card_guardian_id_guardian_id_fk" FOREIGN KEY ("guardian_id") REFERENCES "public"."guardian"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickup_card" ADD CONSTRAINT "pickup_card_revoked_by_app_user_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pickup_card_one_active_per_guardian" ON "pickup_card" USING btree ("guardian_id") WHERE "pickup_card"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "pickup_card_branch_idx" ON "pickup_card" USING btree ("branch_id");--> statement-breakpoint
ALTER TABLE "student_attendance" ADD CONSTRAINT "student_attendance_check_out_method_check" CHECK ("student_attendance"."check_out_method" IN ('list', 'qr'));