/**
 * Database schema (Drizzle). Phase 0 holds only what sign-in needs:
 * the user table, Better Auth's session/account/verification/two-factor tables,
 * and the role assignments that pick each person's navigation.
 *
 * Branches, rooms, RLS policies and the audit trigger arrive in Phase 1
 * (docs/SPEC.md §7 and §13). `user_branch_role.branch_id` gets its foreign key then.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
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
    branchId: uuid("branch_id"),
    role: roleEnum("role").notNull(),
    ...timestamps,
  },
  (t) => [unique("user_branch_role_unique").on(t.userId, t.branchId, t.role).nullsNotDistinct()],
);

export const authSchema = {
  user: appUser,
  session: authSession,
  account: authAccount,
  verification: authVerification,
  twoFactor: authTwoFactor,
};
