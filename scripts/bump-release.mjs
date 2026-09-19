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
  // Un alcance ya entregado se congela entero, no solo su encabezado: el
  // cuerpo narra hechos con la versión que los entregó. Congelar únicamente la
  // línea del título dejaba el cuerpo expuesto y cada incremento reescribía el
  // literal dentro de la narración histórica —la entrega 2.0.166 llegó a citar
  // 2.0.189—, corrupción acumulativa que delata
  // `scripts/verify-documentary-integrity.mjs`.
  const frozenHeading = /^(#{1,6})\s*(?:Alcance\b|Fuentes primarias\b)/;
  const anyHeading = /^(#{1,6})\s/;
  // Una anotación posterior nombra la entrega que resolvió el límite que la
  // sección declara; es prosa deliberada y no se toca.
  const historicalParagraph = /^(?:El alcance de|La especificación candidata de)\s+\d/;
  // La hoja de caja negra se renombra en cada entrega: toda referencia debe
  // acompañar el renombrado, porque solo existe una hoja vigente. Congelarla
  // dejaba la puerta de caja negra inalcanzable desde el gobierno.
  const blackBoxReference = /PRUEBAS_CAJA_NEGRA_\d+\.\d+\.\d+\.md/g;
  const nextBlackBoxReference = `PRUEBAS_CAJA_NEGRA_${nextVersion}.md`;
  const substitute = value => {
    let frozenLevel = null;
    return value
      .split("\n")
      .map(line => {
        const frozen = frozenHeading.exec(line);
        if (frozen) {
          frozenLevel = frozen[1].length;
          return line;
        }
        const heading = anyHeading.exec(line);
        if (heading) {
          if (frozenLevel !== null) {
            if (heading[1].length > frozenLevel) return line;
            frozenLevel = null;
          }
          return line
            .replace(versionPattern, nextVersion)
            .replace(blackBoxReference, nextBlackBoxReference);
        }
        // La hoja de caja negra se renombra en cada entrega y solo existe una
        // vigente: la referencia la acompaña incluso dentro de un alcance
        // congelado, porque un enlace congelado apuntaría a una hoja retirada y
        // la puerta quedaría inalcanzable. El literal de versión, en cambio, sí
        // permanece congelado: narra el hecho con la entrega que lo entregó.
        if (frozenLevel !== null || historicalParagraph.test(line)) {
          return line.replace(blackBoxReference, nextBlackBoxReference);
        }
        return line
          .replace(versionPattern, nextVersion)
          .replace(blackBoxReference, nextBlackBoxReference);
      })
      .join("\n");
  };
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

// La hoja de caja negra es única: no solo los documentos sincronizados la
// enlazan. Cualquier documento de `docs/` que la cite debe apuntar a la
// vigente, porque conservar el nombre retirado deja la puerta inalcanzable
// —defecto que delata `pnpm docs:verify`—.
const staleBlackBox = /PRUEBAS_CAJA_NEGRA_\d+\.\d+\.\d+\.md/g;
const staleBlackBoxCheck = /PRUEBAS_CAJA_NEGRA_\d+\.\d+\.\d+\.md/;
const collectDocuments = directory =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) return [];
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectDocuments(full);
    return /\.md$/.test(entry.name) ? [full] : [];
  });
let repointedDocuments = 0;
for (const document of [
  ...collectDocuments(path.join(repositoryRoot, "docs")),
  path.join(repositoryRoot, "README.md"),
]) {
  const content = fs.readFileSync(document, "utf8");
  if (!staleBlackBoxCheck.test(content)) continue;
  const next = content.replace(
    staleBlackBox,
    `PRUEBAS_CAJA_NEGRA_${nextVersion}.md`
  );
  if (next !== content) {
    fs.writeFileSync(document, next);
    repointedDocuments += 1;
  }
}

console.log(
  `JARVI RH actualizado: ${currentVersion} -> ${nextVersion}` +
    (repointedDocuments
      ? ` (${repointedDocuments} documento(s) reorientados a la hoja vigente)`
      : "")
);
