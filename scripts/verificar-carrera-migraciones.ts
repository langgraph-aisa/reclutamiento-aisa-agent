import { Pool } from "pg";

/**
 * Verificación de la carrera de migraciones entre archivos de prueba.
 *
 * Fundamento
 * ----------
 * El 21 de septiembre de 2026 la puerta de integración continua falló con
 * `0023_conversation_service_split.sql: duplicate key value violates unique
 * constraint "pg_authid_rolname_index"` —un fallo intermitente, ajeno al cambio
 * que lo acompañaba y por tanto atribuible al azar—. La causa es una carrera
 * clásica de consulta-antes-de-actuar: la migración comprueba `pg_roles` y
 * después crea el rol, de modo que dos migradores simultáneos ven «no existe»
 * los dos. `CREATE SCHEMA IF NOT EXISTS` tiene la misma forma, y cualquier
 * migración futura puede reintroducirla.
 *
 * El **rol es del clúster y no de la base**, así que dos bases de prueba
 * distintas —que es lo que la suite crea en paralelo— colisionan entre sí. Por
 * eso la defensa vive en el arnés, que serializa la aplicación de migraciones
 * con un cerrojo consultivo, y no en cada guarda de cada migración: corregir
 * una guarda no cierra la clase.
 *
 * Esta verificación mide las dos mitades del hecho: que la carrera existe —sin
 * cerrojo— y que el cerrojo la cierra. Ejecutarla es deliberado, no forma parte
 * de la suite: crea y retira roles del clúster.
 *
 * Uso: `MEDIA_TEST_DATABASE_URL=… pnpm verify:migrations`
 */

const url = process.env.MEDIA_TEST_DATABASE_URL;
if (!url) {
  console.error("MEDIA_TEST_DATABASE_URL es obligatorio para verificar la carrera.");
  process.exit(2);
}

/** El mismo cerrojo que toma `server/testSupport/mediaDatabase.ts`. */
const MIGRATION_LOCK = 1_946_207;
const ROUNDS = 10;

/** El bloque exacto de `0023_conversation_service_split.sql`. */
function guardedRole(name: string) {
  return `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${name}') THEN
      EXECUTE 'CREATE ROLE ${name} LOGIN PASSWORD NULL';
    END IF;
  END $$;`;
}

/** Dos sesiones simultáneas que ejecutan la guarda sobre el mismo nombre. */
async function attempt(name: string, serialize: boolean) {
  const pool = new Pool({ connectionString: url, max: 2 });
  const run = async () => {
    const client = await pool.connect();
    try {
      if (serialize) await client.query("SELECT pg_advisory_lock($1)", [
        MIGRATION_LOCK,
      ]);
      await client.query(guardedRole(name));
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    } finally {
      if (serialize)
        await client
          .query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK])
          .catch(() => undefined);
      client.release();
    }
  };
  const outcomes = await Promise.all([run(), run()]);
  await pool.end();
  return outcomes.filter(Boolean) as string[];
}

async function rounds(serialize: boolean, suffix: string) {
  const names: string[] = [];
  let collisions = 0;
  for (let round = 0; round < ROUNDS; round += 1) {
    const name = `jarvi_race_${suffix}_${round}`;
    names.push(name);
    const errors = await attempt(name, serialize);
    if (errors.length) {
      collisions += 1;
      if (collisions === 1) console.log(`  primer fallo: ${errors[0]}`);
    }
  }
  const cleanup = new Pool({ connectionString: url, max: 1 });
  for (const name of names)
    await cleanup.query(`DROP ROLE IF EXISTS ${name}`).catch(() => undefined);
  await cleanup.end();
  return collisions;
}

const free = await rounds(false, "free");
const serialized = await rounds(true, "serial");
console.log(`sin cerrojo: ${free}/${ROUNDS} rondas con colisión`);
console.log(`con cerrojo: ${serialized}/${ROUNDS} rondas con colisión`);

if (free === 0) {
  console.log(
    "No concluyente: la carrera no se reprodujo en esta máquina. El cerrojo no puede darse por verificado aquí."
  );
  process.exit(0);
}
if (serialized > 0) {
  console.error("El cerrojo no cierra la carrera: la suite volverá a fallar sin causa aparente.");
  process.exit(1);
}
console.log(
  "Verificado: la carrera existe sin cerrojo y el cerrojo la cierra."
);
