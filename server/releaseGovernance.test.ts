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
import {
  oppositeTheme,
  resolveStoredTheme,
  THEME_STORAGE_KEY,
} from "../shared/theme";

describe("black-box release contract", () => {
  it("exposes the approved product release and audited runtime", () => {
    expect(APP_VERSION).toBe("2.0.113");
    expect(RELEASE_LABEL).toBe("JARVI RH 2.0.113");
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

  it("persists only supported visual themes and toggles deterministically", () => {
    expect(THEME_STORAGE_KEY).toBe("jarvi-rh-theme");
    expect(resolveStoredTheme("dark")).toBe("dark");
    expect(resolveStoredTheme("invalid")).toBe("light");
    expect(oppositeTheme("light")).toBe("dark");
    expect(oppositeTheme("dark")).toBe("light");
  });

  it("exposes an accessible theme switch for both visual modes", () => {
    const renderTheme = (theme: "light" | "dark") =>
      renderToStaticMarkup(
        createElement(
          ThemeProvider,
          { defaultTheme: theme },
          createElement(ThemeToggle)
        )
      );

    expect(renderTheme("light")).toContain('role="switch"');
    expect(renderTheme("light")).toContain("Cambiar a modo oscuro");
    expect(renderTheme("dark")).toContain('aria-checked="true"');
    expect(renderTheme("dark")).toContain("Cambiar a modo claro");
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

  it("integrates the compact matrix, grayscale theme, and transparent brand", () => {
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

    expect(review).not.toContain("Matriz humana dinámica");
    expect(review).toContain("Navegación de bloques de evaluación");
    expect(review).toContain("Navegación vertical de resultados");
    expect(review).toContain("data-review-row");
    expect(theme).toContain("--color-background: oklch(0.145 0 0)");
    expect(theme).toContain("--color-sidebar: oklch(0.17 0 0)");
    expect(layout).toContain(
      'AppBrand className="h-8 max-w-full dark:brightness-0 dark:invert"'
    );
    expect(layout).not.toContain("bg-white/90 px-1.5 py-1");
    expect(logo.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(logo[25]).toBe(6);
  });

  it("publishes the academic-commercial README with auditable proportions and references", () => {
    const readme = fs.readFileSync(path.resolve("README.md"), "utf8");
    const academicBody = readme.slice(0, readme.indexOf("## Referencias"));
    const wordCount = academicBody.trim().split(/\s+/).length;
    const bibliography = readme
      .slice(readme.indexOf("## Referencias"), readme.indexOf("## Licencia"))
      .match(/^\d+\./gm);

    expect(readme).toContain("Talento AISA · JARVI RH 2.0.113");
    expect(readme).toContain(
      'src="client/public/brand/talento-aisa-personaje.png" width="240"'
    );
    expect(wordCount).toBeGreaterThanOrEqual(2_400);
    expect(wordCount).toBeLessThanOrEqual(2_800);
    expect(bibliography).toHaveLength(36);
    expect(readme).toContain("### API, infraestructura y modelos");
    expect(readme).toContain("<!-- release-history:start -->");
    expect(readme).toContain("### 10SEP2026 · JARVI RH 2.0.113");
    expect(readme).toContain("Revisión Humana 360° compactada");
    expect(readme).toContain("Langfuse-3.38.20");
    expect(readme).toContain("LangGraph-1.4.14");
    expect(readme).toContain("no constituye certificación");
    expect(readme).toContain("Ontología, epistemología y fenomenología");
  });
});
