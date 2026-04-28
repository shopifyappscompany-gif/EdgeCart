#!/usr/bin/env node
// Patches prisma/schema.prisma provider based on DATABASE_URL at runtime.
// - file:// → sqlite  (local dev, zero setup)
// - postgres:// / postgresql:// → postgresql  (Railway / Render production)

import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(__dirname, "../prisma/schema.prisma");

const dbUrl = process.env.DATABASE_URL ?? "";
const isPostgres =
  dbUrl.startsWith("postgres://") || dbUrl.startsWith("postgresql://");

const targetProvider = isPostgres ? "postgresql" : "sqlite";

let schema = readFileSync(schemaPath, "utf8");

// Replace whichever provider is currently set
schema = schema.replace(
  /provider\s*=\s*"(sqlite|postgresql)"/,
  `provider = "${targetProvider}"`
);

writeFileSync(schemaPath, schema, "utf8");

console.log(`[setup-db] DATABASE_URL detected as ${isPostgres ? "PostgreSQL" : "SQLite"} → schema provider set to "${targetProvider}"`);
