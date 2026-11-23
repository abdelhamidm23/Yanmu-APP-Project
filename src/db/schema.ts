/**
 * Database schema (Drizzle), docs/SPEC.md §7.
 *
 * Row-level security policies, the audit trigger and the database roles are not
 * expressible in Drizzle; they live in the hand-written SQL migration
 * drizzle/0002_phase1_rls_audit.sql. Every new table with a branch_id needs a
 * policy there (a test fails otherwise).
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

/** The acting user, filled from the transaction's `app.user_id` (see src/db/rls.ts). */
const actorDefault = sql`nullif(current_setting('app.user_id', true), '')::uuid`;

/** Spec §7: operational tables record who created and last changed a row. */
const tracked = {
  ...timestamps,
  createdBy: uuid("created_by").default(actorDefault),
  updatedBy: uuid("updated_by").default(actorDefault),
};

export const roleEnum = pgEnum("app_role", [
  "owner",
  "company_manager",
  "branch_manager",
  "accountant",
  "hr",
  "front_desk",
  "teacher",
]);

/** Spec §7.2 `app_user`. Better Auth's "user" model is mapped onto this table. */
export const appUser = pgTable("app_user", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("full_name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  phone: text("phone"),
  locale: text("locale").notNull().default("ar"),
  digits: text("digits").notNull().default("latin"),
  twoFactorEnabled: boolean("mfa_enabled").notNull().default(false),
  isSafeguardingLead: boolean("is_safeguarding_lead").notNull().default(false),
  endDate: date("end_date"),
  /** Last time a manager issued a temporary password (audited; the password never is). */
  credentialsResetAt: timestamp("credentials_reset_at", { withTimezone: true }),
  /** Quick sign-in PIN for shared class phones (spec §7.2, §14). scrypt hash; never stored in clear. */
  pinHash: text("pin_hash"),
  ...timestamps,
});

export const authSession = pgTable(
  "auth_session",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUser.id, { onDelete: "cascade" }),
    /** Signed in with a PIN on a shared class phone: ends after 30 minutes without use (spec §14). */
    sharedDevice: boolean("shared_device").notNull().default(false),
    /** Last request on a shared-phone session; 30 minutes without one ends it. */
    lastActiveAt: timestamp("last_active_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("auth_session_user_idx").on(t.userId)],
);

/**
 * A person who set up quick sign-in on a shared class phone. The phone keeps a random token
 * in a cookie; only its SHA-256 hash is stored. Like the other auth tables, it is used by the
 * sign-in code before anyone is signed in, so it has no row-level security.
 */
export const deviceLogin = pgTable(
  "device_login",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUser.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    failedAttempts: integer("failed_attempts").notNull().default(0),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("device_login_user_idx").on(t.userId)],
);

export const authAccount = pgTable(
  "auth_account",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUser.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    ...timestamps,
  },
  (t) => [index("auth_account_user_idx").on(t.userId)],
);

export const authVerification = pgTable(
  "auth_verification",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (t) => [index("auth_verification_identifier_idx").on(t.identifier)],
);

export const authTwoFactor = pgTable(
  "auth_two_factor",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    secret: text("secret").notNull(),
    backupCodes: text("backup_codes").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUser.id, { onDelete: "cascade" }),
    verified: boolean("verified").default(true),
    failedVerificationCount: integer("failed_verification_count").default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
  },
  (t) => [index("auth_two_factor_user_idx").on(t.userId), index("auth_two_factor_secret_idx").on(t.secret)],
);

/** Spec §7.2 `user_branch_role`. branch_id null = organization-wide role. */
export const userBranchRole = pgTable(
  "user_branch_role",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUser.id, { onDelete: "cascade" }),
    /** null = organization-wide (all branches). */
    branchId: uuid("branch_id").references(() => branch.id),
    role: roleEnum("role").notNull(),
    ...timestamps,
  },
  (t) => [
    unique("user_branch_role_unique").on(t.userId, t.branchId, t.role).nullsNotDistinct(),
    index("user_branch_role_branch_idx").on(t.branchId),
  ],
);

export const authSchema = {
  user: appUser,
  session: authSession,
  account: authAccount,
  verification: authVerification,
  twoFactor: authTwoFactor,
};

// ---------------------------------------------------------------------------
// Spec §7.1 Organization
// ---------------------------------------------------------------------------

export const organization = pgTable("organization", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  nameAr: text("name_ar").notNull(),
  nameEn: text("name_en").notNull(),
  ...tracked,
});

export const branch = pgTable(
  "branch",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organization.id),
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en").notNull(),
    code: text("code").notNull(),
    licensedCapacity: integer("licensed_capacity").notNull().default(100),
    physicalCapacity: integer("physical_capacity").notNull().default(200),
    licenceNo: text("licence_no"),
    licenceExpiry: date("licence_expiry"),
    timezone: text("timezone").notNull().default("Africa/Cairo"),
    isActive: boolean("is_active").notNull().default(true),
    ...tracked,
  },
  (t) => [unique("branch_code_unique").on(t.orgId, t.code)],
);

export const ageBand = pgTable(
  "age_band",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organization.id),
    key: text("key").notNull(),
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en").notNull(),
    minAgeMonths: integer("min_age_months").notNull(),
    maxAgeMonths: integer("max_age_months").notNull(),
    childrenPerStaff: integer("children_per_staff").notNull(),
    sort: integer("sort").notNull().default(0),
    ...tracked,
  },
  (t) => [unique("age_band_key_unique").on(t.orgId, t.key)],
);

export const room = pgTable(
  "room",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branch.id),
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en").notNull(),
    ageBandId: uuid("age_band_id")
      .notNull()
      .references(() => ageBand.id),
    capacity: integer("capacity").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    ...tracked,
  },
  (t) => [index("room_branch_idx").on(t.branchId)],
);

export const academicYear = pgTable("academic_year", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organization.id),
  label: text("label").notNull(),
  startsOn: date("starts_on").notNull(),
  endsOn: date("ends_on").notNull(),
  ...tracked,
});

export const term = pgTable("term", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  academicYearId: uuid("academic_year_id")
    .notNull()
    .references(() => academicYear.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  startsOn: date("starts_on").notNull(),
  endsOn: date("ends_on").notNull(),
  ...tracked,
});

