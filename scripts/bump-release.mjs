import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const packagePath = path.join(repositoryRoot, "package.json");
const packageMetadata = JSON.parse(fs.readFileSync(packagePath, "utf8"));
const currentVersion = packageMetadata.version;
const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(currentVersion);
if (!match) throw new Error(`Versión inválida: ${currentVersion}`);
const [, majorText, minorText, patchText] = match;
const major = Number(majorText);
const minor = Number(minorText);
const patch = Number(patchText);
const nextVersion =
  patch >= 999 ? `${major}.${minor + 1}.0` : `${major}.${minor}.${patch + 1}`;

if (process.argv.includes("--dry-run")) {
  console.log(`${currentVersion} -> ${nextVersion}`);
  process.exit(0);
}

const currentBlackBoxPath = `docs/PRUEBAS_CAJA_NEGRA_${currentVersion}.md`;
const nextBlackBoxPath = `docs/PRUEBAS_CAJA_NEGRA_${nextVersion}.md`;
if (fs.existsSync(path.join(repositoryRoot, nextBlackBoxPath))) {
  throw new Error(`${nextBlackBoxPath} ya existe.`);
}

const synchronizedFiles = [
  "README.md",
  "docs/RELEASE_GOVERNANCE.md",
  "docs/VALIDACION_FINAL.md",
  "server/releaseGovernance.test.ts",
  currentBlackBoxPath,
];
const updates = synchronizedFiles.map(relativePath => {
  const target = path.join(repositoryRoot, relativePath);
  const content = fs.readFileSync(target, "utf8");
  if (!content.includes(currentVersion)) {
    throw new Error(
      `${relativePath} no contiene la versión ${currentVersion}.`
    );
  }
  return { target, content: content.replaceAll(currentVersion, nextVersion) };
});

packageMetadata.version = nextVersion;
fs.writeFileSync(packagePath, `${JSON.stringify(packageMetadata, null, 2)}\n`);
for (const update of updates) {
  fs.writeFileSync(update.target, update.content);
}

fs.renameSync(
  path.join(repositoryRoot, currentBlackBoxPath),
  path.join(repositoryRoot, nextBlackBoxPath)
);

console.log(`JARVI RH actualizado: ${currentVersion} -> ${nextVersion}`);
