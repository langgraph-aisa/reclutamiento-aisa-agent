import { ThemeToggle } from "../client/src/components/ThemeToggle";
import { VerticalNavigator } from "../client/src/components/VerticalNavigator";
import { ThemeProvider } from "../client/src/contexts/ThemeContext";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  APP_VERSION,
  AUDITED_RUNTIME,
  QUALITY_REFERENCES,
  RELEASE_LABEL,
  nextReleaseVersion,
} from "../shared/release";
import { adjacentReviewResultIndex } from "../shared/reviewNavigation";
import { APPLICATION_STATUS_OPTIONS } from "../shared/applicationStatus";
import {
  nextAppTheme,
  resolveStoredTheme,
  THEME_STORAGE_KEY,
} from "../shared/theme";

function relativeLuminance(hex: string) {
  const channels = hex
    .replace("#", "")
    .match(/.{2}/g)!
    .map(channel => Number.parseInt(channel, 16) / 255)
    .map(channel =>
      channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    );
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(foreground: string, background: string) {
  const lighter = Math.max(
    relativeLuminance(foreground),
    relativeLuminance(background)
  );
  const darker = Math.min(
    relativeLuminance(foreground),
    relativeLuminance(background)
  );
  return (lighter + 0.05) / (darker + 0.05);
}

describe("black-box release contract", () => {
  it("exposes the approved product release and audited runtime", () => {
    expect(APP_VERSION).toBe("2.0.116");
    expect(RELEASE_LABEL).toBe("JARVI RH 2.0.116");
    expect(AUDITED_RUNTIME).toEqual({
      langfuse: "3.38.20",
      langGraph: "1.4.14",
      langChainOpenAI: "1.5.11",
      openAiSdk: "7.13.0",
      responsesApi: "v1/responses",
    });
    expect(QUALITY_REFERENCES).toEqual([
      "ISO/IEC 25010:2023",
      "ISO/IEC 27001:2022",
      "ISO/IEC/IEEE 29119-1:2022",
    ]);
  });

  it("increments every release and rolls patch 999 into the next minor", () => {
    const [, major, minor, patch] = /^(\d+)\.(\d+)\.(\d+)$/.exec(APP_VERSION)!;
    expect(nextReleaseVersion(APP_VERSION)).toBe(
      Number(patch) >= 999
        ? `${major}.${Number(minor) + 1}.0`
        : `${major}.${minor}.${Number(patch) + 1}`
    );
    expect(nextReleaseVersion("2.0.999")).toBe("2.1.0");
    expect(() => nextReleaseVersion("2.0")).toThrow(/inválida/);
  });

  it("persists only supported visual themes and cycles deterministically", () => {
    expect(THEME_STORAGE_KEY).toBe("jarvi-rh-theme");
    expect(resolveStoredTheme("dark")).toBe("dark");
    expect(resolveStoredTheme("high-contrast")).toBe("high-contrast");
    expect(resolveStoredTheme("invalid")).toBe("light");
    expect(nextAppTheme("light")).toBe("dark");
    expect(nextAppTheme("dark")).toBe("high-contrast");
    expect(nextAppTheme("high-contrast")).toBe("light");
  });

  it("exposes an accessible control for all three visual themes", () => {
    const renderTheme = (theme: "light" | "dark" | "high-contrast") =>
      renderToStaticMarkup(
        createElement(
          ThemeProvider,
          { defaultTheme: theme },
          createElement(ThemeToggle)
        )
      );

    expect(renderTheme("light")).toContain(
      "Tema actual: Día. Cambiar a Oscuro atenuado"
    );
    expect(renderTheme("dark")).toContain(
      "Tema actual: Oscuro atenuado. Cambiar a Oscuro de alto contraste"
    );
    expect(renderTheme("high-contrast")).toContain(
      "Tema actual: Oscuro de alto contraste. Cambiar a Día"
    );
  });

  it("exposes accessible dynamic navigation for evaluation and results", () => {
    const markup = renderToStaticMarkup(
      createElement(VerticalNavigator, {
        label: "Navegación vertical de resultados",
        previousLabel: "Seleccionar candidato anterior",
        nextLabel: "Seleccionar candidato siguiente",
        onPrevious: () => undefined,
        onNext: () => undefined,
        disablePrevious: true,
        status: "Resultado 1 de 5",
      })
    );

    expect(markup).toContain('role="group"');
    expect(markup).toContain("Seleccionar candidato anterior");
    expect(markup).toContain("Seleccionar candidato siguiente");
    expect(markup).toContain("Resultado 1 de 5");
    expect(markup).toContain("disabled");
    expect(adjacentReviewResultIndex(0, 5, 1)).toBe(1);
    expect(adjacentReviewResultIndex(4, 5, 1)).toBe(4);
    expect(adjacentReviewResultIndex(2, 5, -1)).toBe(1);
    expect(adjacentReviewResultIndex(-1, 5, 1)).toBe(0);
    expect(adjacentReviewResultIndex(0, 0, 1)).toBe(-1);
  });

  it("integrates the compact matrix, Dark AISA tokens, and transparent brand", () => {
    const review = fs.readFileSync(
      path.resolve("client/src/pages/HumanReview.tsx"),
      "utf8"
    );
    const theme = fs.readFileSync(path.resolve("client/src/index.css"), "utf8");
    const layout = fs.readFileSync(
      path.resolve("client/src/components/DashboardLayout.tsx"),
      "utf8"
    );
    const logo = fs.readFileSync(
      path.resolve("client/public/brand/aisa-logo.png")
    );
    const visualSources = ["client/src/pages", "client/src/components"]
      .flatMap(directory =>
        fs
          .readdirSync(path.resolve(directory))
          .filter(file => file.endsWith(".tsx"))
          .map(file => fs.readFileSync(path.resolve(directory, file), "utf8"))
      )
      .join("\n");
    const packageMetadata = JSON.parse(
      fs.readFileSync(path.resolve("package.json"), "utf8")
    );
    const compiledThemeVerifier = fs.readFileSync(
      path.resolve("scripts/verify-theme-css.mjs"),
      "utf8"
    );

    expect(review).not.toContain("Matriz humana dinámica");
    expect(review).toContain("Navegación de bloques de evaluación");
    expect(review).toContain("Navegación vertical de resultados");
    expect(review).toContain("data-review-row");
    expect(theme).toContain("--color-background: #0b1118");
    expect(theme).toContain("--color-card: #111a24");
    expect(theme).toContain("--color-border: #2a3949");
    expect(theme).toContain("--color-input: #7f8c9a");
    expect(theme).toContain("--color-ring: #35d6b1");
    expect(theme).toContain(".high-contrast {");
    expect(theme).toContain("@theme {");
    expect(theme).not.toContain("@theme inline");
    expect(visualSources).not.toMatch(/dark:(?:bg|text|border)-neutral/);
    expect(visualSources).not.toContain("dark:bg-[#0B2945]");
    expect(packageMetadata.scripts.build).toContain("verify-theme-css.mjs");
    expect(compiledThemeVerifier).toContain("var(--color-${token})");
    expect(contrastRatio("#E6EDF3", "#0B1118")).toBeCloseTo(16.05, 2);
    expect(contrastRatio("#AAB7C5", "#0B1118")).toBeCloseTo(9.29, 2);
    expect(contrastRatio("#35D6B1", "#0B1118")).toBeCloseTo(10.3, 2);
    expect(contrastRatio("#7F8C9A", "#111A24")).toBeGreaterThanOrEqual(3);
    expect(
      APPLICATION_STATUS_OPTIONS.every(option => option.label.trim())
    ).toBe(true);
    expect(layout).toContain(
      'AppBrand className="h-8 max-w-full dark:brightness-0 dark:invert"'
    );
    expect(layout).not.toContain("bg-white/90 px-1.5 py-1");
    expect(logo.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(logo[25]).toBe(6);
  });

  it("connects public identity, geographic catalog, persistence, and agent context", () => {
    const login = fs.readFileSync(
      path.resolve("client/src/pages/Login.tsx"),
      "utf8"
    );
    const home = fs.readFileSync(
      path.resolve("client/src/pages/Home.tsx"),
      "utf8"
    );
    const apply = fs.readFileSync(
      path.resolve("client/src/pages/Apply.tsx"),
      "utf8"
    );
    const phoneInput = fs.readFileSync(
      path.resolve("client/src/components/GuatemalaPhoneInput.tsx"),
      "utf8"
    );
    const migration = fs.readFileSync(
      path.resolve("drizzle/migrations/0011_application_location.sql"),
      "utf8"
    );
    const agent = fs.readFileSync(
      path.resolve("server/agentEvaluator.ts"),
      "utf8"
    );
    const theme = fs.readFileSync(path.resolve("client/src/index.css"), "utf8");
    const bootstrap = fs.readFileSync(
      path.resolve("client/index.html"),
      "utf8"
    );

    expect(login).toContain('useState("")');
    expect(login).toContain('autoComplete="off"');
    for (const publicSurface of [login, home, apply]) {
      expect(publicSurface).toContain("<ThemeToggle");
    }
    expect(home).not.toContain("Inicia el formulario en esta misma pestaña.");
    expect(phoneInput).toContain("🇬🇹");
    expect(phoneInput).toContain('autoComplete="off"');
    expect(phoneInput).not.toContain("+502 5555 5555");
    expect(apply).toContain('label="Zona"');
    expect(apply).toContain('label="Departamento"');
    expect(apply).toContain('label="Municipio"');
    expect(migration).toContain("generate_series(1,25)");
    expect(migration).toContain('"location_zone_id"');
    expect(agent).toContain("ubicacionDeclarada");
    expect(theme).toContain("Dark AISA assigns functional roles");
    expect(theme).toContain(".bg-amber-50");
    expect(theme).toContain(".bg-violet-100");
    expect(bootstrap).toContain(
      'theme === "dark" || theme === "high-contrast"'
    );
  });

  it("publishes the academic-commercial README with auditable proportions and references", () => {
    const readme = fs.readFileSync(path.resolve("README.md"), "utf8");
    const academicBody = readme.slice(0, readme.indexOf("## Referencias"));
    const wordCount = academicBody.trim().split(/\s+/).length;
    const bibliography = readme
      .slice(readme.indexOf("## Referencias"), readme.indexOf("## Licencia"))
      .match(/^\d+\./gm);

    expect(readme).toContain("Talento AISA · JARVI RH 2.0.116");
    expect(readme).toContain(
      'src="client/public/brand/talento-aisa-personaje.png" width="240"'
    );
    expect(wordCount).toBeGreaterThanOrEqual(2_400);
    expect(wordCount).toBeLessThanOrEqual(2_800);
    expect(bibliography).toHaveLength(39);
    expect(readme).toContain("### API, infraestructura y modelos");
    expect(readme).toContain("<!-- release-history:start -->");
    expect(readme).toContain("### 10SEP2026 · JARVI RH 2.0.116");
    expect(readme).toContain("tokens compilados como variables dinámicas");
    expect(readme).toContain("### 10SEP2026 · JARVI RH 2.0.115");
    expect(readme).toContain("sistema de visualización alternativa");
    expect(readme).toContain("Dark Dimmed");
    expect(readme).toContain("Dark High Contrast");
    expect(readme).toContain("no garantiza una reducción clínica");
    expect(readme).toContain("### 10SEP2026 · JARVI RH 2.0.113");
    expect(readme).toContain(
      "Zona 1–25, departamento y municipio obligatorios"
    );
    expect(readme).toContain("Revisión Humana 360° compactada");
    expect(readme).toContain("Langfuse-3.38.20");
    expect(readme).toContain("LangGraph-1.4.14");
    expect(readme).toContain("no constituye certificación");
    expect(readme).toContain("Ontología, epistemología y fenomenología");
  });
});
