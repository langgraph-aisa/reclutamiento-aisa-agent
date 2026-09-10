import { ThemeToggle } from "../client/src/components/ThemeToggle";
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
import {
  oppositeTheme,
  resolveStoredTheme,
  THEME_STORAGE_KEY,
} from "../shared/theme";

describe("black-box release contract", () => {
  it("exposes the approved product release and audited runtime", () => {
    expect(APP_VERSION).toBe("2.0.112");
    expect(RELEASE_LABEL).toBe("JARVI RH 2.0.112");
    expect(AUDITED_RUNTIME).toEqual({
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
    expect(nextReleaseVersion("2.0.112")).toBe("2.0.113");
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

  it("publishes the academic-commercial README with auditable proportions and references", () => {
    const readme = fs.readFileSync(path.resolve("README.md"), "utf8");
    const academicBody = readme.slice(0, readme.indexOf("## Referencias"));
    const wordCount = academicBody.trim().split(/\s+/).length;
    const positioning = readme.match(
      /\*\*Posicionamiento(?: —|,) 35 palabras\.\*\* ([^\n]+)/
    )?.[1];
    const bibliography = readme
      .slice(readme.indexOf("## Referencias"), readme.indexOf("## Licencia"))
      .match(/^\d+\./gm);

    expect(readme).toContain("Talento AISA · JARVI RH 2.0.112");
    expect(readme).toContain(
      'src="client/public/brand/talento-aisa-personaje.png" width="240"'
    );
    expect(wordCount).toBeGreaterThanOrEqual(2_400);
    expect(wordCount).toBeLessThanOrEqual(2_700);
    expect(positioning?.split(/\s+/)).toHaveLength(35);
    expect(bibliography).toHaveLength(36);
    expect(readme).toContain("API, infraestructura y modelos (19 de 36");
    expect(readme).toContain("no constituye certificación");
    expect(readme).toContain("Ontología, epistemología y fenomenología");
  });
});
