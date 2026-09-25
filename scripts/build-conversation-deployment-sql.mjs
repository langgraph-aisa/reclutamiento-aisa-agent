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
 *   4. drizzle/migrations/0025_inbox_read_state.sql
 *   5. drizzle/migrations/0026_candidate_knowledge.sql
 *   6. drizzle/migrations/0027_candidate_cv_essence.sql
 *   7. drizzle/migrations/0028_assessment_cycles.sql
 *   8. drizzle/migrations/0029_assessment_cycle_evaluation.sql
 *   9. drizzle/migrations/0030_assessment_item_attempts.sql
 *  10. drizzle/migrations/0031_evaluation_automation.sql
 *  11. drizzle/migrations/0032_codec_registry.sql
 *  12. drizzle/migrations/0033_security_roles.sql
 *  13. drizzle/migrations/0034_recruiter_agent.sql
 *  14. drizzle/migrations/0035_transport_traces.sql
 *  15. drizzle/migrations/0036_apichat_inbound_receipts.sql
 *  16. drizzle/migrations/0037_candidate_processing.sql
 *  17. drizzle/migrations/0038_message_key_immutable.sql
 *  18. drizzle/migrations/0039_project_drive_activation.sql
 *  19. drizzle/migrations/0040_screening_questions.sql
 *  20. drizzle/migrations/0041_screening_attempts.sql
 *  21. drizzle/migrations/0042_screening_phase_switches.sql
 *  22. drizzle/migrations/0043_agent_ai_log.sql
 *  23. drizzle/migrations/0044_dropbox_custody.sql
 *  24. database/verificacion_servicio_conversacional.sql
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
  "drizzle/migrations/0025_inbox_read_state.sql",
  "drizzle/migrations/0026_candidate_knowledge.sql",
  "drizzle/migrations/0027_candidate_cv_essence.sql",
  "drizzle/migrations/0028_assessment_cycles.sql",
  "drizzle/migrations/0029_assessment_cycle_evaluation.sql",
  "drizzle/migrations/0030_assessment_item_attempts.sql",
  "drizzle/migrations/0031_evaluation_automation.sql",
  "drizzle/migrations/0032_codec_registry.sql",
  "drizzle/migrations/0033_security_roles.sql",
  "drizzle/migrations/0034_recruiter_agent.sql",
  "drizzle/migrations/0035_transport_traces.sql",
  "drizzle/migrations/0036_apichat_inbound_receipts.sql",
  "drizzle/migrations/0037_candidate_processing.sql",
  "drizzle/migrations/0038_message_key_immutable.sql",
  "drizzle/migrations/0039_project_drive_activation.sql",
  "drizzle/migrations/0040_screening_questions.sql",
  "drizzle/migrations/0041_screening_attempts.sql",
  "drizzle/migrations/0042_screening_phase_switches.sql",
  "drizzle/migrations/0043_agent_ai_log.sql",
  "drizzle/migrations/0044_dropbox_custody.sql",
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
-- a partir de las migraciones 0022 a 0044 más la consulta única de
-- verificación. Repetir su ejecución es seguro: todas las sentencias son
-- idempotentes y ninguna contiene credenciales.
--
-- Qué deja listo al terminar:
--   · la memoria conversacional (turnos, resúmenes, ciclos, bitácora de eventos);
--   · el RAG personal del candidato alimentado solo con evidencia literal;
--   · la cola de salida con reclamo atómico y la vista de reconciliación;
--   · los esquemas y roles de privilegio mínimo por capacidad;
--   · el expediente documental del candidato y la esencia de su CV;
--   · el ciclo de pruebas psicométricas, su traza por ítem y su cierre evaluado;
--   · la recepción durable de adjuntos y la cola de procesamiento documental;
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
