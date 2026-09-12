import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const projectRoot = process.cwd();
const scanTargets = [
  "client/src/pages",
  "client/src/components",
  "server",
  "shared",
  "drizzle/schema.ts",
];
const supportedExtensions = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".json",
  ".py",
]);
const excludedPathParts = [
  "/components/ui/",
  ".test.",
  ".spec.",
  "/dist/",
  "/node_modules/",
];

const informalPatterns = [
  {
    name: "pronombre, posesivo o verbo de tratamiento informal",
    regex:
      /\b(?:tú|tu|tus|te|ti|contigo|tuyo|tuya|tuyos|tuyas|puedes|podrás|tienes|cumples|resides|necesitas|recibirás|solicitaste|desactivarte|quieres|sabes|debes|eres|estás|harás|puedas|deseas|prefieres|avanzas|aplicas|ingresas|completas|seleccionas|envías|activas|recibes)\b/iu,
  },
  {
    name: "pregunta con tratamiento informal",
    regex: /¿\s*Cuentas\b/iu,
  },
  {
    name: "instrucción con imperativo informal",
    regex:
      /(?:^|[.!?:]\s+|[-•]\s+)(?:Configura|Revisa|Crea|Agrega|Activa|Ordena|Define|Pega|Carga|Usa|Úsalo|Úsala|Utiliza|Consulta|Filtra|Publica|Administra|Convierte|Conoce|Construye|Crece|Ingresa|Escribe|Selecciona|Completa|Indica|Conserva|Marca|Intenta|Vuelve|Verifica|Responde|Describe|Evalúa|Respeta|Entrega|Devuelve|Ignora|Confirma|Explica|Considera|Separa|Cuéntanos|Cuéntanoslo|Haz|Elige|Añade|Sube|Descarga|Abre|Cierra|Edita|Guarda|Elimina)\b/iu,
  },
];

function collectFiles(target) {
  const absoluteTarget = path.join(projectRoot, target);
  if (!fs.existsSync(absoluteTarget)) return [];
  const stats = fs.statSync(absoluteTarget);
  if (stats.isFile()) return [absoluteTarget];

  return fs
    .readdirSync(absoluteTarget, { withFileTypes: true })
    .flatMap(entry => {
      const entryPath = path.join(absoluteTarget, entry.name);
      return entry.isDirectory()
        ? collectFiles(path.relative(projectRoot, entryPath))
        : [entryPath];
    });
}

function shouldScan(filePath) {
  const normalized = filePath.replaceAll(path.sep, "/");
  return (
    supportedExtensions.has(path.extname(filePath)) &&
    !excludedPathParts.some(part => normalized.includes(part))
  );
}

function checkText(filePath, text, line, findings) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return;

  for (const pattern of informalPatterns) {
    const match = normalized.match(pattern.regex);
    if (!match) continue;
    const contextStart = Math.max(0, match.index - 36);
    const contextEnd = Math.min(
      normalized.length,
      match.index + match[0].length + 72
    );
    findings.push({
      file: path.relative(projectRoot, filePath),
      line,
      rule: pattern.name,
      context: normalized.slice(contextStart, contextEnd),
    });
  }
}

function scanTypeScript(filePath, findings) {
  const sourceText = fs.readFileSync(filePath, "utf8");
  const scriptKind = filePath.endsWith("x")
    ? ts.ScriptKind.TSX
    : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    scriptKind
  );

  function visit(node) {
    const isTextNode =
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node);

    if (isTextNode) {
      const position = sourceFile.getLineAndCharacterOfPosition(
        node.getStart(sourceFile)
      );
      checkText(
        filePath,
        node.text ?? node.getText(sourceFile),
        position.line + 1,
        findings
      );
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
}

function scanPlainText(filePath, findings) {
  fs.readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .forEach((lineText, index) =>
      checkText(filePath, lineText, index + 1, findings)
    );
}

export function auditFormalSpanish() {
  const files = scanTargets.flatMap(collectFiles).filter(shouldScan).sort();
  const findings = [];

  for (const filePath of files) {
    if ([".ts", ".tsx", ".js", ".jsx"].includes(path.extname(filePath))) {
      scanTypeScript(filePath, findings);
    } else {
      scanPlainText(filePath, findings);
    }
  }

  return { files, findings };
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const { files, findings } = auditFormalSpanish();
  if (findings.length > 0) {
    console.error("Se detectó tratamiento informal en textos de ejecución:\n");
    for (const finding of findings) {
      console.error(
        `${finding.file}:${finding.line} [${finding.rule}] ${finding.context}`
      );
    }
    process.exitCode = 1;
  } else {
    console.log(
      `Tratamiento formal verificado en ${files.length} archivos de ejecución.`
    );
  }
}