/**
 * Exceptions to the weekly working pattern (setting `calendar.working_days`):
 * holidays (is_working_day = false) or extra working days (true).
 * Days without a row follow the weekly pattern. See src/lib/calendar.ts and SQL is_working_day().
 */
export const calendarDay = pgTable(
  "calendar_day",
  {
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branch.id),
    date: date("date").notNull(),
    isWorkingDay: boolean("is_working_day").notNull(),
    note: text("note"),
    ...tracked,
  },
  (t) => [primaryKey({ columns: [t.branchId, t.date] })],
);

/** All thresholds from spec §17.3. branch_id null = organization default. */
export const setting = pgTable(
  "setting",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organization.id),
    branchId: uuid("branch_id").references(() => branch.id),
    key: text("key").notNull(),
    value: jsonb("value").notNull(),
    ...tracked,
  },
  (t) => [unique("setting_unique").on(t.orgId, t.branchId, t.key).nullsNotDistinct()],
);

// ---------------------------------------------------------------------------
// Spec §7.7 Platform
// ---------------------------------------------------------------------------

/** Written only by the audit trigger. The app role can read (per policy) but never change it. */
export const auditEvent = pgTable(
  "audit_event",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    actorUserId: uuid("actor_user_id"),
    branchId: uuid("branch_id"),
    tableName: text("table_name").notNull(),
    rowId: text("row_id").notNull(),
    action: text("action").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    reason: text("reason"),
  },
  (t) => [index("audit_event_at_idx").on(t.at), index("audit_event_table_row_idx").on(t.tableName, t.rowId)],
);

// ---------------------------------------------------------------------------
// Spec §7.2 People (children side) and §7.3 Enrollment — Phase 2
// Row policies, the branch-copy triggers and the capacity rule live in
// drizzle/0004_phase2_children_rls.sql.
// ---------------------------------------------------------------------------

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

/** Rooms a teacher looks after (spec §5 "room" scope). Phase 3's roster builds on this. */
export const userRoom = pgTable(
  "user_room",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => appUser.id, { onDelete: "cascade" }),
    roomId: uuid("room_id")
      .notNull()
      .references(() => room.id),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branch.id),
    ...tracked,
  },
  (t) => [primaryKey({ columns: [t.userId, t.roomId] }), index("user_room_room_idx").on(t.roomId)],
);

/** One upload of a spreadsheet (spec §8.11). Rows it created carry its id so the batch can be rolled back. */
export const importBatch = pgTable(
  "import_batch",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branch.id),
    kind: text("kind").notNull(),
    fileName: text("file_name").notNull(),
    rowCount: integer("row_count").notNull(),
    status: text("status").notNull().default("committed"),
    rolledBackAt: timestamp("rolled_back_at", { withTimezone: true }),
    ...tracked,
  },
  (t) => [
    index("import_batch_branch_idx").on(t.branchId),
    check("import_batch_status_check", sql`${t.status} IN ('committed', 'rolled_back')`),
  ],
);

/** Scanned forms and photos. Stored in the database so personal data stays on the Egyptian server. */
export const attachment = pgTable(
  "attachment",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branch.id),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    data: bytea("data").notNull(),
    ...tracked,
  },
  (t) => [index("attachment_branch_idx").on(t.branchId), check("attachment_size_check", sql`${t.sizeBytes} <= 5242880`)],
);

/** Billing account; siblings share one (spec §7.2). */
export const family = pgTable(
  "family",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branch.id),
    accountNo: text("account_no").notNull(),
    displayName: text("display_name").notNull(),
    notes: text("notes"),
    isDemo: boolean("is_demo").notNull().default(false),
    importBatchId: uuid("import_batch_id").references(() => importBatch.id),
    ...tracked,
  },
  (t) => [unique("family_account_no_unique").on(t.accountNo), index("family_branch_idx").on(t.branchId)],
);

export const guardian = pgTable(
  "guardian",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    familyId: uuid("family_id")
      .notNull()
      .references(() => family.id),
    /** Copied from the family by a trigger, for row-level security. */
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branch.id),
    fullName: text("full_name").notNull(),
    relationship: text("relationship").notNull(),
    phone: text("phone").notNull(),
    nationalIdLast4: text("national_id_last4"),
    photoAttachmentId: uuid("photo_attachment_id").references(() => attachment.id),
    isDemo: boolean("is_demo").notNull().default(false),
    importBatchId: uuid("import_batch_id").references(() => importBatch.id),
    ...tracked,
  },
  (t) => [
    index("guardian_family_idx").on(t.familyId),
    index("guardian_phone_idx").on(t.phone),
    check("guardian_nid_check", sql`${t.nationalIdLast4} IS NULL OR ${t.nationalIdLast4} ~ '^[0-9]{4}$'`),
    check("guardian_relationship_check", sql`${t.relationship} IN ('mother', 'father', 'grandparent', 'sibling', 'relative', 'nanny', 'other')`),
  ],
);

export const student = pgTable(
  "student",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    /** Current branch. A transfer moves it; the student row is never duplicated (spec §7.3). */
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branch.id),
    studentNo: text("student_no").notNull(),
    fullNameAr: text("full_name_ar").notNull(),
    fullNameEn: text("full_name_en").notNull(),
    dateOfBirth: date("date_of_birth").notNull(),
    gender: text("gender").notNull(),
    familyId: uuid("family_id")
      .notNull()
      .references(() => family.id),
    photoAttachmentId: uuid("photo_attachment_id").references(() => attachment.id),
    status: text("status").notNull().default("active"),
    isDemo: boolean("is_demo").notNull().default(false),
    importBatchId: uuid("import_batch_id").references(() => importBatch.id),
    ...tracked,
  },
  (t) => [
    unique("student_no_unique").on(t.studentNo),
    index("student_branch_idx").on(t.branchId),
    index("student_family_idx").on(t.familyId),
    check("student_gender_check", sql`${t.gender} IN ('female', 'male')`),
    check("student_status_check", sql`${t.status} IN ('pending', 'active', 'withdrawn', 'graduated')`),
  ],
);

