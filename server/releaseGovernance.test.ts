import { ThemeToggle } from "../client/src/components/ThemeToggle";
import { VerticalNavigator } from "../client/src/components/VerticalNavigator";
import { ThemeProvider } from "../client/src/contexts/ThemeContext";
import { auditFormalSpanish } from "../scripts/verify-formal-spanish.mjs";
import { auditPublicCopyControls } from "../scripts/verify-public-copy.mjs";
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
  APPLICATION_CONSENTS,
  APPLICATION_CONSENT_VERSION,
  PRIVACY_TERMS_LINK_TEXT,
  PRIVACY_TERMS_PATH,
} from "../shared/applicationConsent";
import {
  adjacentReviewBlockPage,
  adjacentReviewResultIndex,
  reviewBlockPageRange,
} from "../shared/reviewNavigation";
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
    expect(APP_VERSION).toBe("2.0.130");
    expect(RELEASE_LABEL).toBe("JARVI RH 2.0.130");
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
    expect(reviewBlockPageRange(0, 6, 3)).toEqual({
      pageIndex: 0,
      pageCount: 2,
      start: 0,
      end: 3,
    });
    expect(reviewBlockPageRange(5, 6, 1)).toEqual({
      pageIndex: 5,
      pageCount: 6,
      start: 5,
      end: 6,
    });
    expect(adjacentReviewBlockPage(0, 6, 3, 1)).toBe(1);
    expect(adjacentReviewBlockPage(1, 6, 3, 1)).toBe(1);
    expect(adjacentReviewBlockPage(1, 6, 3, -1)).toBe(0);
    expect(reviewBlockPageRange(Number.NaN, Number.NaN, 0)).toEqual({
      pageIndex: 0,
      pageCount: 1,
      start: 0,
      end: 0,
    });
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
    expect(review).toContain("Vista 360° del Candidato");
    expect(review).not.toContain("Visor 360°");
    expect(review).toContain("blocks.slice(blockRange.start, blockRange.end)");
    expect(review).toContain("element.clientWidth >= 760 ? 3 : 1");
    expect(review).toContain('label="Candidato / plaza"');
    expect(review).toContain("aria-pressed={isSelected}");
    expect(review).toContain("bg-[#eaf2f7]");
    expect(review).toContain("dark:bg-[#162333]");
    expect(review.match(/orientation="horizontal"/g)).toHaveLength(2);
    expect(review).toContain("absolute right-3 top-3");
    expect(review).toContain("data-review-row");
    expect(theme).toContain("--color-background: #0b1118");
    expect(theme).toContain("--color-heading: #ffffff");
    expect(theme).toContain("--color-card: #111a24");
    expect(theme).toContain("--color-border: #2a3949");
    expect(theme).toContain("--color-input: #7f8c9a");
    expect(theme).toContain("--color-ring: #35d6b1");
    expect(theme).toContain(".high-contrast {");
    expect(theme).toContain(".dark :where(h1)");
    expect(theme).not.toMatch(/\.human-review-viewer\s*\{\s*height:/);
    expect((visualSources.match(/<h1\b/g) ?? []).length).toBeGreaterThan(0);
    expect(theme).toContain("@theme {");
    expect(theme).not.toContain("@theme inline");
    expect(visualSources).not.toMatch(/dark:(?:bg|text|border)-neutral/);
    expect(visualSources).not.toContain("dark:bg-[#0B2945]");
    expect(packageMetadata.scripts.build).toContain("verify-theme-css.mjs");
    expect(compiledThemeVerifier).toContain("var(--color-${token})");
    expect(contrastRatio("#E6EDF3", "#0B1118")).toBeCloseTo(16.05, 2);
    expect(contrastRatio("#AAB7C5", "#0B1118")).toBeCloseTo(9.29, 2);
    expect(contrastRatio("#35D6B1", "#0B1118")).toBeCloseTo(10.3, 2);
    expect(contrastRatio("#FFFFFF", "#162333")).toBeCloseTo(15.88, 2);
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
    const jobs = fs.readFileSync(
      path.resolve("client/src/pages/Jobs.tsx"),
      "utf8"
    );
    const profiles = fs.readFileSync(
      path.resolve("client/src/pages/Profiles.tsx"),
      "utf8"
    );
    const consent = fs.readFileSync(
      path.resolve("shared/applicationConsent.ts"),
      "utf8"
    );
    const privacyTerms = fs.readFileSync(
      path.resolve("client/src/pages/PrivacyTerms.tsx"),
      "utf8"
    );
    const app = fs.readFileSync(path.resolve("client/src/App.tsx"), "utf8");
    const routers = fs.readFileSync(path.resolve("server/routers.ts"), "utf8");
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
    const profileEditorial = fs.readFileSync(
      path.resolve("server/profileEditorial.ts"),
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
    expect(home).toContain("OPORTUNIDADES DISPONIBLES");
    expect(home).toContain("Objetivo del puesto");
    expect(home).toContain("Requisitos del puesto");
    expect(home).toContain("selectedJob.profileObjective");
    expect(home).toContain("selectedJob.requiredRequirements.map");
    expect(home).toContain("Acceso Administrativo");
    expect(home).toContain("Conocer nuestros productos");
    expect(home).toContain(
      "https://www.aisa.com.gt/productos-solares-en-guatemala/"
    );
    expect(home).toContain("Contactar a AISA");
    expect(home).toContain("https://www.aisa.com.gt/contactoaisa/");
    expect(home).toContain("Privacidad, Términos y Condiciones");
    expect(home).not.toContain(
      "Privacidad, Términos y Condiciones de Uso de Plataforma"
    );
    expect(home).toContain("Cada candidato merece una evaluación");
    expect(home).not.toContain("Cada plaza merece una evaluación");
    expect(home).toContain("Plataforma Laboral No.1");
    expect(home).not.toContain("Plataforma Laboral No.1 de Guatemala");
    expect(home).not.toContain(
      "Talento AISA, plataforma tecnológica de oportunidades"
    );
    expect(home).not.toContain("Reglas configurables por plaza");
    expect(home).toContain("lg:w-[24rem]");
    expect(home).not.toContain("Entrar al panel");
    expect(apply).toContain("RESPONSABILIDADES DEL PUESTO");
    expect(apply).toContain("form.responsibilities.map");
    expect(apply).not.toContain("Antes de comenzar");
    expect(routers).toContain("profile.objective AS profile_objective");
    expect(routers).toContain("profile.required_requirements");
    expect(routers).toContain("profile.responsibilities");
    expect(routers).toContain("jsonb_array_length");
    expect(routers).toContain(
      'featuredPublicPositionTitle = "Ejecutivo de Negocios (Ventas)"'
    );
    expect(routers).toContain("INSERT INTO job_profile_positions");
    expect(routers).toContain("array_agg(link.job_position_id");
    expect(profiles).toContain(
      'positionIds: (profile.position_ids ?? []).join(", ")'
    );
    expect(profiles).toContain(
      'requiredRequirements: (profile.required_requirements ?? []).join("\\n")'
    );
    expect(profiles).toContain("splitBullets(form.responsibilities)");
    expect(profiles).toContain("splitBullets(form.requiredRequirements)");
    expect(profiles).toContain(
      'responsibilities: (profile.responsibilities ?? []).join("\\n")'
    );
    expect(profileEditorial).toContain(
      'PROFILE_EDITORIAL_MODEL = "gpt-4.1-mini-2025-04-14"'
    );
    expect(profileEditorial).toContain("client.responses.parse");
    expect(profileEditorial).toContain("zodTextFormat");
    expect(profileEditorial).toContain("store: false");
    expect(profileEditorial).toContain("normalizePublicCopy");
    expect(profileEditorial).toContain("RAE/ASALE");
    expect(profileEditorial).toContain(
      'PUBLIC_COPY_EDITORIAL_POLICY_VERSION = "2026-09-10.3"'
    );
    expect(profileEditorial).toContain("beginsWithSpanishInfinitive");
    expect(profileEditorial).toContain("hasBalancedDelimiters");
    expect(profileEditorial).toContain(
      "Preserve literalmente variables delimitadas por llaves dobles"
    );
    expect(profileEditorial).not.toContain("console.warn(error");
    expect(routers).toContain("public_copy_editorially_normalized");
    expect(routers).toContain("hasCurrentEditorialValidation");
    expect(routers).toContain("PUBLIC_COPY_EDITORIAL_POLICY_VERSION");
    expect(routers).toContain("profilePublicCopyInput");
    expect(routers).toContain("positionPublicCopyInput");
    expect(routers).toContain("formBundlePublicCopyInput");
    expect(routers).toContain("normalizeStoredQuestion");
    expect(routers).toContain("auditPublishedPublicCopy");
    expect(jobs).toContain("Plaza publicada correctamente");
    expect(jobs).toContain("onError: error => toast.error(error.message)");
    expect(routers).toContain(
      "La plaza requiere un perfil activo con objetivo, responsabilidades y requisitos obligatorios antes de publicarse."
    );
    expect(phoneInput).toContain("🇬🇹");
    expect(phoneInput).toContain('autoComplete="off"');
    expect(phoneInput).not.toContain("+502 5555 5555");
    expect(apply).toContain('label="Zona"');
    expect(apply).toContain('label="Departamento"');
    expect(apply).toContain('label="Municipio"');
    expect(apply).toContain("Confirmaciones obligatorias");
    expect(apply).toContain("APPLICATION_CONSENTS.map");
    expect(apply).toContain('aria-required="true"');
    expect(consent).toContain("Confirmo que soy mayor de 18 años.");
    expect(consent).toContain(
      "Declaro que la información proporcionada es verdadera, exacta, completa y actualizada."
    );
    expect(APPLICATION_CONSENT_VERSION).toBe("2026-09-10.2");
    expect(PRIVACY_TERMS_PATH).toBe("/privacidad-terminos");
    expect(PRIVACY_TERMS_LINK_TEXT).toBe(
      '"Privacidad, términos y condiciones de uso"'
    );
    expect(APPLICATION_CONSENTS[2].text).toBe(
      'He leído el Aviso de "Privacidad, términos y condiciones de uso" y autorizo a AISA a tratar mis datos para fines relacionados con este proceso de selección.'
    );
    expect(apply).toContain('target="_blank"');
    expect(apply).toContain('rel="noopener noreferrer"');
    expect(app).toContain('<Route path="/privacidad-terminos">');
    expect(privacyTerms).toContain(
      "PRIVACIDAD, TÉRMINOS Y CONDICIONES DE USO DE LA PLATAFORMA"
    );
    expect(privacyTerms).toContain("useLegalDocumentMetadata");
    expect(privacyTerms).toContain('link[rel="canonical"]');
    expect(privacyTerms).toContain("Alternativas Inteligentes, S.A.");
    expect(privacyTerms).toContain("https://diaco.gob.gt/");
    expect(privacyTerms).not.toMatch(/\[RAZÓN|\[DIRECCIÓN|\[PRIVACIDAD@/);
    expect(routers).toContain("application_consents_confirmed");
    expect(routers).toContain("requiredApplicationConfirmation");
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

  it("enforces formal institutional treatment across runtime surfaces", () => {
    const audit = auditFormalSpanish();
    const publicCopyAudit = auditPublicCopyControls();
    const apply = fs.readFileSync(
      path.resolve("client/src/pages/Apply.tsx"),
      "utf8"
    );
    const loginEmail = fs.readFileSync(
      path.resolve("server/localAuth.ts"),
      "utf8"
    );
    const schema = fs.readFileSync(path.resolve("drizzle/schema.ts"), "utf8");
    const migration = fs.readFileSync(
      path.resolve("drizzle/migrations/0012_dear_lifeguard.sql"),
      "utf8"
    );
    const packageMetadata = JSON.parse(
      fs.readFileSync(path.resolve("package.json"), "utf8")
    );

    expect(audit.files).toHaveLength(89);
    expect(audit.findings).toEqual([]);
    expect(publicCopyAudit.files).toHaveLength(89);
    expect(publicCopyAudit.findings).toEqual([]);
    expect(apply).toContain("Escriba su nombre y teléfono");
    expect(apply).toContain("nos pondremos en contacto con usted");
    expect(loginEmail).toContain("Si usted no solicitó este acceso");
    expect(schema).toContain("Nos pondremos en contacto con usted");
    expect(migration).toContain('ALTER COLUMN "whatsapp_message" SET DEFAULT');
    expect(migration).toContain('UPDATE "application_forms"');
    expect(packageMetadata.scripts.build).toContain(
      "verify-formal-spanish.mjs"
    );
    expect(packageMetadata.scripts.build).toContain("verify-public-copy.mjs");
  });

  it("stores and consumes ApiChat credentials through the encrypted PostgreSQL vault", () => {
    const client = fs.readFileSync(
      path.resolve("client/src/pages/Config.tsx"),
      "utf8"
    );
    const settings = fs.readFileSync(
      path.resolve("server/apiChatSettings.ts"),
      "utf8"
    );
    const transport = fs.readFileSync(
      path.resolve("server/apichat.ts"),
      "utf8"
    );
    const delivery = fs.readFileSync(
      path.resolve("server/cvRequest.ts"),
      "utf8"
    );
    const migration = fs.readFileSync(
      path.resolve("drizzle/migrations/0013_apichat_credential_vault.sql"),
      "utf8"
    );

    expect(client).toContain("apiChatConfiguration");
    expect(client).toContain("El navegador recibe únicamente máscaras");
    expect(settings).toContain("encryptAgentSecret");
    expect(settings).toContain('new URL("/v1/status"');
    expect(settings).toContain("credential_rotated");
    expect(delivery).toContain("getApiChatRuntimeSettings(pool)");
    expect(transport).not.toContain("process.env");
    expect(transport).not.toContain("APICHAT_API_");
    expect(migration).toContain("'client_id', NULL, true");
    expect(migration).toContain("'token', NULL, true");
  });

  it("publishes the academic-commercial README with auditable proportions and references", () => {
    const readme = fs.readFileSync(path.resolve("README.md"), "utf8");
    const academicBody = readme.slice(0, readme.indexOf("## Referencias"));
    const wordCount = academicBody.trim().split(/\s+/).length;
    const bibliography = readme
      .slice(readme.indexOf("## Referencias"), readme.indexOf("## Licencia"))
      .match(/^\d+\./gm);

    expect(readme).toContain("Talento AISA · JARVI RH 2.0.130");
    expect(readme).toContain(
      'src="client/public/brand/talento-aisa-personaje.png" width="240"'
    );
    expect(wordCount).toBeGreaterThanOrEqual(2_400);
    expect(wordCount).toBeLessThanOrEqual(4_000);
    expect(bibliography).toHaveLength(41);
    expect(readme).toContain("### API, infraestructura y modelos");
    expect(readme).toContain("<!-- release-history:start -->");
    expect(readme).toContain("### 11SEP2026 · JARVI RH 2.0.130");
    expect(readme).toContain("### 10SEP2026 · JARVI RH 2.0.129");
    expect(readme).toContain("Vista 360° del Candidato");
    expect(readme).toContain("tres tarjetas en escritorio");
    expect(readme).toContain("una en ancho reducido");
    expect(readme).toContain("muestra únicamente nombre y plaza");
    expect(readme).toContain("### 10SEP2026 · JARVI RH 2.0.124");
    expect(readme).toContain("control editorial transversal");
    expect(readme).toContain("plazas públicas ya existentes");
    expect(readme).toContain("una idea completa por línea");
    expect(readme).toContain("### 10SEP2026 · JARVI RH 2.0.123");
    expect(readme).toContain("GPT-4.1 mini corrige ortografía");
    expect(readme).toContain("sin consumir tokens durante las visitas");
    expect(readme).toContain(
      "Cada candidato merece una evaluación a su medida"
    );
    expect(readme).toContain("Perfiles laborales preserva `position_ids`");
    expect(readme).toContain(
      "Ejecutivo de Negocios (Ventas) conserva la primera posición"
    );
    expect(readme).toContain("### 10SEP2026 · JARVI RH 2.0.121");
    expect(readme).toContain("### 10SEP2026 · JARVI RH 2.0.120");
    expect(readme).toContain("Tratamiento institucional «usted» homologado");
    expect(readme).toContain("Tres confirmaciones obligatorias");
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
