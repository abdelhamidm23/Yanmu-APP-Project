CREATE TABLE "approval_step" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"step_no" integer NOT NULL,
	"decision" text NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT nullif(current_setting('app.user_id', true), '')::uuid,
	"updated_by" uuid DEFAULT nullif(current_setting('app.user_id', true), '')::uuid,
	CONSTRAINT "approval_step_decision_check" CHECK ("approval_step"."decision" IN ('approve', 'reject', 'recommend_approve', 'recommend_reject', 'question', 'answer'))
);
--> statement-breakpoint
CREATE TABLE "branch_routine_category" (
	"branch_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT nullif(current_setting('app.user_id', true), '')::uuid,
	"updated_by" uuid DEFAULT nullif(current_setting('app.user_id', true), '')::uuid,
	CONSTRAINT "branch_routine_category_branch_id_category_id_pk" PRIMARY KEY("branch_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "cash_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"date" date NOT NULL,
	"opening_float_piastres" bigint NOT NULL,
	"cash_in_piastres" bigint,
	"cash_out_piastres" bigint,
	"counted_piastres" bigint,
	"handed_over_piastres" bigint,
	"handed_to" text,
	"variance_piastres" bigint,
	"closed_at" timestamp with time zone,
	"closed_by" uuid,
	"reconciled_at" timestamp with time zone,
	"reconciled_by" uuid,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT nullif(current_setting('app.user_id', true), '')::uuid,
	"updated_by" uuid DEFAULT nullif(current_setting('app.user_id', true), '')::uuid,
	CONSTRAINT "cash_session_branch_date_unique" UNIQUE("branch_id","date"),
	CONSTRAINT "cash_session_float_check" CHECK ("cash_session"."opening_float_piastres" >= 0)
);
--> statement-breakpoint
CREATE TABLE "credit_note" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"credit_no" text,
	"amount_piastres" bigint NOT NULL,
	"reason" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending_approval' NOT NULL,
	"approval_request_id" uuid,
	"refund_method" text,
	"refunded_at" timestamp with time zone,
	"refunded_by" uuid,
	"cash_session_id" uuid,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT nullif(current_setting('app.user_id', true), '')::uuid,
	"updated_by" uuid DEFAULT nullif(current_setting('app.user_id', true), '')::uuid,
	CONSTRAINT "credit_note_no_unique" UNIQUE("credit_no"),
	CONSTRAINT "credit_note_kind_check" CHECK ("credit_note"."kind" IN ('correction', 'refund', 'waiver')),
	CONSTRAINT "credit_note_status_check" CHECK ("credit_note"."status" IN ('pending_approval', 'approved', 'rejected')),
	CONSTRAINT "credit_note_amount_check" CHECK ("credit_note"."amount_piastres" > 0)
);
--> statement-breakpoint
CREATE TABLE "discount_rule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"value" bigint NOT NULL,
	"applies_to" text DEFAULT 'tuition' NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT nullif(current_setting('app.user_id', true), '')::uuid,
	"updated_by" uuid DEFAULT nullif(current_setting('app.user_id', true), '')::uuid,
	CONSTRAINT "discount_rule_type_check" CHECK ("discount_rule"."type" IN ('percent', 'amount')),
	CONSTRAINT "discount_rule_applies_check" CHECK ("discount_rule"."applies_to" IN ('tuition', 'registration', 'transport', 'service')),
	CONSTRAINT "discount_rule_value_check" CHECK ("discount_rule"."value" > 0 AND ("discount_rule"."type" <> 'percent' OR "discount_rule"."value" <= 10000))
);
--> statement-breakpoint
CREATE TABLE "doc_sequence" (
	"branch_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"year" integer NOT NULL,
	"next_no" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "doc_sequence_branch_id_kind_year_pk" PRIMARY KEY("branch_id","kind","year")
);
--> statement-breakpoint
CREATE TABLE "expense" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"vendor_id" uuid,
	"spent_on" date NOT NULL,
	"amount_piastres" bigint NOT NULL,
	"payment_method" text NOT NULL,
	"description" text NOT NULL,
	"receipt_attachment_id" uuid,
	"status" text DEFAULT 'recorded' NOT NULL,
	"is_unusual" boolean DEFAULT false NOT NULL,
	"unusual_reason" text,
	"flagged_note" text,
	"is_request" boolean DEFAULT false NOT NULL,
	"approval_request_id" uuid,
	"cash_session_id" uuid,
	"reverses_expense_id" uuid,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT nullif(current_setting('app.user_id', true), '')::uuid,
	"updated_by" uuid DEFAULT nullif(current_setting('app.user_id', true), '')::uuid,
	CONSTRAINT "expense_status_check" CHECK ("expense"."status" IN ('recorded', 'pending_approval', 'approved', 'rejected', 'reversed')),
	CONSTRAINT "expense_method_check" CHECK ("expense"."payment_method" IN ('cash', 'card', 'bank_transfer', 'instapay', 'wallet')),
	CONSTRAINT "expense_amount_check" CHECK ("expense"."amount_piastres" <> 0 AND ("expense"."amount_piastres" > 0) = ("expense"."reverses_expense_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "expense_category" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text NOT NULL,
	"is_routine_default" boolean DEFAULT false NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT nullif(current_setting('app.user_id', true), '')::uuid,
	"updated_by" uuid DEFAULT nullif(current_setting('app.user_id', true), '')::uuid,
	CONSTRAINT "expense_category_key_unique" UNIQUE("org_id","key")
);
--> statement-breakpoint
CREATE TABLE "fee_list" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"name" text NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT nullif(current_setting('app.user_id', true), '')::uuid,
	"updated_by" uuid DEFAULT nullif(current_setting('app.user_id', true), '')::uuid,
	CONSTRAINT "fee_list_dates_check" CHECK ("fee_list"."effective_to" IS NULL OR "fee_list"."effective_to" >= "fee_list"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "fee_list_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fee_list_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"age_band_id" uuid,
	"item_type" text NOT NULL,
	"monthly_amount_piastres" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT nullif(current_setting('app.user_id', true), '')::uuid,
	"updated_by" uuid DEFAULT nullif(current_setting('app.user_id', true), '')::uuid,
	CONSTRAINT "fee_list_item_type_check" CHECK ("fee_list_item"."item_type" IN ('tuition', 'registration', 'transport', 'service')),
	CONSTRAINT "fee_list_item_amount_check" CHECK ("fee_list_item"."monthly_amount_piastres" >= 0)
);
--> statement-breakpoint
CREATE TABLE "invoice" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"student_id" uuid,
	"invoice_no" text DEFAULT '' NOT NULL,
	"service_month" date NOT NULL,
	"issue_date" date NOT NULL,
	"due_date" date NOT NULL,
	"kind" text DEFAULT 'tuition' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"total_piastres" bigint DEFAULT 0 NOT NULL,
	"paid_piastres" bigint DEFAULT 0 NOT NULL,
	"credited_piastres" bigint DEFAULT 0 NOT NULL,
	"late_fee_through" date,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT nullif(current_setting('app.user_id', true), '')::uuid,
	"updated_by" uuid DEFAULT nullif(current_setting('app.user_id', true), '')::uuid,
	CONSTRAINT "invoice_no_unique" UNIQUE("invoice_no"),
	CONSTRAINT "invoice_kind_check" CHECK ("invoice"."kind" IN ('tuition', 'late_fee', 'other')),
	CONSTRAINT "invoice_status_check" CHECK ("invoice"."status" IN ('open', 'part_paid', 'paid')),
	CONSTRAINT "invoice_month_check" CHECK (extract(day from "invoice"."service_month") = 1)
);
--> statement-breakpoint
CREATE TABLE "invoice_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"item_type" text NOT NULL,
	"description" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_piastres" bigint NOT NULL,
	"amount_piastres" bigint NOT NULL,
	"source" text NOT NULL,
	"accrual_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT nullif(current_setting('app.user_id', true), '')::uuid,
	"updated_by" uuid DEFAULT nullif(current_setting('app.user_id', true), '')::uuid,
	CONSTRAINT "invoice_line_type_check" CHECK ("invoice_line"."item_type" IN ('tuition', 'registration', 'transport', 'service', 'late_fee', 'other')),
	CONSTRAINT "invoice_line_source_check" CHECK ("invoice_line"."source" IN ('fee_list', 'price_lock', 'discount', 'late_fee', 'manual'))
);
--> statement-breakpoint
CREATE TABLE "payment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"method" text NOT NULL,
	"reference" text,
	"amount_piastres" bigint NOT NULL,
	"receipt_no" text DEFAULT '' NOT NULL,
	"cash_session_id" uuid,
	"voided_at" timestamp with time zone,
	"voided_by" uuid,
	"void_reason" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT nullif(current_setting('app.user_id', true), '')::uuid,
	"updated_by" uuid DEFAULT nullif(current_setting('app.user_id', true), '')::uuid,
	CONSTRAINT "payment_receipt_no_unique" UNIQUE("receipt_no"),
	CONSTRAINT "payment_method_check" CHECK ("payment"."method" IN ('cash', 'card', 'bank_transfer', 'instapay', 'wallet')),
	CONSTRAINT "payment_amount_check" CHECK ("payment"."amount_piastres" > 0)
);
--> statement-breakpoint
CREATE TABLE "payment_allocation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"amount_piastres" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT nullif(current_setting('app.user_id', true), '')::uuid,
	"updated_by" uuid DEFAULT nullif(current_setting('app.user_id', true), '')::uuid,
	CONSTRAINT "payment_allocation_amount_check" CHECK ("payment_allocation"."amount_piastres" > 0)
);
--> statement-breakpoint
CREATE TABLE "price_lock" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"item_type" text DEFAULT 'tuition' NOT NULL,
	"amount_piastres" bigint NOT NULL,
	"reason" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date,
	"approved_by" uuid DEFAULT nullif(current_setting('app.user_id', true), '')::uuid,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT nullif(current_setting('app.user_id', true), '')::uuid,
	"updated_by" uuid DEFAULT nullif(current_setting('app.user_id', true), '')::uuid,
	CONSTRAINT "price_lock_type_check" CHECK ("price_lock"."item_type" IN ('tuition', 'registration', 'transport', 'service')),
	CONSTRAINT "price_lock_amount_check" CHECK ("price_lock"."amount_piastres" >= 0),
	CONSTRAINT "price_lock_dates_check" CHECK ("price_lock"."ends_on" IS NULL OR "price_lock"."ends_on" >= "price_lock"."starts_on")
);
--> statement-breakpoint
CREATE TABLE "student_service" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"item_type" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT nullif(current_setting('app.user_id', true), '')::uuid,
	"updated_by" uuid DEFAULT nullif(current_setting('app.user_id', true), '')::uuid,
	CONSTRAINT "student_service_type_check" CHECK ("student_service"."item_type" IN ('transport', 'service'))
);
--> statement-breakpoint
CREATE TABLE "vendor" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT nullif(current_setting('app.user_id', true), '')::uuid,
	"updated_by" uuid DEFAULT nullif(current_setting('app.user_id', true), '')::uuid
);
--> statement-breakpoint
ALTER TABLE "approval_request" DROP CONSTRAINT "approval_type_check";--> statement-breakpoint
ALTER TABLE "approval_request" DROP CONSTRAINT "approval_status_check";--> statement-breakpoint
ALTER TABLE "approval_request" ADD COLUMN "amount_piastres" bigint;--> statement-breakpoint
ALTER TABLE "approval_request" ADD COLUMN "expense_id" uuid;--> statement-breakpoint
ALTER TABLE "approval_request" ADD COLUMN "credit_note_id" uuid;--> statement-breakpoint
ALTER TABLE "approval_request" ADD COLUMN "current_step" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "approval_request" ADD COLUMN "step_count" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "approval_step" ADD CONSTRAINT "approval_step_request_id_approval_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."approval_request"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_step" ADD CONSTRAINT "approval_step_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_routine_category" ADD CONSTRAINT "branch_routine_category_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_routine_category" ADD CONSTRAINT "branch_routine_category_category_id_expense_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."expense_category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_session" ADD CONSTRAINT "cash_session_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_note" ADD CONSTRAINT "credit_note_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_note" ADD CONSTRAINT "credit_note_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_note" ADD CONSTRAINT "credit_note_cash_session_id_cash_session_id_fk" FOREIGN KEY ("cash_session_id") REFERENCES "public"."cash_session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_rule" ADD CONSTRAINT "discount_rule_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_sequence" ADD CONSTRAINT "doc_sequence_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense" ADD CONSTRAINT "expense_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense" ADD CONSTRAINT "expense_category_id_expense_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."expense_category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense" ADD CONSTRAINT "expense_vendor_id_vendor_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendor"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense" ADD CONSTRAINT "expense_receipt_attachment_id_attachment_id_fk" FOREIGN KEY ("receipt_attachment_id") REFERENCES "public"."attachment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense" ADD CONSTRAINT "expense_cash_session_id_cash_session_id_fk" FOREIGN KEY ("cash_session_id") REFERENCES "public"."cash_session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_category" ADD CONSTRAINT "expense_category_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_list" ADD CONSTRAINT "fee_list_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_list_item" ADD CONSTRAINT "fee_list_item_fee_list_id_fee_list_id_fk" FOREIGN KEY ("fee_list_id") REFERENCES "public"."fee_list"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_list_item" ADD CONSTRAINT "fee_list_item_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_list_item" ADD CONSTRAINT "fee_list_item_age_band_id_age_band_id_fk" FOREIGN KEY ("age_band_id") REFERENCES "public"."age_band"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_student_id_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_family_id_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."family"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_cash_session_id_cash_session_id_fk" FOREIGN KEY ("cash_session_id") REFERENCES "public"."cash_session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocation" ADD CONSTRAINT "payment_allocation_payment_id_payment_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocation" ADD CONSTRAINT "payment_allocation_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocation" ADD CONSTRAINT "payment_allocation_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_lock" ADD CONSTRAINT "price_lock_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_lock" ADD CONSTRAINT "price_lock_student_id_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_service" ADD CONSTRAINT "student_service_student_id_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_service" ADD CONSTRAINT "student_service_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor" ADD CONSTRAINT "vendor_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approval_step_request_idx" ON "approval_step" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "credit_note_invoice_idx" ON "credit_note" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "credit_note_branch_idx" ON "credit_note" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "discount_rule_branch_idx" ON "discount_rule" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "expense_branch_spent_idx" ON "expense" USING btree ("branch_id","spent_on");--> statement-breakpoint
CREATE INDEX "expense_category_idx" ON "expense" USING btree ("category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "expense_one_reversal" ON "expense" USING btree ("reverses_expense_id") WHERE "expense"."reverses_expense_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "fee_list_branch_idx" ON "fee_list" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "fee_list_item_list_idx" ON "fee_list_item" USING btree ("fee_list_id");--> statement-breakpoint
CREATE INDEX "invoice_branch_month_idx" ON "invoice" USING btree ("branch_id","service_month");--> statement-breakpoint
CREATE INDEX "invoice_family_idx" ON "invoice" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "invoice_student_idx" ON "invoice" USING btree ("student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_one_tuition_per_month" ON "invoice" USING btree ("student_id","service_month") WHERE "invoice"."kind" = 'tuition';--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_one_late_fee_per_child_month" ON "invoice" USING btree ("student_id","service_month") WHERE "invoice"."kind" = 'late_fee' AND "invoice"."student_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_one_late_fee_per_family_month" ON "invoice" USING btree ("family_id","service_month") WHERE "invoice"."kind" = 'late_fee' AND "invoice"."student_id" IS NULL;--> statement-breakpoint
CREATE INDEX "invoice_line_invoice_idx" ON "invoice_line" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_line_one_accrual_per_day" ON "invoice_line" USING btree ("invoice_id","accrual_date") WHERE "invoice_line"."accrual_date" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "payment_branch_received_idx" ON "payment" USING btree ("branch_id","received_at");--> statement-breakpoint
CREATE INDEX "payment_family_idx" ON "payment" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "payment_allocation_payment_idx" ON "payment_allocation" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "payment_allocation_invoice_idx" ON "payment_allocation" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "price_lock_student_idx" ON "price_lock" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "price_lock_branch_idx" ON "price_lock" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "student_service_student_idx" ON "student_service" USING btree ("student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vendor_name_unique" ON "vendor" USING btree ("org_id",lower("name"));--> statement-breakpoint
CREATE INDEX "approval_request_status_idx" ON "approval_request" USING btree ("status");--> statement-breakpoint
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_type_check" CHECK ("approval_request"."type" IN ('over_capacity', 'transfer', 'expense', 'credit_note', 'refund', 'late_fee_waiver'));--> statement-breakpoint
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_status_check" CHECK ("approval_request"."status" IN ('pending', 'question', 'approved', 'declined', 'cancelled'));