export const studentGuardian = pgTable(
  "student_guardian",
  {
    studentId: uuid("student_id")
      .notNull()
      .references(() => student.id, { onDelete: "cascade" }),
    guardianId: uuid("guardian_id")
      .notNull()
      .references(() => guardian.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branch.id),
    canPickUp: boolean("can_pick_up").notNull().default(true),
    isPrimaryContact: boolean("is_primary_contact").notNull().default(false),
    ...tracked,
  },
  (t) => [primaryKey({ columns: [t.studentId, t.guardianId] }), index("student_guardian_guardian_idx").on(t.guardianId)],
);

/** Restricted (spec §5): branch manager and the child's teachers; owner and company manager by break-glass only. */
export const studentMedical = pgTable("student_medical", {
  studentId: uuid("student_id")
    .primaryKey()
    .references(() => student.id, { onDelete: "cascade" }),
  branchId: uuid("branch_id")
    .notNull()
    .references(() => branch.id),
  allergies: text("allergies"),
  conditions: text("conditions"),
  medications: text("medications"),
  doctorContact: text("doctor_contact"),
  ...tracked,
});

export const consentRecord = pgTable(
  "consent_record",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    studentId: uuid("student_id")
      .notNull()
      .references(() => student.id, { onDelete: "cascade" }),
    guardianId: uuid("guardian_id").references(() => guardian.id),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branch.id),
    purpose: text("purpose").notNull(),
    grantedOn: date("granted_on").notNull(),
    withdrawnOn: date("withdrawn_on"),
    formAttachmentId: uuid("form_attachment_id").references(() => attachment.id),
    language: text("language").notNull().default("ar"),
    ...tracked,
  },
  (t) => [
    index("consent_record_student_idx").on(t.studentId),
    check("consent_purpose_check", sql`${t.purpose} IN ('records', 'photos', 'medical', 'other')`),
  ],
);

/** Approval requests (spec §7.3 over_capacity; transfers). Money approvals reuse this in Phase 4. */
export const approvalRequest = pgTable(
  "approval_request",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branch.id),
    type: text("type").notNull(),
    status: text("status").notNull().default("pending"),
    studentId: uuid("student_id").references(() => student.id, { onDelete: "cascade" }),
    enrollmentId: uuid("enrollment_id"),
    /** Transfers: where the child is going. */
    toBranchId: uuid("to_branch_id").references(() => branch.id),
    reason: text("reason"),
    decidedBy: uuid("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    /** Money approvals (Phase 4, spec §8.6): the amount decides the route; step 2 is the owner's. */
    amountPiastres: bigint("amount_piastres", { mode: "bigint" }),
    expenseId: uuid("expense_id"),
    creditNoteId: uuid("credit_note_id"),
    currentStep: integer("current_step").notNull().default(1),
    stepCount: integer("step_count").notNull().default(1),
    ...tracked,
  },
  (t) => [
    index("approval_request_branch_idx").on(t.branchId),
    index("approval_request_to_branch_idx").on(t.toBranchId),
    index("approval_request_status_idx").on(t.status),
    check(
      "approval_type_check",
      sql`${t.type} IN ('over_capacity', 'transfer', 'expense', 'credit_note', 'refund', 'late_fee_waiver')`,
    ),
    check("approval_status_check", sql`${t.status} IN ('pending', 'question', 'approved', 'declined', 'cancelled')`),
  ],
);

export const enrollment = pgTable(
  "enrollment",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    studentId: uuid("student_id")
      .notNull()
      .references(() => student.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branch.id),
    roomId: uuid("room_id")
      .notNull()
      .references(() => room.id),
    startDate: date("start_date").notNull(),
    endDate: date("end_date"),
    status: text("status").notNull(),
    endReason: text("end_reason"),
    /** Required when the room's age band differs from the child's (spec §2.1). */
    bandOverrideReason: text("band_override_reason"),
    approvalRequestId: uuid("approval_request_id").references(() => approvalRequest.id),
    /** Fee lists and price locks arrive in Phase 4. */
    feeListId: uuid("fee_list_id"),
    priceLockId: uuid("price_lock_id"),
    isDemo: boolean("is_demo").notNull().default(false),
    importBatchId: uuid("import_batch_id").references(() => importBatch.id),
    ...tracked,
  },
  (t) => [
    index("enrollment_branch_status_idx").on(t.branchId, t.status),
    index("enrollment_student_idx").on(t.studentId),
    index("enrollment_room_idx").on(t.roomId),
    uniqueIndex("enrollment_one_open_per_student").on(t.studentId).where(sql`${t.status} IN ('pending_approval', 'active')`),
    check(
      "enrollment_status_check",
      sql`${t.status} IN ('pending_approval', 'active', 'withdrawn', 'graduated', 'transferred', 'declined')`,
    ),
  ],
);

export const waitlistEntry = pgTable(
  "waitlist_entry",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branch.id),
    studentName: text("student_name").notNull(),
    dateOfBirth: date("date_of_birth").notNull(),
    guardianName: text("guardian_name"),
    guardianPhone: text("guardian_phone").notNull(),
    requestedStartMonth: date("requested_start_month").notNull(),
    ageBandId: uuid("age_band_id").references(() => ageBand.id),
    status: text("status").notNull().default("waiting"),
    notes: text("notes"),
    convertedStudentId: uuid("converted_student_id").references(() => student.id),
    isDemo: boolean("is_demo").notNull().default(false),
    ...tracked,
  },
  (t) => [
    index("waitlist_branch_status_idx").on(t.branchId, t.status),
    check("waitlist_status_check", sql`${t.status} IN ('waiting', 'converted', 'cancelled')`),
  ],
);

// ---------------------------------------------------------------------------
// Spec §7.2 staff and §7.4 attendance (Phase 3)
// ---------------------------------------------------------------------------

