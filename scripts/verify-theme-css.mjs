import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const assetsDirectory = path.join(repositoryRoot, "dist/public/assets");
const cssFiles = fs
  .readdirSync(assetsDirectory)
  .filter(file => file.endsWith(".css"));
const compiledCss = cssFiles
  .map(file => fs.readFileSync(path.join(assetsDirectory, file), "utf8"))
  .join("\n");

for (const token of [
  "background",
  "card",
  "popover",
  "foreground",
  "sidebar",
]) {
  const property = token === "foreground" ? "color" : "background-color";
  const selector = token === "foreground" ? "text" : "bg";
  const expected = `.${selector}-${token}{${property}:var(--color-${token})}`;
  if (!compiledCss.includes(expected)) {
    throw new Error(
      `[theme] La utilidad ${selector}-${token} quedó fijada al tema claro.`
    );
  }
}

if (
  !compiledCss.includes(".dark{") ||
  !compiledCss.includes("--color-background:#0b1118") ||
  !compiledCss.includes(".high-contrast{")
) {
  throw new Error("[theme] Faltan los temas alternativos en el CSS compilado.");
}

console.log(
  `CSS temático verificado: ${cssFiles.length} artefacto(s), tokens dinámicos activos.`
);
