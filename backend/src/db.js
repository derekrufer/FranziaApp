import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;

const databaseUrl = process.env.DATABASE_URL;
let pool;
let schemaReady = false;

function getDatabaseName() {
  if (!databaseUrl) {
    return null;
  }

  try {
    return new URL(databaseUrl).pathname.replace(/^\//, "") || null;
  } catch {
    return null;
  }
}

export function hasDatabaseConfig() {
  return Boolean(databaseUrl);
}

export function getPool() {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not configured.");
  }

  if (!pool) {
    pool = new Pool({ connectionString: databaseUrl });
  }

  return pool;
}

export async function ensureSchema() {
  if (schemaReady) {
    return;
  }

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const localSchemaPath = path.resolve(__dirname, "../../database/schema.sql");
  const dockerSchemaPath = "/database/schema.sql";
  const schemaPath = existsSync(localSchemaPath) ? localSchemaPath : dockerSchemaPath;
  const schema = await readFile(schemaPath, "utf8");
  await getPool().query(schema);
  schemaReady = true;
}

export async function getDatabaseStatus() {
  if (!hasDatabaseConfig()) {
    return { configured: false, connected: false, databaseName: null, error: "DATABASE_URL is not configured." };
  }

  try {
    await ensureSchema();
    await getPool().query("SELECT 1");
    return { configured: true, connected: true, databaseName: getDatabaseName() };
  } catch (error) {
    const nestedMessage = error.errors?.map((nestedError) => nestedError.message).filter(Boolean).join("; ");
    return {
      configured: true,
      connected: false,
      databaseName: getDatabaseName(),
      error: error.message || nestedMessage || "Unable to connect to PostgreSQL."
    };
  }
}

export async function withDb(callback) {
  await ensureSchema();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