/** A member of staff (spec §7.2). Linked to a sign-in account when they have one. */
export const staff = pgTable(
  "staff",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branch.id),
    userId: uuid("user_id").references(() => appUser.id),
    fullNameAr: text("full_name_ar").notNull(),
    fullNameEn: text("full_name_en").notNull(),
    jobTitle: text("job_title").notNull(),
    /** Counts towards the staff : children ratio (spec §8.3). */
    isQualifiedCarer: boolean("is_qualified_carer").notNull().default(true),
    defaultRoomId: uuid("default_room_id").references(() => room.id),
    /** The number this person has on the fingerprint device (Hikvision export). */
    deviceEmployeeNo: text("device_employee_no"),
    /** Expected arrival, HH:MM Cairo time; later than this plus the grace minutes counts as late. */
    shiftStart: text("shift_start").notNull().default("08:00"),
    startDate: date("start_date"),
    endDate: date("end_date"),
    status: text("status").notNull().default("active"),
    isDemo: boolean("is_demo").notNull().default(false),
    ...tracked,
  },
  (t) => [
    index("staff_branch_idx").on(t.branchId),
    uniqueIndex("staff_user_unique").on(t.userId).where(sql`${t.userId} IS NOT NULL`),
    uniqueIndex("staff_device_no_unique").on(t.branchId, t.deviceEmployeeNo).where(sql`${t.deviceEmployeeNo} IS NOT NULL`),
    check("staff_status_check", sql`${t.status} IN ('active', 'left')`),
    check("staff_shift_check", sql`${t.shiftStart} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`),
  ],
);

/**
 * Who works in which room on a day (spec §7.4). Without a row, a person is in their default room.
 * room_id NULL = not in a room today. marked_present is the manager's tap before the fingerprint file arrives.
 */
export const roomRoster = pgTable(
  "room_roster",
  {
    staffId: uuid("staff_id")
      .notNull()
      .references(() => staff.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branch.id),
    roomId: uuid("room_id").references(() => room.id),
    markedPresent: boolean("marked_present"),
    isDemo: boolean("is_demo").notNull().default(false),
    ...tracked,
  },
  (t) => [primaryKey({ columns: [t.staffId, t.date] }), index("room_roster_branch_date_idx").on(t.branchId, t.date)],
);

/** One child, one day (spec §7.4). Offline taps carry a client id and time so replays and late arrivals are harmless. */
export const studentAttendance = pgTable(
  "student_attendance",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branch.id),
    roomId: uuid("room_id")
      .notNull()
      .references(() => room.id),
    studentId: uuid("student_id")
      .notNull()
      .references(() => student.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    status: text("status").notNull(),
    excuseReason: text("excuse_reason"),
    checkInAt: timestamp("check_in_at", { withTimezone: true }),
    checkOutAt: timestamp("check_out_at", { withTimezone: true }),
    collectedByGuardianId: uuid("collected_by_guardian_id").references(() => guardian.id),
    /** The last tap applied (offline idempotency, spec §8.2). */
    clientUuid: uuid("client_uuid"),
    clientAt: timestamp("client_at", { withTimezone: true }),
    isDemo: boolean("is_demo").notNull().default(false),
    ...tracked,
  },
  (t) => [
    unique("student_attendance_day_unique").on(t.studentId, t.date),
    index("student_attendance_branch_date_idx").on(t.branchId, t.date),
    check("student_attendance_status_check", sql`${t.status} IN ('present', 'absent', 'excused')`),
  ],
);

/** Someone not on the approved list tried to collect a child (spec §8.2). Never a silent release. */
export const pickupRefusal = pgTable(
  "pickup_refusal",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branch.id),
    studentId: uuid("student_id")
      .notNull()
      .references(() => student.id, { onDelete: "cascade" }),
    personName: text("person_name"),
    note: text("note"),
    happenedAt: timestamp("happened_at", { withTimezone: true }).notNull().defaultNow(),
    clientUuid: uuid("client_uuid").unique(),
    acknowledgedBy: uuid("acknowledged_by").references(() => appUser.id),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    isDemo: boolean("is_demo").notNull().default(false),
    ...tracked,
  },
  (t) => [index("pickup_refusal_branch_idx").on(t.branchId, t.happenedAt)],
);

/** One fingerprint punch from the device export (spec §8.3). */
export const staffPunch = pgTable(
  "staff_punch",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branch.id),
    staffId: uuid("staff_id").references(() => staff.id, { onDelete: "set null" }),
    deviceEmployeeNo: text("device_employee_no").notNull(),
    personName: text("person_name"),
    punchedAt: timestamp("punched_at", { withTimezone: true }).notNull(),
    device: text("device"),
    importBatchId: uuid("import_batch_id").references(() => importBatch.id),
    isDemo: boolean("is_demo").notNull().default(false),
    ...tracked,
  },
  (t) => [
    unique("staff_punch_unique").on(t.branchId, t.deviceEmployeeNo, t.punchedAt),
    index("staff_punch_batch_idx").on(t.importBatchId),
    index("staff_punch_staff_idx").on(t.staffId, t.punchedAt),
  ],
);

/** Derived from punches for each day a file covers (spec §8.3). */
export const staffAttendanceDay = pgTable(
  "staff_attendance_day",
  {
    staffId: uuid("staff_id")
      .notNull()
      .references(() => staff.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branch.id),
    firstIn: timestamp("first_in", { withTimezone: true }),
    lastOut: timestamp("last_out", { withTimezone: true }),
    status: text("status").notNull(),
    isDemo: boolean("is_demo").notNull().default(false),
    ...tracked,
  },
  (t) => [
    primaryKey({ columns: [t.staffId, t.date] }),
    index("staff_attendance_day_branch_idx").on(t.branchId, t.date),
    check("staff_attendance_day_status_check", sql`${t.status} IN ('present', 'late', 'absent', 'leave')`),
  ],
);

/** Saved column choices for a spreadsheet kind, per branch (spec §8.3: map once, reuse). */
export const importMapping = pgTable(
  "import_mapping",
  {
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branch.id),
    kind: text("kind").notNull(),
    mapping: jsonb("mapping").notNull(),
    ...tracked,
  },
  (t) => [primaryKey({ columns: [t.branchId, t.kind] })],
);

/** Staff : children ratio for a room at a moment (spec §8.3). */
export const ratioSnapshot = pgTable(
  "ratio_snapshot",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branch.id),
    roomId: uuid("room_id")
      .notNull()
      .references(() => room.id),
    takenAt: timestamp("taken_at", { withTimezone: true }).notNull().defaultNow(),
    childrenPresent: integer("children_present").notNull(),
    carersPresent: integer("carers_present").notNull(),
    requiredCarers: integer("required_carers").notNull(),
    isBreach: boolean("is_breach").notNull(),
    reason: text("reason").notNull(),
    isDemo: boolean("is_demo").notNull().default(false),
    createdBy: uuid("created_by").default(actorDefault),
  },
  (t) => [index("ratio_snapshot_room_idx").on(t.roomId, t.takenAt), index("ratio_snapshot_branch_idx").on(t.branchId, t.takenAt)],
);

