import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditFormalSpanish } from "./verify-formal-spanish.mjs";
import { auditPublicCopyControls } from "./verify-public-copy.mjs";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const baselineVersion = "2.0.111";

function fail(message) {
  throw new Error(`[release] ${message}`);
}

function readJson(relativePath) {
  return JSON.parse(
    fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8")
  );
}

function nextVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) fail(`Formato semántico inválido: ${version}`);
  const [, majorText, minorText, patchText] = match;
  const major = Number(majorText);
  const minor = Number(minorText);
  const patch = Number(patchText);
  return patch >= 999
    ? `${major}.${minor + 1}.0`
    : `${major}.${minor}.${patch + 1}`;
}

const packageMetadata = readJson("package.json");
const currentVersion = packageMetadata.version;
const versionMatch = /^2\.(\d+)\.(\d+)$/.exec(currentVersion);
if (!versionMatch)
  fail(`JARVI RH requiere versión 2.x.y; recibido ${currentVersion}.`);
if (Number(versionMatch[2]) > 999) fail("El parche no puede superar 999.");

const readme = fs.readFileSync(path.join(repositoryRoot, "README.md"), "utf8");
const governance = fs.readFileSync(
  path.join(repositoryRoot, "docs/RELEASE_GOVERNANCE.md"),
  "utf8"
);
const validation = fs.readFileSync(
  path.join(repositoryRoot, "docs/VALIDACION_FINAL.md"),
  "utf8"
);
const blackBoxPath = path.join(
  repositoryRoot,
  `docs/PRUEBAS_CAJA_NEGRA_${currentVersion}.md`
);
if (!fs.existsSync(blackBoxPath)) {
  fail(`Falta la hoja de caja negra de ${currentVersion}.`);
}
const blackBox = fs.readFileSync(blackBoxPath, "utf8");
if (!readme.includes(`JARVI%20RH-${currentVersion}`)) {
  fail("El badge Markdown de README no coincide con package.json.");
}
if (
  !new RegExp(
    `### \\d{2}[A-Z]{3}\\d{4} · JARVI RH ${currentVersion.replaceAll(".", "\\.")}`
  ).test(readme)
) {
  fail("El historial README no documenta el release vigente.");
}
if (!governance.includes(`JARVI RH ${currentVersion}`)) {
  fail("La hoja de gobierno no coincide con package.json.");
}
if (
  !validation.includes(`JARVI RH ${currentVersion}`) ||
  !blackBox.includes(`JARVI RH ${currentVersion}`)
) {
  fail("Las hojas de validación no coinciden con package.json.");
}

for (const [dependency, expected] of [
  ["langfuse", "3.38.20"],
  ["@langchain/langgraph", "1.4.14"],
  ["@langchain/openai", "1.5.11"],
  ["openai", "7.13.0"],
]) {
  const declared = String(packageMetadata.dependencies?.[dependency] ?? "");
  if (!declared.includes(expected)) {
    fail(
      `${dependency} debe documentarse y validarse con la versión instalada.`
    );
  }
}

const formalSpanishAudit = auditFormalSpanish();
if (formalSpanishAudit.findings.length > 0) {
  const details = formalSpanishAudit.findings
    .map(finding => `${finding.file}:${finding.line} ${finding.context}`)
    .join("; ");
  fail(`La auditoría de tratamiento formal falló: ${details}`);
}

const publicCopyAudit = auditPublicCopyControls();
if (publicCopyAudit.findings.length > 0) {
  fail(
    `La auditoría de textos públicos falló: ${publicCopyAudit.findings.join("; ")}`
  );
}

if (process.argv.includes("--compare-git")) {
  let previousVersion;
  try {
    const previousPackage = execFileSync(
      "git",
      ["show", "HEAD^:package.json"],
      { cwd: repositoryRoot, encoding: "utf8" }
    );
    previousVersion = JSON.parse(previousPackage).version;
  } catch {
    fail("No fue posible consultar la versión del commit anterior.");
  }
  if (previousVersion === currentVersion) {
    fail("Cada push a main debe incrementar la versión JARVI RH.");
  }
  if (/^2\.\d+\.\d+$/.test(previousVersion)) {
    const expected = nextVersion(previousVersion);
    if (currentVersion !== expected) {
      fail(`Se esperaba ${expected} después de ${previousVersion}.`);
    }
  } else if (currentVersion !== baselineVersion) {
    fail(`La adopción inicial debe comenzar en ${baselineVersion}.`);
  }
}

console.log(`JARVI RH ${currentVersion}: gobierno de release verificado.`);
