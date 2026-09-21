import { Pool } from "pg";
import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";

/**
 * Cerrojo que serializa la aplicación de migraciones entre archivos de prueba.
 *
 * Las migraciones no son seguras frente a la concurrencia, y no por descuido de
 * una en particular: `CREATE SCHEMA IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`
 * y las guardas de rol consultan antes de crear, de modo que dos transacciones
 * simultáneas pueden ver «no existe» las dos y la segunda falla con una
 * violación de unicidad —`0023` creando un rol del clúster, por ejemplo—.
 * `pg_advisory_lock` es del clúster y no de la base, así que las bases de prueba
 * se construyen de una en una mientras las pruebas siguen en paralelo.
 *
 * Corregir cada guarda de cada migración no cierra la clase: cualquier migración
 * futura volvería a introducir la carrera, y el fallo aparecería como una
 * pérdida intermitente y ajena al cambio que la provocó.
 */
const MEDIA_TEST_MIGRATION_LOCK = 1_946_207;

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
  // El cerrojo viaja en una conexión propia: `pg_advisory_unlock` sólo libera el
  // cerrojo tomado por la MISMA sesión, y un cliente del fondo podría no ser el
  // mismo en la segunda llamada.
  const gate = await admin.connect();
  try {
    await gate.query("SELECT pg_advisory_lock($1)", [MEDIA_TEST_MIGRATION_LOCK]);
    try {
      const migrations = (await fs.readdir("drizzle/migrations")).filter(name => /^\d+.*\.sql$/.test(name)).sort();
      for (const migration of migrations) {
        const sql = await fs.readFile(path.join("drizzle/migrations", migration), "utf8");
        for (const statement of sql.split("--> statement-breakpoint")) {
          try { if (statement.trim()) await pool.query(statement); }
          catch (error) { throw new Error(`${migration}: ${error instanceof Error ? error.message : "migration failed"}`); }
        }
      }
    } finally {
      await gate
        .query("SELECT pg_advisory_unlock($1)", [MEDIA_TEST_MIGRATION_LOCK])
        .catch(() => undefined);
    }
  } catch (error) {
    gate.release();
    await pool.end();
    await admin.query(`DROP DATABASE "${name}"`);
    await admin.end();
    throw error;
  }
  gate.release();
  return { pool, url: base.toString(), async close() {
    await pool.end();
    await admin.query(`DROP DATABASE "${name}"`);
    await admin.end();
  } };
}