// ---------------------------------------------------------------------------
// Phase 4: money (spec §7.5, §8.4 to §8.6). Amounts are integer piastres in bigint (rule 5).
// Posted invoices, payments, credit notes and expenses are never edited or deleted (rule 6):
// the app may only insert them; voids, decisions and refunds go through database functions.
// ---------------------------------------------------------------------------

const money = (name: string) => bigint(name, { mode: "bigint" });
const ITEM_TYPES = sql.raw("'tuition', 'registration', 'transport', 'service'");

/** Fees per branch with the dates they apply (spec §7.5). */
export const feeList = pgTable(
  "fee_list",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branch.id),
    name: text("name").notNull(),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    isDemo: boolean("is_demo").notNull().default(false),
    ...tracked,
  },
  (t) => [
    index("fee_list_branch_idx").on(t.branchId),
    check("fee_list_dates_check", sql`${t.effectiveTo} IS NULL OR ${t.effectiveTo} >= ${t.effectiveFrom}`),
  ],
);

/** One fee in a list. No age band = every band. Tuition and service are billed monthly, registration once. */
export const feeListItem = pgTable(
  "fee_list_item",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    feeListId: uuid("fee_list_id")
      .notNull()
      .references(() => feeList.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branch.id),
    ageBandId: uuid("age_band_id").references(() => ageBand.id),
    itemType: text("item_type").notNull(),
    monthlyAmountPiastres: money("monthly_amount_piastres").notNull(),
    ...tracked,
  },
  (t) => [
    index("fee_list_item_list_idx").on(t.feeListId),
    check("fee_list_item_type_check", sql`${t.itemType} IN (${ITEM_TYPES})`),
    check("fee_list_item_amount_check", sql`${t.monthlyAmountPiastres} >= 0`),
  ],
);

/** A child keeps an older price (spec §8.4.2, D7). Created by the company manager or owner. */
export const priceLock = pgTable(
  "price_lock",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branch.id),
    studentId: uuid("student_id")
      .notNull()
      .references(() => student.id, { onDelete: "cascade" }),
    itemType: text("item_type").notNull().default("tuition"),
    amountPiastres: money("amount_piastres").notNull(),
    reason: text("reason").notNull(),
    startsOn: date("starts_on").notNull(),
    endsOn: date("ends_on"),
    approvedBy: uuid("approved_by").default(actorDefault),
    isDemo: boolean("is_demo").notNull().default(false),
    ...tracked,
  },
  (t) => [
    index("price_lock_student_idx").on(t.studentId),
    index("price_lock_branch_idx").on(t.branchId),
    check("price_lock_type_check", sql`${t.itemType} IN (${ITEM_TYPES})`),
    check("price_lock_amount_check", sql`${t.amountPiastres} >= 0`),
    check("price_lock_dates_check", sql`${t.endsOn} IS NULL OR ${t.endsOn} >= ${t.startsOn}`),
  ],
);

/** Discounts and offers (D6): the engine exists, no rule is active at launch. Percent is in basis points. */
export const discountRule = pgTable(
  "discount_rule",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branch.id),
    name: text("name").notNull(),
    type: text("type").notNull(),
    value: money("value").notNull(),
    appliesTo: text("applies_to").notNull().default("tuition"),
    startsOn: date("starts_on").notNull(),
    endsOn: date("ends_on"),
    isActive: boolean("is_active").notNull().default(false),
    ...tracked,
  },
  (t) => [
    index("discount_rule_branch_idx").on(t.branchId),
    check("discount_rule_type_check", sql`${t.type} IN ('percent', 'amount')`),
    check("discount_rule_applies_check", sql`${t.appliesTo} IN (${ITEM_TYPES})`),
    check("discount_rule_value_check", sql`${t.value} > 0 AND (${t.type} <> 'percent' OR ${t.value} <= 10000)`),
  ],
);

/** Optional monthly extras a child takes (transport, other services), billed only while switched on. */
export const studentService = pgTable(
  "student_service",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    studentId: uuid("student_id")
      .notNull()
      .references(() => student.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branch.id),
    itemType: text("item_type").notNull(),
    startsOn: date("starts_on").notNull(),
    endsOn: date("ends_on"),
    ...tracked,
  },
  (t) => [
    index("student_service_student_idx").on(t.studentId),
    check("student_service_type_check", sql`${t.itemType} IN ('transport', 'service')`),
  ],
);

/** Gap-free numbers per branch, kind and year (receipts, invoices, credit notes). */
export const docSequence = pgTable(
  "doc_sequence",
  {
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branch.id),
    kind: text("kind").notNull(),
    year: integer("year").notNull(),
    nextNo: integer("next_no").notNull().default(1),
  },
  (t) => [primaryKey({ columns: [t.branchId, t.kind, t.year] })],
);

export const invoice = pgTable(
  "invoice",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branch.id),
    familyId: uuid("family_id")
      .notNull()
      .references(() => family.id),
    /** Empty only for a per-family late-fee invoice (late_fee.basis = per_family). */
    studentId: uuid("student_id").references(() => student.id),
    /** Set by the database: gap-free per branch and year. */
    invoiceNo: text("invoice_no").notNull().default(""),
    serviceMonth: date("service_month").notNull(),
    issueDate: date("issue_date").notNull(),
    dueDate: date("due_date").notNull(),
    kind: text("kind").notNull().default("tuition"),
    /** Kept by the database from the lines, allocations and credit notes. */
    status: text("status").notNull().default("open"),
    totalPiastres: money("total_piastres").notNull().default(sql`0`),
    paidPiastres: money("paid_piastres").notNull().default(sql`0`),
    creditedPiastres: money("credited_piastres").notNull().default(sql`0`),
    /** Tuition: late fees have been worked out up to this day (spec §8.4.4). */
    lateFeeThrough: date("late_fee_through"),
    isDemo: boolean("is_demo").notNull().default(false),
    ...tracked,
  },
  (t) => [
    unique("invoice_no_unique").on(t.invoiceNo),
    index("invoice_branch_month_idx").on(t.branchId, t.serviceMonth),
    index("invoice_family_idx").on(t.familyId),
    index("invoice_student_idx").on(t.studentId),
    uniqueIndex("invoice_one_tuition_per_month").on(t.studentId, t.serviceMonth).where(sql`${t.kind} = 'tuition'`),
    uniqueIndex("invoice_one_late_fee_per_child_month").on(t.studentId, t.serviceMonth).where(sql`${t.kind} = 'late_fee' AND ${t.studentId} IS NOT NULL`),
    uniqueIndex("invoice_one_late_fee_per_family_month").on(t.familyId, t.serviceMonth).where(sql`${t.kind} = 'late_fee' AND ${t.studentId} IS NULL`),
    check("invoice_kind_check", sql`${t.kind} IN ('tuition', 'late_fee', 'other')`),
    check("invoice_status_check", sql`${t.status} IN ('open', 'part_paid', 'paid')`),
    check("invoice_month_check", sql`extract(day from ${t.serviceMonth}) = 1`),
  ],
);

