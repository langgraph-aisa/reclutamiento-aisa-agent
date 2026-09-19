// Puerta de integridad documental del relato de release.
//
// Dos defectos se colaron en producción sin que ninguna puerta los viera:
//
// 1. `scripts/bump-release.mjs` congelaba el encabezado de cada alcance
//    histórico, pero no su cuerpo, de modo que cada incremento reescribía el
//    literal de versión dentro de la narración de releases ya entregados. La
//    corrupción es acumulativa y silenciosa: la entrega 2.0.166 acabó citando
//    2.0.189, y la 2.0.188 acabó citándose a sí misma como causa anterior.
// 2. La hoja de especificación del release se renombra en cada entrega y sus
//    referencias quedaron apuntando a documentos que ya no existen, de modo
//    que la puerta de caja negra vigente no era alcanzable desde el gobierno.
//
// La regla que delata el primer defecto no necesita memoria de nadie: dentro
// del alcance de la versión X, ninguna referencia puede citar una versión
// posterior a X, porque en el instante de esa entrega no existía.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

const narrativeDocuments = [
  "README.md",
  "docs/RELEASE_GOVERNANCE.md",
  "docs/VALIDACION_FINAL.md",
];

const scopeHeading = /^(#{1,6})\s*Alcance(?:\s+candidato)?(?:\s+de)?\s+(\d+\.\d+\.\d+)/;
const nestedScope = /^(?:El alcance de|La especificación candidata de)\s+(\d+\.\d+\.\d+)/;
const anyHeading = /^(#{1,6})\s/;
const versionToken = /\b(2\.\d+\.\d+)\b/g;
const blackBoxLink = /PRUEBAS_CAJA_NEGRA_(\d+\.\d+\.\d+)\.md/g;

// Una anotación posterior puede nombrar la entrega que resolvió el límite que
// el alcance declara. Es prosa legítima: la sección 2.0.166 declara su límite y
// nombra 2.0.167, la entrega que cerró parte de él.
const forwardDeclaration = /se entregó en|se completó en|se resolvió en|queda entregado en|se entregará en/;

// El defecto que esta puerta persigue escribe siempre el literal de la versión
// que se está publicando: por eso una anotación hacia adelante solo se admite
// si nombra un release anterior al vigente, y el fingerprint de la corrupción
// —citar la versión que se publica ahora— siempre queda delatado.
const publishedVersion = JSON.parse(
  fs.readFileSync(path.join(repositoryRoot, "package.json"), "utf8")
).version;

function compareVersions(left, right) {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

function readLines(relativePath) {
  const absolutePath = path.join(repositoryRoot, relativePath);
  if (!fs.existsSync(absolutePath)) return null;
  return fs.readFileSync(absolutePath, "utf8").split("\n");
}

function markdownDocuments(directory = "docs") {
  const found = [];
  const walk = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absoluteEntry = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") continue;
        walk(absoluteEntry);
        continue;
      }
      if (entry.name.endsWith(".md")) {
        found.push(path.relative(repositoryRoot, absoluteEntry));
      }
    }
  };
  walk(path.join(repositoryRoot, directory));
  return found;
}

// Una cita imposible es una versión posterior al alcance que la contiene.
function auditImpossibleCitations(collect) {
  for (const relativePath of narrativeDocuments) {
    const lines = readLines(relativePath);
    if (!lines) continue;
    let ceiling = null;
    let scopeLevel = null;
    lines.forEach((line, index) => {
      const declared = scopeHeading.exec(line);
      if (declared) {
        ceiling = declared[2];
        scopeLevel = declared[1].length;
        return;
      }
      const heading = anyHeading.exec(line);
      if (heading) {
        if (scopeLevel !== null && heading[1].length <= scopeLevel) {
          ceiling = null;
          scopeLevel = null;
        }
        return;
      }
      if (ceiling === null) return;
      // La narración anidada se declara a sí misma su propio techo: un párrafo
      // que empieza «El alcance de 2.0.158» cita legítimamente 2.0.158 aunque
      // viva dentro de otra sección.
      const nested = nestedScope.exec(line);
      if (nested) ceiling = nested[1];
      const annotation = forwardDeclaration.test(line);
      for (const found of line.matchAll(versionToken)) {
        if (compareVersions(found[1], ceiling) <= 0) continue;
        const isAnnotation =
          annotation && compareVersions(found[1], publishedVersion) < 0;
        if (isAnnotation) continue;
        collect({
          document: relativePath,
          line: index + 1,
          rule: "cita-imposible",
          detail: `el alcance ${ceiling} cita ${found[1]}`,
        });
      }
    });
  }
}

// La hoja de especificación se renombra en cada entrega: toda referencia debe
// resolver al documento vigente, porque solo existe una hoja de caja negra.
function auditBlackBoxLinks(collect) {
  for (const relativePath of ["README.md", ...markdownDocuments()]) {
    const lines = readLines(relativePath);
    if (!lines) continue;
    lines.forEach((line, index) => {
      for (const found of line.matchAll(blackBoxLink)) {
        const referenced = `docs/PRUEBAS_CAJA_NEGRA_${found[1]}.md`;
        if (!fs.existsSync(path.join(repositoryRoot, referenced))) {
          collect({
            document: relativePath,
            line: index + 1,
            rule: "enlace-roto",
            detail: `${referenced} no existe`,
          });
        }
      }
    });
  }
}

export function auditDocumentaryIntegrity() {
  const seen = new Set();
  const findings = [];
  const collect = finding => {
    // Una misma línea puede citar el documento dos veces —texto y destino del
    // enlace—, y eso es un solo hallazgo.
    const key = `${finding.document}:${finding.line}:${finding.rule}:${finding.detail}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push(finding);
  };
  auditImpossibleCitations(collect);
  auditBlackBoxLinks(collect);
  return findings;
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const findings = auditDocumentaryIntegrity();
  if (findings.length === 0) {
    console.log("Integridad documental: sin hallazgos.");
  } else {
    for (const finding of findings) {
      console.log(
        `${finding.document}:${finding.line} [${finding.rule}] ${finding.detail}`
      );
    }
    process.exitCode = 1;
  }
}
