import { Pool } from "pg";
import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";

/** Se limita a una instancia de prueba explícita; nunca usa DATABASE_URL. */
export async function createMediaTestDatabase() {
  const supplied = process.env.MEDIA_TEST_DATABASE_URL;
  if (!supplied) throw new Error("MEDIA_TEST_DATABASE_URL es obligatorio para PostgreSQL de prueba.");
  const base = new URL(supplied);
  if (!["127.0.0.1", "localhost"].includes(base.hostname) || !base.pathname.endsWith("_test")) {
    throw new Error("La base de pruebas debe ser local y terminar en _test.");
  }
  const admin = new Pool({ connectionString: supplied });
  const name = `media_case_${randomBytes(6).toString("hex")}_test`;
  await admin.query(`CREATE DATABASE "${name}"`);
  base.pathname = `/${name}`;
  const pool = new Pool({ connectionString: base.toString(), max: 12 });
  try {
    const migrations = (await fs.readdir("drizzle/migrations")).filter(name => /^\d+.*\.sql$/.test(name)).sort();
    for (const migration of migrations) {
      const sql = await fs.readFile(path.join("drizzle/migrations", migration), "utf8");
      for (const statement of sql.split("--> statement-breakpoint")) {
        try { if (statement.trim()) await pool.query(statement); }
        catch (error) { throw new Error(`${migration}: ${error instanceof Error ? error.message : "migration failed"}`); }
      }
    }
  } catch (error) {
    await pool.end();
    await admin.query(`DROP DATABASE "${name}"`);
    await admin.end();
    throw error;
  }
  return { pool, url: base.toString(), async close() {
    await pool.end();
    await admin.query(`DROP DATABASE "${name}"`);
    await admin.end();
  } };
}