export const invoiceLine = pgTable(
  "invoice_line",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoice.id),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branch.id),
    itemType: text("item_type").notNull(),
    description: text("description").notNull(),
    quantity: integer("quantity").notNull().default(1),
    unitPiastres: money("unit_piastres").notNull(),
    amountPiastres: money("amount_piastres").notNull(),
    source: text("source").notNull(),
    /** Late-fee lines: the working day this line is for (one per day). */
    accrualDate: date("accrual_date"),
    ...tracked,
  },
  (t) => [
    index("invoice_line_invoice_idx").on(t.invoiceId),
    uniqueIndex("invoice_line_one_accrual_per_day").on(t.invoiceId, t.accrualDate).where(sql`${t.accrualDate} IS NOT NULL`),
    check("invoice_line_type_check", sql`${t.itemType} IN (${ITEM_TYPES}, 'late_fee', 'other')`),
    check("invoice_line_source_check", sql`${t.source} IN ('fee_list', 'price_lock', 'discount', 'late_fee', 'manual')`),
  ],
);

/** Cash box for one branch and day (spec §8.5). */
export const cashSession = pgTable(
  "cash_session",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branch.id),
    date: date("date").notNull(),
    openingFloatPiastres: money("opening_float_piastres").notNull(),
    /** Frozen when the box is closed. */
    cashInPiastres: money("cash_in_piastres"),
    cashOutPiastres: money("cash_out_piastres"),
    countedPiastres: money("counted_piastres"),
    handedOverPiastres: money("handed_over_piastres"),
    handedTo: text("handed_to"),
    variancePiastres: money("variance_piastres"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedBy: uuid("closed_by"),
    reconciledAt: timestamp("reconciled_at", { withTimezone: true }),
    reconciledBy: uuid("reconciled_by"),
    isDemo: boolean("is_demo").notNull().default(false),
    ...tracked,
  },
  (t) => [
    unique("cash_session_branch_date_unique").on(t.branchId, t.date),
    check("cash_session_float_check", sql`${t.openingFloatPiastres} >= 0`),
  ],
);

export const payment = pgTable(
  "payment",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branch.id),
    familyId: uuid("family_id")
      .notNull()
      .references(() => family.id),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    method: text("method").notNull(),
    reference: text("reference"),
    amountPiastres: money("amount_piastres").notNull(),
    /** Set by the database: gap-free per branch and year. */
    receiptNo: text("receipt_no").notNull().default(""),
    cashSessionId: uuid("cash_session_id").references(() => cashSession.id),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidedBy: uuid("voided_by"),
    voidReason: text("void_reason"),
    isDemo: boolean("is_demo").notNull().default(false),
    ...tracked,
  },
  (t) => [
    unique("payment_receipt_no_unique").on(t.receiptNo),
    index("payment_branch_received_idx").on(t.branchId, t.receivedAt),
    index("payment_family_idx").on(t.familyId),
    check("payment_method_check", sql`${t.method} IN ('cash', 'card', 'bank_transfer', 'instapay', 'wallet')`),
    check("payment_amount_check", sql`${t.amountPiastres} > 0`),
  ],
);

export const paymentAllocation = pgTable(
  "payment_allocation",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payment.id),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoice.id),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branch.id),
    amountPiastres: money("amount_piastres").notNull(),
    ...tracked,
  },
  (t) => [
    index("payment_allocation_payment_idx").on(t.paymentId),
    index("payment_allocation_invoice_idx").on(t.invoiceId),
    check("payment_allocation_amount_check", sql`${t.amountPiastres} > 0`),
  ],
);

/** Corrections, refunds and late-fee waivers (spec §8.4.5). Count only once approved. */
export const creditNote = pgTable(
  "credit_note",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branch.id),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoice.id),
    creditNo: text("credit_no"),
    amountPiastres: money("amount_piastres").notNull(),
    reason: text("reason").notNull(),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("pending_approval"),
    approvalRequestId: uuid("approval_request_id"),
    /** Refunds: how and when the money went back to the family. */
    refundMethod: text("refund_method"),
    refundedAt: timestamp("refunded_at", { withTimezone: true }),
    refundedBy: uuid("refunded_by"),
    cashSessionId: uuid("cash_session_id").references(() => cashSession.id),
    isDemo: boolean("is_demo").notNull().default(false),
    ...tracked,
  },
  (t) => [
    unique("credit_note_no_unique").on(t.creditNo),
    index("credit_note_invoice_idx").on(t.invoiceId),
    index("credit_note_branch_idx").on(t.branchId),
    check("credit_note_kind_check", sql`${t.kind} IN ('correction', 'refund', 'waiver')`),
    check("credit_note_status_check", sql`${t.status} IN ('pending_approval', 'approved', 'rejected')`),
    check("credit_note_amount_check", sql`${t.amountPiastres} > 0`),
  ],
);

export const expenseCategory = pgTable(
  "expense_category",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organization.id),
    key: text("key").notNull(),
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en").notNull(),
    isRoutineDefault: boolean("is_routine_default").notNull().default(false),
    sort: integer("sort").notNull().default(0),
    ...tracked,
  },
  (t) => [unique("expense_category_key_unique").on(t.orgId, t.key)],
);

