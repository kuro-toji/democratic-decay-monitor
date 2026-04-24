import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "./schema";

// Database file location (configurable via DATABASE_URL env var)
// For local SQLite, use file:path/to/db.sqlite format
const DB_URL = process.env.DATABASE_URL ?? "file:data/democracy.db";

// Create libsql client
const client = createClient({ url: DB_URL });

// Create drizzle instance with schema
export const db = drizzle(client, { schema });

// Export schema for use in routes and services
export * from "./schema";

// Re-export query builders for convenience
export { eq, ne, gt, gte, lt, lte, and, or, inArray, like, desc, asc } from "drizzle-orm";