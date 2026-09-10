import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditFormalSpanish } from "./verify-formal-spanish.mjs";

const projectRoot = process.cwd();

function source(relativePath) {
  return fs.readFileSync(path.resolve(projectRoot, relativePath), "utf8");
}

function requireSource(findings, text, marker, description) {
  if (!text.includes(marker)) findings.push(description);
}

function forbidSource(findings, text, marker, description) {
  if (text.includes(marker)) findings.push(description);
}

export function auditPublicCopyControls() {
  const findings = [];
  const formal = auditFormalSpanish();
  findings.push(
    ...formal.findings.map(
      finding =>
        `${finding.file}:${finding.line}: ${finding.rule} (${finding.context})`
    )
  );

  const editorial = source("server/profileEditorial.ts");
  const routers = source("server/routers.ts");
  const bootstrap = source("server/_core/index.ts");
  const profiles = source("client/src/pages/Profiles.tsx");
  const home = source("client/src/pages/Home.tsx");
  const apply = source("client/src/pages/Apply.tsx");

  requireSource(
    findings,
    editorial,
    "PUBLIC_COPY_EDITORIAL_MODEL = PROFILE_EDITORIAL_MODEL",
    "El contenido público debe usar el modelo editorial versionado."
  );
  requireSource(
    findings,
    editorial,
    'PROFILE_EDITORIAL_MODEL = "gpt-4.1-mini-2025-04-14"',
    "El modelo editorial mínimo debe permanecer fijado al snapshot aprobado de GPT-4.1 mini."
  );
  requireSource(
    findings,
    editorial,
    "client.responses.parse",
    "La corrección editorial debe usar OpenAI Responses API con salida estructurada."
  );
  requireSource(
    findings,
    editorial,
    "zodTextFormat",
    "La respuesta editorial debe validarse con un esquema estructurado."
  );
  requireSource(
    findings,
    editorial,
    "store: false",
    "La revisión editorial no debe habilitar el almacenamiento de respuestas en OpenAI."
  );
  requireSource(
    findings,
    editorial,
    "RAE/ASALE",
    "La instrucción editorial debe exigir español académico formal."
  );
  requireSource(
    findings,
    editorial,
    "Preserve literalmente variables delimitadas por llaves dobles",
    "Las variables de mensajes públicos deben conservarse literalmente."
  );
  requireSource(
    findings,
    routers,
    "profilePublicCopyInput",
    "Los perfiles laborales deben incorporarse al control editorial."
  );
  requireSource(
    findings,
    routers,
    "positionPublicCopyInput",
    "Las plazas deben incorporarse al control editorial."
  );
  requireSource(
    findings,
    routers,
    "formBundlePublicCopyInput",
    "Los formularios y todas sus preguntas deben revisarse en conjunto."
  );
  requireSource(
    findings,
    routers,
    "normalizeStoredQuestion",
    "Las preguntas históricas deben revisarse antes de reactivarse."
  );
  requireSource(
    findings,
    routers,
    "public_copy_editorially_normalized",
    "La validación editorial debe dejar evidencia en la bitácora."
  );
  requireSource(
    findings,
    routers,
    "auditPublishedPublicCopy",
    "Las plazas ya publicadas deben incluirse en un barrido editorial automático."
  );
  requireSource(
    findings,
    bootstrap,
    "auditPublishedPublicCopy(pool)",
    "El barrido editorial debe ejecutarse al iniciar el servicio."
  );
  requireSource(
    findings,
    profiles,
    "splitBullets(form.responsibilities)",
    "Las responsabilidades deben conservar una idea completa por línea."
  );
  requireSource(
    findings,
    profiles,
    'responsibilities: (profile.responsibilities ?? []).join("\\n")',
    "La edición de responsabilidades no debe volver a fragmentarlas por comas."
  );

  forbidSource(
    findings,
    home,
    "Cada plaza merece una evaluación",
    "La portada conserva una frase pública sustituida."
  );
  forbidSource(
    findings,
    apply,
    "Antes de comenzar",
    "La solicitud conserva un encabezado público sustituido."
  );
  forbidSource(
    findings,
    home,
    "Inicia el formulario en esta misma pestaña.",
    "La landing conserva una instrucción pública eliminada."
  );

  return { files: formal.files, findings };
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const audit = auditPublicCopyControls();
  if (audit.findings.length) {
    console.error("Se detectaron incumplimientos editoriales públicos:\n");
    for (const finding of audit.findings) console.error(`- ${finding}`);
    process.exitCode = 1;
  } else {
    console.log(
      `Control editorial público verificado en ${audit.files.length} archivos de ejecución.`
    );
  }
}