/** The categories a branch manager may spend on without asking (A2), per branch. */
export const branchRoutineCategory = pgTable(
  "branch_routine_category",
  {
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branch.id),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => expenseCategory.id),
    ...tracked,
  },
  (t) => [primaryKey({ columns: [t.branchId, t.categoryId] })],
);

export const vendor = pgTable(
  "vendor",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organization.id),
    name: text("name").notNull(),
    phone: text("phone"),
    ...tracked,
  },
  (t) => [uniqueIndex("vendor_name_unique").on(t.orgId, sql`lower(${t.name})`)],
);

export const expense = pgTable(
  "expense",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branch.id),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => expenseCategory.id),
    vendorId: uuid("vendor_id").references(() => vendor.id),
    spentOn: date("spent_on").notNull(),
    amountPiastres: money("amount_piastres").notNull(),
    paymentMethod: text("payment_method").notNull(),
    description: text("description").notNull(),
    receiptAttachmentId: uuid("receipt_attachment_id").references(() => attachment.id),
    /** Set by the database (spec §8.6): recorded (routine), pending_approval, approved, rejected, reversed. */
    status: text("status").notNull().default("recorded"),
    isUnusual: boolean("is_unusual").notNull().default(false),
    /** Why it needs approval: not_routine, above_average, above_limit, flagged (comma-separated). */
    unusualReason: text("unusual_reason"),
    /** The person recording it said it is unusual, with their words. */
    flaggedNote: text("flagged_note"),
    /** A request made before spending, to be completed with the receipt. */
    isRequest: boolean("is_request").notNull().default(false),
    approvalRequestId: uuid("approval_request_id"),
    cashSessionId: uuid("cash_session_id").references(() => cashSession.id),
    /** A reversal entry points at the expense it cancels (rule 6). */
    reversesExpenseId: uuid("reverses_expense_id"),
    isDemo: boolean("is_demo").notNull().default(false),
    ...tracked,
  },
  (t) => [
    index("expense_branch_spent_idx").on(t.branchId, t.spentOn),
    index("expense_category_idx").on(t.categoryId),
    uniqueIndex("expense_one_reversal").on(t.reversesExpenseId).where(sql`${t.reversesExpenseId} IS NOT NULL`),
    check("expense_status_check", sql`${t.status} IN ('recorded', 'pending_approval', 'approved', 'rejected', 'reversed')`),
    check("expense_method_check", sql`${t.paymentMethod} IN ('cash', 'card', 'bank_transfer', 'instapay', 'wallet')`),
    check("expense_amount_check", sql`${t.amountPiastres} <> 0 AND (${t.amountPiastres} > 0) = (${t.reversesExpenseId} IS NULL)`),
  ],
);

/** One decision on a money approval (spec §7.7, §8.6). */
export const approvalStep = pgTable(
  "approval_step",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    requestId: uuid("request_id")
      .notNull()
      .references(() => approvalRequest.id),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branch.id),
    stepNo: integer("step_no").notNull(),
    decision: text("decision").notNull(),
    comment: text("comment"),
    ...tracked,
  },
  (t) => [
    index("approval_step_request_idx").on(t.requestId),
    check("approval_step_decision_check", sql`${t.decision} IN ('approve', 'reject', 'recommend_approve', 'recommend_reject', 'question', 'answer')`),
  ],
);

// ---------------------------------------------------------------------------
// Phase 5: safety and operations (spec §7.6, §8.7, §8.8, §10).
// Incidents, the people in them, corrective actions, issues, and alerts with their deliveries.
// Status changes go through database functions (drizzle/0013); the app may only edit report fields.
// ---------------------------------------------------------------------------

export const INCIDENT_CATEGORIES = [
  "injury",
  "head_injury",
  "illness",
  "allergic_reaction",
  "behaviour",
  "child_unaccounted",
  "pickup_unapproved",
  "child_protection",
  "hazard",
  "other",
] as const;
export const INCIDENT_SEVERITIES = ["minor", "moderate", "serious", "critical"] as const;

/** Spec §7.6 `incident`. reported_by is created_by. */
export const incident = pgTable(
  "incident",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branch.id),
    roomId: uuid("room_id").references(() => room.id),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    category: text("category").notNull(),
    severity: text("severity").notNull(),
    description: text("description").notNull(),
    immediateAction: text("immediate_action").notNull(),
    /** Who told the guardian, when, and what was said (spec §8.7). */
    guardianNotifiedAt: timestamp("guardian_notified_at", { withTimezone: true }),
    guardianNotifiedBy: uuid("guardian_notified_by").references(() => appUser.id),
    guardianNotificationNote: text("guardian_notification_note"),
    /** Full report (within 24 hours): what led to it, what was found, what changes. */
    reportDetails: text("report_details"),
    reportSubmittedAt: timestamp("report_submitted_at", { withTimezone: true }),
    reportSubmittedBy: uuid("report_submitted_by").references(() => appUser.id),
    /** First look by the branch manager or company manager (stops the step-by-step alert). */
    seenAt: timestamp("seen_at", { withTimezone: true }),
    seenBy: uuid("seen_by").references(() => appUser.id),
    /** Company manager's review of the full report. */
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewedBy: uuid("reviewed_by").references(() => appUser.id),
    reviewNote: text("review_note"),
    status: text("status").notNull().default("open"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedBy: uuid("closed_by").references(() => appUser.id),
    closeNote: text("close_note"),
    /** Offline short form: a resend is harmless (spec §8.7, §13). */
    clientUuid: uuid("client_uuid").unique(),
    pickupRefusalId: uuid("pickup_refusal_id").references(() => pickupRefusal.id),
    isDemo: boolean("is_demo").notNull().default(false),
    ...tracked,
  },
  (t) => [
    index("incident_branch_idx").on(t.branchId, t.occurredAt),
    index("incident_status_idx").on(t.status),
    check("incident_status_check", sql`${t.status} IN ('open', 'under_review', 'closed')`),
    check("incident_severity_check", sql`${t.severity} IN ('minor', 'moderate', 'serious', 'critical')`),
    check(
      "incident_category_check",
      sql`${t.category} IN ('injury', 'head_injury', 'illness', 'allergic_reaction', 'behaviour', 'child_unaccounted', 'pickup_unapproved', 'child_protection', 'hazard', 'other')`,
    ),
  ],
);

