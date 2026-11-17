import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const url = process.env.DATABASE_URL ?? "postgres://yanmu:yanmu@localhost:5432/yanmu";

// Reuse one pool across hot reloads in development.
const globalForDb = globalThis as unknown as { pgClient?: ReturnType<typeof postgres> };
export const pgClient = globalForDb.pgClient ?? postgres(url, { max: 10 });
if (process.env.NODE_ENV !== "production") globalForDb.pgClient = pgClient;

export const db = drizzle(pgClient, { schema });
export { schema };
