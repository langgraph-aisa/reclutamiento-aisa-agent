import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Compone el script único de despliegue del servicio conversacional.
 *
 * Fuentes (no se editan aquí):
 *   1. drizzle/migrations/0022_conversational_agent.sql
 *   2. drizzle/migrations/0023_conversation_service_split.sql
 *   3. drizzle/migrations/0024_conversation_activation.sql
 *   4. database/verificacion_servicio_conversacional.sql
 *
 * Salida:
 *   database/005_servicio_conversacional_listo.sql
 *
 * Uso:
 *   node scripts/build-conversation-deployment-sql.mjs           # escribe
 *   node scripts/build-conversation-deployment-sql.mjs --check   # falla si está desactualizado
 */

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

const sources = [
  "drizzle/migrations/0022_conversational_agent.sql",
  "drizzle/migrations/0023_conversation_service_split.sql",
  "drizzle/migrations/0024_conversation_activation.sql",
];

const verificationPath = "database/verificacion_servicio_conversacional.sql";
const outputPath = "database/005_servicio_conversacional_listo.sql";

function read(relativePath) {
  return fs
    .readFileSync(path.join(repositoryRoot, relativePath), "utf8")
    .replace(/\s+$/, "");
}

const packageMetadata = JSON.parse(
  fs.readFileSync(path.join(repositoryRoot, "package.json"), "utf8")
);

const header = `-- ============================================================================
-- JARVI RH ${packageMetadata.version} · Despliegue completo del servicio conversacional
-- ============================================================================
-- Archivo GENERADO. No editar a mano: se compone con
--   pnpm deploy:sql
-- a partir de las migraciones 0022, 0023 y 0024 más la consulta única de
-- verificación. Repetir su ejecución es seguro: todas las sentencias son
-- idempotentes y ninguna contiene credenciales.
--
-- Qué deja listo al terminar:
--   · la memoria conversacional (turnos, resúmenes, ciclos, bitácora de eventos);
--   · el RAG personal del candidato alimentado solo con evidencia literal;
--   · la cola de salida con reclamo atómico y la vista de reconciliación;
--   · los esquemas y roles de privilegio mínimo por capacidad;
--   · la activación **preactivada** en el panel de configuración.
--
-- Cómo usarlo: pegue el contenido completo en el ejecutor SQL (dbgate o
-- EasyPanel) y ejecútelo una sola vez. Al final se imprime la verificación
-- autocertificada: todas las filas en OK y el GATE GLOBAL en OK.
-- ============================================================================

`;

const body = sources
  .map(
    relativePath =>
      `-- ----------------------------------------------------------------------------\n-- Origen: ${relativePath}\n-- ----------------------------------------------------------------------------\n\n${read(relativePath)}`
  )
  .join("\n\n");

const verification = read(verificationPath);

const content = `${header}${body}\n\n-- ----------------------------------------------------------------------------\n-- Verificación autocertificada\n-- ----------------------------------------------------------------------------\n\n${verification}\n`;

const outputAbsolute = path.join(repositoryRoot, outputPath);

if (process.argv.includes("--check")) {
  const current = fs.existsSync(outputAbsolute)
    ? fs.readFileSync(outputAbsolute, "utf8")
    : null;
  if (current !== content) {
    console.error(
      `[deploy:sql] ${outputPath} está desactualizado. Ejecute pnpm deploy:sql.`
    );
    process.exit(1);
  }
  console.log(`[deploy:sql] ${outputPath} sincronizado con las migraciones.`);
  process.exit(0);
}

fs.writeFileSync(outputAbsolute, content);
console.log(
  `[deploy:sql] ${outputPath} generado (${content.split("\n").length} líneas).`
);