/** A child, a staff member or another person in an incident (spec §7.6). */
export const incidentPerson = pgTable(
  "incident_person",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    incidentId: uuid("incident_id")
      .notNull()
      .references(() => incident.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branch.id),
    studentId: uuid("student_id").references(() => student.id),
    staffId: uuid("staff_id").references(() => staff.id),
    /** Someone who is neither a child nor staff here (a visitor, a parent). */
    personName: text("person_name"),
    role: text("role").notNull(),
    ...tracked,
  },
  (t) => [
    index("incident_person_incident_idx").on(t.incidentId),
    check("incident_person_role_check", sql`${t.role} IN ('injured', 'involved', 'witness')`),
    check("incident_person_who_check", sql`num_nonnulls(${t.studentId}, ${t.staffId}, ${t.personName}) = 1`),
  ],
);

/** Corrective action with an owner and a due date (spec §8.7). */
export const incidentAction = pgTable(
  "incident_action",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    incidentId: uuid("incident_id")
      .notNull()
      .references(() => incident.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branch.id),
    description: text("description").notNull(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => appUser.id),
    dueOn: date("due_on").notNull(),
    doneAt: timestamp("done_at", { withTimezone: true }),
    doneBy: uuid("done_by").references(() => appUser.id),
    isDemo: boolean("is_demo").notNull().default(false),
    ...tracked,
  },
  (t) => [index("incident_action_incident_idx").on(t.incidentId), index("incident_action_owner_idx").on(t.ownerUserId, t.dueOn)],
);

/** Photos and documents of an incident's full report. */
export const incidentFile = pgTable(
  "incident_file",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    incidentId: uuid("incident_id")
      .notNull()
      .references(() => incident.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branch.id),
    attachmentId: uuid("attachment_id")
      .notNull()
      .references(() => attachment.id),
    ...tracked,
  },
  (t) => [index("incident_file_incident_idx").on(t.incidentId)],
);

export const ISSUE_CATEGORIES = ["maintenance", "equipment", "supplies", "cleaning", "safety", "it", "other"] as const;
export const ISSUE_PRIORITIES = ["low", "normal", "high", "urgent"] as const;

/** Spec §7.6 / §8.8 `issue`: maintenance, equipment, supplies. */
export const issue = pgTable(
  "issue",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branch.id),
    category: text("category").notNull(),
    title: text("title").notNull(),
    details: text("details"),
    priority: text("priority").notNull().default("normal"),
    photoAttachmentId: uuid("photo_attachment_id").references(() => attachment.id),
    assignedTo: uuid("assigned_to").references(() => appUser.id),
    dueOn: date("due_on"),
    status: text("status").notNull().default("open"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: uuid("resolved_by").references(() => appUser.id),
    resolutionNote: text("resolution_note"),
    isDemo: boolean("is_demo").notNull().default(false),
    ...tracked,
  },
  (t) => [
    index("issue_branch_idx").on(t.branchId, t.status),
    index("issue_assigned_idx").on(t.assignedTo),
    check("issue_status_check", sql`${t.status} IN ('open', 'in_progress', 'resolved')`),
    check("issue_priority_check", sql`${t.priority} IN ('low', 'normal', 'high', 'urgent')`),
    check("issue_category_check", sql`${t.category} IN ('maintenance', 'equipment', 'supplies', 'cleaning', 'safety', 'it', 'other')`),
  ],
);

/**
 * One alert (spec §10): a critical one goes to everyone at once and repeats until one person
 * acknowledges it; a same-day one goes step by step (branch manager → company manager → owner).
 * dedupe_key stops the same thing raising two alerts.
 */
export const alert = pgTable(
  "alert",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branch.id),
    key: text("key").notNull(),
    tier: text("tier").notNull(),
    subjectTable: text("subject_table"),
    subjectId: uuid("subject_id"),
    dedupeKey: text("dedupe_key").notNull().unique(),
    step: integer("step").notNull().default(1),
    raisedAt: timestamp("raised_at", { withTimezone: true }).notNull().defaultNow(),
    nextStepAt: timestamp("next_step_at", { withTimezone: true }),
    lastSentAt: timestamp("last_sent_at", { withTimezone: true }),
    sendCount: integer("send_count").notNull().default(0),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    acknowledgedBy: uuid("acknowledged_by").references(() => appUser.id),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    isDemo: boolean("is_demo").notNull().default(false),
    ...tracked,
  },
  (t) => [
    index("alert_branch_idx").on(t.branchId, t.raisedAt),
    index("alert_open_idx").on(t.tier).where(sql`${t.acknowledgedAt} IS NULL AND ${t.resolvedAt} IS NULL`),
    check("alert_tier_check", sql`${t.tier} IN ('critical', 'same_day', 'info')`),
  ],
);

/** An alert as it reaches one person, in the app (spec §7.7 `notification`). */
export const notification = pgTable(
  "notification",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    alertId: uuid("alert_id")
      .notNull()
      .references(() => alert.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branch.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUser.id, { onDelete: "cascade" }),
    step: integer("step").notNull().default(1),
    readAt: timestamp("read_at", { withTimezone: true }),
    ...tracked,
  },
  (t) => [unique("notification_alert_user").on(t.alertId, t.userId), index("notification_user_idx").on(t.userId, t.createdAt)],
);

/**
 * A push or SMS to send for a notification. The text carries no personal data (rule 9):
 * "Critical incident at Norvale — open the app". Sent by the alert job (src/lib/notifier.ts).
 */
export const notificationDelivery = pgTable(
  "notification_delivery",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    notificationId: uuid("notification_id")
      .notNull()
      .references(() => notification.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branch.id),
    channel: text("channel").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    status: text("status").notNull().default("pending"),
    detail: text("detail"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("notification_delivery_due_idx").on(t.dueAt).where(sql`${t.status} = 'pending'`),
    check("notification_delivery_channel_check", sql`${t.channel} IN ('push', 'sms')`),
    check("notification_delivery_status_check", sql`${t.status} IN ('pending', 'sending', 'sent', 'failed', 'skipped')`),
  ],
);

/** A phone that agreed to receive push alerts (Web Push). */
export const pushSubscription = pgTable(
  "push_subscription",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUser.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("push_subscription_user_endpoint").on(t.userId, t.endpoint)],
);
