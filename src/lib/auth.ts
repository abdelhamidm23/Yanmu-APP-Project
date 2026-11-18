import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { twoFactor } from "better-auth/plugins";
import { db } from "@/db";
import { authSchema } from "@/db/schema";
import { pinLogin } from "./pin-auth";

const extraOrigins = (process.env.TRUSTED_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export const auth = betterAuth({
  appName: "Yanmu Nursery",
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  trustedOrigins: extraOrigins,
  database: drizzleAdapter(db, { provider: "pg", schema: authSchema }),
  advanced: {
    database: { generateId: "uuid" },
    cookiePrefix: "yanmu",
  },
  user: {
    modelName: "user",
    additionalFields: {
      locale: { type: "string", required: false, defaultValue: "ar", input: true },
      digits: { type: "string", required: false, defaultValue: "latin", input: true },
      phone: { type: "string", required: false, input: false },
      isSafeguardingLead: { type: "boolean", required: false, defaultValue: false, input: false },
      endDate: { type: "date", required: false, input: false },
    },
  },
  emailAndPassword: {
    enabled: true,
    // Staff accounts are created by the owner / company manager, never by self sign-up.
    disableSignUp: true,
    minPasswordLength: 10,
  },
  session: {
    // Spec §14: 12 h sessions on personal phones. Shared class phones: PIN sign-in and 30 minutes idle (src/lib/pin-auth.ts).
    expiresIn: 60 * 60 * 12,
    updateAge: 60 * 60,
    additionalFields: {
      sharedDevice: { type: "boolean", required: false, defaultValue: false, input: false },
      lastActiveAt: { type: "date", required: false, input: false },
    },
  },
  rateLimit: {
    enabled: process.env.AUTH_RATE_LIMIT !== "off",
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: 10 },
      "/two-factor/verify-totp": { window: 60, max: 10 },
      "/pin/sign-in": { window: 60, max: 10 },
    },
  },
  plugins: [twoFactor({ issuer: "Yanmu Nursery" }), pinLogin(), nextCookies()],
});

export type Session = typeof auth.$Infer.Session;
