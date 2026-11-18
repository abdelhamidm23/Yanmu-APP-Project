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
    ...tracked,
  },
  (t) => [
    index("approval_request_branch_idx").on(t.branchId),
    index("approval_request_to_branch_idx").on(t.toBranchId),
    check("approval_type_check", sql`${t.type} IN ('over_capacity', 'transfer')`),
    check("approval_status_check", sql`${t.status} IN ('pending', 'approved', 'declined', 'cancelled')`),
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
