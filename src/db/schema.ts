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
    ...timestamps,
  },
  (t) => [index("auth_session_user_idx").on(t.userId)],
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
