/**
 * =============================================================================
 * Prisma Database Client Configuration
 * =============================================================================
 * 
 * Sets up Prisma 7 with the PostgreSQL driver adapter (@prisma/adapter-pg).
 * Supports both standard postgres:// URLs and local prisma+postgres:// URLs.
 * =============================================================================
 */

import "dotenv/config";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

const rawConnectionString = process.env.DATABASE_URL;

if (!rawConnectionString) {
  throw new Error("DATABASE_URL is not configured in .env");
}

/**
 * Resolves a direct TCP PostgreSQL connection string.
 * If the user has a prisma+postgres:// URL (from prisma dev / local),
 * we unpack the embedded underlying PostgreSQL TCP URL so pg.Pool can connect.
 */
function resolvePostgresUrl(raw: string): string {
  if (raw.startsWith("prisma+postgres://")) {
    try {
      const urlObj = new URL(raw);
      const apiKey = urlObj.searchParams.get("api_key");
      if (apiKey) {
        const decoded = JSON.parse(Buffer.from(apiKey, "base64").toString("utf8"));
        if (decoded.databaseUrl) {
          return decoded.databaseUrl;
        }
      }
    } catch (err) {
      console.warn("Could not parse prisma+postgres API key, using raw URL:", err);
    }
  }
  return raw;
}

const connectionString = resolvePostgresUrl(rawConnectionString);

// Create a connection pool with sensible limits for 10,000-scale operations
const pool = new pg.Pool({
  connectionString,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

const adapter = new PrismaPg(pool);

export const prisma = new PrismaClient({
  adapter,
  log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"]
});