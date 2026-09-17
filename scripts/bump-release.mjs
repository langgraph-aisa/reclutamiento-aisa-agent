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

function replaceVersion(relativePath, content) {
  // La versión dentro de un nombre de archivo (…2.0.138.md) identifica un
  // documento histórico congelado: reescribirla rompería el enlace. Solo se
  // sustituyen las versiones que no forman parte de una ruta de documento.
  const versionPattern = new RegExp(
    `${currentVersion.replaceAll(".", "\\.")}(?!\\.md)`,
    "g"
  );
  // Los encabezados y párrafos de alcance describen releases ya entregados:
  // avanzarlos renombraría la historia y haría que una entrega anterior
  // apareciera como la vigente. En el párrafo del incremento atómico avanza
  // solo la versión futura, nunca la ya ejecutada.
  const historicalHeading = /^#{1,6}\s*Alcance\b/;
  const historicalParagraph = /^El alcance de \d/;
  const historicalCandidate = /^La especificación candidata de \d/;
  const atomicIncrement = /incremento atómico a/;
  const escapedCurrentVersion = currentVersion.replaceAll(".", "\\.");
  const futurePatch = new RegExp(`(será\\s+)${escapedCurrentVersion}\\.`);
  // El documento de caja negra se renombra en cada entrega: su referencia en el
  // cuerpo del README debe acompañar el renombrado en lugar de quedar congelada
  // apuntando a un archivo que ya no existe.
  const blackBoxReference = new RegExp(
    `PRUEBAS_CAJA_NEGRA_${escapedCurrentVersion}\\.md`,
    "g"
  );
  const substitute = value =>
    value
      .split("\n")
      .map(line => {
        if (
          historicalHeading.test(line) ||
          historicalParagraph.test(line) ||
          historicalCandidate.test(line)
        ) {
          return line;
        }
        if (atomicIncrement.test(line)) {
          return line.replace(futurePatch, `$1${nextVersion}.`);
        }
        return line
          .replace(versionPattern, nextVersion)
          .replace(
            blackBoxReference,
            `PRUEBAS_CAJA_NEGRA_${nextVersion}.md`
          );
      })
      .join("\n");
  if (relativePath !== "README.md") {
    return substitute(content);
  }
  const startMarker = "<!-- release-history:start -->";
  const endMarker = "<!-- release-history:end -->";
  const start = content.indexOf(startMarker);
  const end = content.indexOf(endMarker);
  if (start < 0 || end < start) {
    throw new Error("README.md no contiene los marcadores del historial.");
  }
  const historyEnd = end + endMarker.length;
  return [
    substitute(content.slice(0, start)),
    content.slice(start, historyEnd),
    substitute(content.slice(historyEnd)),
  ].join("");
}

const updates = synchronizedFiles.map(relativePath => {
  const target = path.join(repositoryRoot, relativePath);
  const content = fs.readFileSync(target, "utf8");
  if (!content.includes(currentVersion)) {
    throw new Error(
      `${relativePath} no contiene la versión ${currentVersion}.`
    );
  }
  return { target, content: replaceVersion(relativePath, content) };
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
