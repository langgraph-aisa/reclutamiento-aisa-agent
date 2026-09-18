import { ThemeToggle } from "../client/src/components/ThemeToggle";
import { VerticalNavigator } from "../client/src/components/VerticalNavigator";
import { ThemeProvider } from "../client/src/contexts/ThemeContext";
import { auditFormalSpanish } from "../scripts/verify-formal-spanish.mjs";
import { auditPublicCopyControls } from "../scripts/verify-public-copy.mjs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  APP_VERSION,
  AUDITED_RUNTIME,
  PRODUCT_NAME,
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
import {
  ASSESSMENT_DELETE_CODE_MAX_ATTEMPTS,
  ASSESSMENT_DELETE_CODE_RESEND_SECONDS,
  ASSESSMENT_DELETE_CODE_TTL_MINUTES,
  ASSESSMENT_DELETE_TITLE_WORD_LIMIT,
  assessmentDeleteAlertTitle,
} from "../shared/assessmentGovernance";
import {
  ACTIVITY_SUMMARY_WORD_LIMIT,
  ACTIVITY_TITLE_WORD_LIMIT,
} from "../shared/agentConfig";
import { countWords } from "../shared/activityAudit";
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

/**
 * Reúne el código del cliente que Vite empaqueta y sirve al navegador.
 * La estrategia de propiedad intelectual exige que el know-how —pesos,
 * bandas, criterios e instrucciones del agente— no forme parte de ese paquete.
 */
function readClientSources(directory = "client/src"): string {
  return fs
    .readdirSync(path.resolve(directory), { withFileTypes: true })
    .map(entry => {
      const relative = path.join(directory, entry.name);
      if (entry.isDirectory()) return readClientSources(relative);
      return /\.tsx?$/.test(entry.name)
        ? fs.readFileSync(path.resolve(relative), "utf8")
        : "";
    })
    .join("\n");
}

describe("black-box release contract", () => {
  it("exposes the approved product release and audited runtime", () => {
    expect(APP_VERSION).toBe("2.0.176");
    expect(RELEASE_LABEL).toBe("JARVI RH 2.0.176");
    expect(AUDITED_RUNTIME).toEqual({
      langfuseTracing: "5.11.1",
      langfuseLangChain: "5.11.1",
      langfuseOpenAI: "5.11.1",
      openTelemetry: "0.222.0",
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

  it("documents the release version beside the signed-in user identity", () => {
    const layout = fs.readFileSync(
      path.resolve("client/src/components/DashboardLayout.tsx"),
      "utf8"
    );
    const release = fs.readFileSync(path.resolve("shared/release.ts"), "utf8");
    const readme = fs.readFileSync(path.resolve("README.md"), "utf8");

    // La versión visible se deriva de package.json: no se escribe a mano.
    expect(release).toContain('import packageMetadata from "../package.json"');
    expect(release).toContain(
      "export const APP_VERSION = packageMetadata.version"
    );
    expect(release).toContain(
      "export const RELEASE_LABEL = `${PRODUCT_NAME} ${APP_VERSION}`"
    );

    // La etiqueta visible, el registro del README, la caja negra y el paquete
    // deben apuntar a la misma versión. Una actualización parcial —subir el
    // paquete sin publicar la documentación, o al revés— se detiene aquí.
    const declared = `${PRODUCT_NAME} ${APP_VERSION}`;
    expect(RELEASE_LABEL).toBe(declared);
    expect(readme).toContain(`Talento AISA · ${declared}`);
    expect(
      fs.existsSync(path.resolve(`docs/PRUEBAS_CAJA_NEGRA_${APP_VERSION}.md`))
    ).toBe(true);
    expect(
      JSON.parse(fs.readFileSync(path.resolve("package.json"), "utf8")).version
    ).toBe(APP_VERSION);

    // El pie del menú presenta la etiqueta inmediatamente bajo la identidad
    // de la sesión, de modo que la versión publicada sea atribuible a quien
    // opera el artefacto.
    const identity = layout.indexOf('{user?.name || "-"}');
    const label = layout.indexOf("{RELEASE_LABEL}");
    expect(identity).toBeGreaterThan(-1);
    expect(label).toBeGreaterThan(identity);
    expect(label - identity).toBeLessThan(400);
    expect(layout.match(/\{RELEASE_LABEL\}/g)).toHaveLength(1);

    // Ninguna superficie administrativa escribe el producto y la versión a
    // mano: un literal desincronizado pasaría inadvertido para esta puerta.
    const hardcoded = ["client/src/pages", "client/src/components"]
      .flatMap(directory =>
        fs
          .readdirSync(path.resolve(directory))
          .filter(file => file.endsWith(".tsx"))
          .map(file => `${directory}/${file}`)
      )
      .filter(relative =>
        fs.readFileSync(path.resolve(relative), "utf8").includes("JARVI RH 2.")
      );
    expect(hardcoded).toEqual([]);

    // El hash corto y la rama del pie también provienen del build, no del
    // código: el artefacto declara qué se compiló y desde dónde.
    const viteConfig = fs.readFileSync(path.resolve("vite.config.ts"), "utf8");
    expect(viteConfig).toContain("import.meta.env.VITE_BUILD_COMMIT");
    expect(viteConfig).toContain("import.meta.env.VITE_BUILD_BRANCH");
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
      path.resolve("client/src/pages/Candidates.tsx"),
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
    // La búsqueda no aloja la ficha ni su encabezado: cada evidencia abre la
    // ficha en Revisión Humana. Conserva el criterio por fila para triaje.
    expect(review).not.toContain("<CandidateReviewSummary");
    expect(review).not.toContain("ReviewEvidencePanels");
    expect(review).toContain('aria-label="Guardar revisión de esta fila"');
    expect(review).toContain("Navegación vertical de resultados");
    expect(review).toContain("/admin/human-review?application=");
    expect(review).toContain('label="Candidato / plaza"');
    expect(review).toContain("aria-pressed={isSelected}");
    expect(review).toContain("bg-[#eaf2f7]");
    expect(review).toContain("dark:bg-[#162333]");
    expect(review.match(/orientation="horizontal"/g)).toHaveLength(1);
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

    expect(audit.files).toHaveLength(129);
    expect(audit.findings).toEqual([]);
    expect(publicCopyAudit.files).toHaveLength(129);
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

  it("operates ApiChat reception through the inboxSync bridge without n8n", () => {
    const sync = fs.readFileSync(path.resolve("server/inboxSync.ts"), "utf8");
    const bootstrap = fs.readFileSync(
      path.resolve("server/_core/index.ts"),
      "utf8"
    );
    const settings = fs.readFileSync(
      path.resolve("server/apiChatSettings.ts"),
      "utf8"
    );
    const config = fs.readFileSync(
      path.resolve("client/src/pages/Config.tsx"),
      "utf8"
    );
    const packageMetadata = JSON.parse(
      fs.readFileSync(path.resolve("package.json"), "utf8")
    );
    const readme = fs.readFileSync(path.resolve("README.md"), "utf8");
    const routers = fs.readFileSync(path.resolve("server/routers.ts"), "utf8");

    expect(sync).toContain("INBOX_SYNC_INTERVAL_MS = 1_000");
    expect(sync).toContain("INBOX_SYNC_HISTORY_LIMIT = 50");
    expect(sync).toContain("INBOX_SYNC_CONVERSATION_REFRESH_MS = 60_000");
    expect(sync).toContain("INBOX_SYNC_CATALOG_PAGE_SIZE = 200");
    expect(sync).toContain("INBOX_SYNC_FEED_GAP_MS = 15_000");
    expect(sync).toContain("INBOX_SYNC_BACKOFF_MS = 60_000");
    expect(sync).toContain('new URL("/v1/messages", settings.endpoint)');
    expect(sync).toContain('"client-id"');
    expect(sync).toContain('disabledEndpoints?.includes("/messagesHistory")');
    expect(routers).toContain("inbox_sync_manual");
    expect(routers).toContain("manualInboxSync");
    expect(bootstrap).toContain("startInboxSyncBridge");
    expect(fs.existsSync(path.resolve("n8n-workflows"))).toBe(false);
    expect(packageMetadata.scripts.build).not.toContain("n8n");
    expect(readme).not.toContain("n8n: workflow 04");
    expect(readme).toContain("n8n quedó retirado");
    expect(readme).toContain("`inboxSync`");
    expect(settings).toContain('path: "/sendMessage"');
    expect(settings).toContain('path: "/sendFile"');
    expect(settings).toContain('path: "/sendPTT"');
    expect(settings).toContain('path: "/sendLink"');
    expect(settings).toContain('path: "/sendLocation"');
    expect(settings).toContain('path: "/messagesHistory"');
    expect(settings).toContain('path: "/deleteMessage"');
    expect(config).toContain("Guardar endpoints");
    expect(config).toContain("Endpoints oficiales habilitados");
  });

  it("governs protocol deletion with a temporary six-digit code", () => {
    const governance = fs.readFileSync(
      path.resolve("shared/assessmentGovernance.ts"),
      "utf8"
    );
    const routers = fs.readFileSync(
      path.resolve("server/routers.ts"),
      "utf8"
    );
    const migration = fs.readFileSync(
      path.resolve("drizzle/migrations/0015_protocol_delete_challenges.sql"),
      "utf8"
    );

    expect(ASSESSMENT_DELETE_TITLE_WORD_LIMIT).toBe(11);
    expect(ASSESSMENT_DELETE_CODE_TTL_MINUTES).toBe(10);
    expect(ASSESSMENT_DELETE_CODE_MAX_ATTEMPTS).toBe(5);
    expect(ASSESSMENT_DELETE_CODE_RESEND_SECONDS).toBe(60);
    const title = assessmentDeleteAlertTitle({
      name: "Prueba técnica avanzada para instaladores solares",
      version: 3,
      status: "borrador",
      itemCount: 12,
      activeItemCount: 8,
    });
    expect(countWords(title)).toBeLessThanOrEqual(
      ASSESSMENT_DELETE_TITLE_WORD_LIMIT
    );
    expect(title).toContain("Eliminar");
    expect(title).toContain("por código");
    expect(governance).toContain("ASSESSMENT_DELETE_CODE_TTL_MINUTES");
    expect(routers).toContain("requestDeleteCode: adminProcedure");
    expect(routers).toContain("deleteProtocol: adminProcedure");
    expect(routers).toContain(
      "Una versión activa no puede eliminarse; retire primero su activación."
    );
    expect(routers).toContain(
      "La versión tiene sesiones de evaluación vinculadas y no puede eliminarse."
    );
    expect(migration).toContain("protocol_delete_challenges");
  });

  it("composes ISO activity with 11-word titles, 33-word summaries and the 20000-1 map", () => {
    const activity = fs.readFileSync(
      path.resolve("shared/activityAudit.ts"),
      "utf8"
    );
    const page = fs.readFileSync(
      path.resolve("client/src/pages/ActivityAudit.tsx"),
      "utf8"
    );

    expect(ACTIVITY_TITLE_WORD_LIMIT).toBe(11);
    expect(ACTIVITY_SUMMARY_WORD_LIMIT).toBe(33);
    expect(activity).toContain("Contribución de");
    expect(activity).toContain("ACTIVITY_TITLE_WORD_LIMIT");
    expect(activity).toContain("ACTIVITY_SUMMARY_WORD_LIMIT");
    expect(page).toContain("Mapa de controles ISO/IEC 20000-1");
  });

  it("administers project knowledge as the RAG learning source for the agent", () => {
    const migration = fs.readFileSync(
      path.resolve("drizzle/migrations/0016_project_knowledge.sql"),
      "utf8"
    );
    const knowledge = fs.readFileSync(
      path.resolve("server/knowledge.ts"),
      "utf8"
    );
    const page = fs.readFileSync(
      path.resolve("client/src/pages/MstEir.tsx"),
      "utf8"
    );
    const layout = fs.readFileSync(
      path.resolve("client/src/components/DashboardLayout.tsx"),
      "utf8"
    );
    const evaluator = fs.readFileSync(
      path.resolve("server/agentEvaluator.ts"),
      "utf8"
    );
    const config = fs.readFileSync(
      path.resolve("client/src/pages/Config.tsx"),
      "utf8"
    );
    const activity = fs.readFileSync(
      path.resolve("shared/activityAudit.ts"),
      "utf8"
    );
    const routers = fs.readFileSync(path.resolve("server/routers.ts"), "utf8");

    expect(layout).toContain('label: "Administrador de Proyectos"');
    expect(layout).not.toContain('label: "MST-EIR"');
    expect(migration).toContain("knowledge_projects");
    expect(migration).toContain("knowledge_folders");
    expect(migration).toContain("knowledge_files");
    expect(migration).toContain("summary_66");
    expect(migration).toContain("deep_analysis");
    expect(knowledge).toContain("KNOWLEDGE_SUMMARY_WORD_LIMIT = 66");
    expect(knowledge).toContain("KNOWLEDGE_ANALYSIS_WORD_LIMIT = 325");
    expect(knowledge).toContain("extractPdfText");
    expect(knowledge).toContain("extractDocxText");
    expect(knowledge).toContain('"application/pdf"');
    expect(page).toContain("Administrador de Proyectos");
    expect(page).toContain("+ Arrastre y Suelte");
    expect(page).toContain("Descripción de Archivo");
    expect(page).toContain("Configuración > Conocimiento de proyectos");
    expect(evaluator).toContain("BASE DE CONOCIMIENTO DEL PROYECTO (RAG)");
    expect(evaluator).toContain("loadProjectKnowledgeContext");
    expect(config).toContain("Conocimiento de proyectos (RAG)");
    expect(config).toContain("Peso máximo por archivo");
    expect(activity).toContain(
      '"/admin/mst-eir": "Administrador de Proyectos"'
    );
    expect(routers).toContain("deep_analysis=$1::varchar");
    expect(routers).toContain("summary_66=COALESCE($2::varchar,summary_66)");
    expect(routers).toContain("CASE WHEN $1::varchar<>''");
    expect(routers).not.toContain("CASE WHEN $1<>''");
    const summarySlot = page.indexOf('id="project-summary"');
    const positionsSlot = page.indexOf("Plazas vinculadas al RAG");
    expect(summarySlot).toBeGreaterThan(-1);
    expect(positionsSlot).toBeGreaterThan(summarySlot);
  });

  it("transports files in base64 and delivers a universal viewer", () => {
    const transport = fs.readFileSync(
      path.resolve("server/base64Transport.ts"),
      "utf8"
    );
    const viewer = fs.readFileSync(
      path.resolve("server/viewerAccess.ts"),
      "utf8"
    );
    const routes = fs.readFileSync(
      path.resolve("server/knowledgeRoutes.ts"),
      "utf8"
    );
    const knowledge = fs.readFileSync(
      path.resolve("server/knowledge.ts"),
      "utf8"
    );
    const page = fs.readFileSync(
      path.resolve("client/src/pages/MstEir.tsx"),
      "utf8"
    );
    const sync = fs.readFileSync(
      path.resolve("server/inboxSync.ts"),
      "utf8"
    );
    const webhook = fs.readFileSync(
      path.resolve("server/apiChatWebhook.ts"),
      "utf8"
    );
    const inbox = fs.readFileSync(path.resolve("server/inbox.ts"), "utf8");
    const routers = fs.readFileSync(path.resolve("server/routers.ts"), "utf8");

    // Un solo contrato de transporte para las cuatro fronteras.
    expect(transport).toContain("export function decodeTransport");
    expect(transport).toContain("export function detectContentSignature");
    expect(transport).toContain("export async function decodeRemoteAttachment");
    expect(transport).toContain("export function createTransportEnvelope");
    expect(transport).toContain("BASE64_TRANSPORT_VERSION");
    expect(sync).toContain("decodeRemoteAttachment");
    expect(webhook).toContain("decodeRemoteAttachment");
    expect(inbox).toContain("decodeTransport");
    // La extensión final se verifica por contenido, no por la declaración.
    expect(transport).toContain("contentTypeMismatch");
    expect(transport).toContain("reconstructTransportFileName");

    // Acceso firmado para las peticiones que emite el navegador.
    expect(viewer).toContain("export function createViewerToken");
    expect(viewer).toContain("export function verifyViewerToken");
    expect(viewer).toContain("VIEWER_TOKEN_TTL_SECONDS");
    expect(viewer).toContain("timingSafeEqual");
    expect(routes).toContain("verifyViewerToken");
    expect(routes).toContain("VIEWER_SECURITY_HEADERS");
    expect(viewer).toContain('"X-Content-Type-Options": "nosniff"');

    // La entrega al proveedor no puede exigir sesión: ApiChat descarga la
    // dirección desde sus servidores y la ruta administrativa le devolvía 403.
    // El acceso viaja como capacidad firmada, acotada al archivo y con
    // caducidad corta, y la sesión de administración sigue siendo válida.
    const inboxFiles = fs.readFileSync(
      path.resolve("server/inboxFiles.ts"),
      "utf8"
    );
    expect(inbox).toContain('createViewerToken("inbox"');
    expect(inbox).toContain("/api/inbox/files/${key}?t=");
    expect(inboxFiles).toContain('verifyViewerToken("inbox"');
    expect(inboxFiles).toContain("Acceso restringido a administración.");

    // El contenido del adjunto se resuelve en cualquier forma declarada y no
    // solo en `url`; una pérdida asienta los campos presentes para diagnóstico.
    expect(webhook).toContain("ATTACHMENT_CONTENT_FIELDS");
    expect(webhook).toContain("resolveAttachmentContent");
    expect(webhook).toContain("fieldsPresent");
    expect(webhook).toContain("recordWebhookLoss");
    expect(transport).toContain("isValidBase64Payload(payload)");

    // El visor cubre todos los formatos representables.
    expect(knowledge).toContain("export async function renderDocxHtml");
    expect(knowledge).toContain("export async function renderCsvPreview");
    expect(knowledge).toContain("export async function renderSpreadsheetHtml");
    expect(knowledge).toContain("export async function renderPlainTextPreview");
    expect(knowledge).toContain("export function detectCsvDelimiter");
    expect(page).toContain("knowledge.viewerToken");
    expect(page).toContain("isRenderable");

    // Un fallo de entrega debe declarar su causa: sin clasificación, un archivo
    // ausente del volumen es indistinguible de un error de permisos y el visor
    // muestra un objeto crudo imposible de diagnosticar.
    expect(routes).toContain("classifyDeliveryFailure");
    expect(routes).toContain("volumen-sin-archivo");
    expect(routes).toContain("permiso-denegado");
    expect(routes).toContain("prefersHtml");
    expect(routes).toContain("No fue posible abrir el documento");
    // El diagnóstico compara el catálogo con el volumen y es de administración.
    expect(knowledge).toContain("export async function knowledgeStorageHealth");
    expect(knowledge).toContain("missingSample");
    expect(routers).toContain("storageHealth: adminProcedure.query");
    expect(page).toContain("knowledge.storageHealth");
    expect(page).toContain("KNOWLEDGE_STORAGE_DIR");
  });

  it("operates multiple forms and announcements per position with spreadsheet import", () => {
    const layout = fs.readFileSync(
      path.resolve("client/src/components/DashboardLayout.tsx"),
      "utf8"
    );
    const activity = fs.readFileSync(
      path.resolve("shared/activityAudit.ts"),
      "utf8"
    );
    const routers = fs.readFileSync(
      path.resolve("server/routers.ts"),
      "utf8"
    );
    const importer = fs.readFileSync(
      path.resolve("server/importForms.ts"),
      "utf8"
    );
    const migration = fs.readFileSync(
      path.resolve("drizzle/migrations/0018_form_imports.sql"),
      "utf8"
    );
    const jobs = fs.readFileSync(
      path.resolve("client/src/pages/Jobs.tsx"),
      "utf8"
    );
    const candidatesPage = fs.readFileSync(
      path.resolve("client/src/pages/Candidates.tsx"),
      "utf8"
    );
    const humanReview = fs.readFileSync(
      path.resolve("client/src/pages/HumanReview.tsx"),
      "utf8"
    );
    const inbox = fs.readFileSync(
      path.resolve("client/src/pages/Inbox.tsx"),
      "utf8"
    );
    const ontology = fs.readFileSync(
      path.resolve("docs/ANALISIS_ONTOLOGICO_FORMULARIOS_2.0.137.md"),
      "utf8"
    );

    expect(layout).toContain('label: "Plazas y anuncios"');
    expect(layout).not.toContain('label: "Plazas y formularios"');
    expect(layout).toContain("Globe2");
    expect(activity).toContain('"/admin/jobs": "Plazas y anuncios"');
    expect(migration).toContain("application_form_submissions");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS source");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS import_meta");
    expect(migration).toContain("ON CONFLICT (application_id, form_id)");
    expect(importer).toContain("importSpreadsheetForm");
    expect(importer).toContain("derivePhoneColumn");
    expect(importer).toContain("isValidInternationalPhone");
    expect(importer).toContain(
      "INSERT INTO application_form_submissions"
    );
    expect(routers).toContain("listByPosition: roleProcedure");
    expect(routers).toContain("importSpreadsheet: adminProcedure");
    expect(routers).toContain("'formulario'");
    expect(jobs).toContain("Plazas y Anuncios");
    expect(jobs).toContain("Importar Excel/CSV");
    expect(jobs).toContain("Formularios y anuncios");
    expect(candidatesPage).toContain("/admin/human-review?application=");
    expect(routers).toContain("answers_summary");
    expect(humanReview).toContain("Formularios y anuncios · respuestas");
    expect(humanReview).toContain("submissions");
    expect(inbox).toContain("form_count");
    expect(ontology).toContain("Análisis ontológico");
    expect(ontology).toContain("Análisis epistemológico");
    expect(ontology).toContain("Análisis fenomenológico");
  });

  it("offers one secure link, one switch and one preview per form variant", () => {
    const routers = fs.readFileSync(path.resolve("server/routers.ts"), "utf8");
    const tokens = fs.readFileSync(
      path.resolve("server/formTokens.ts"),
      "utf8"
    );
    const importer = fs.readFileSync(
      path.resolve("server/importForms.ts"),
      "utf8"
    );
    const migration = fs.readFileSync(
      path.resolve("drizzle/migrations/0019_form_public_links.sql"),
      "utf8"
    );
    const schema = fs.readFileSync(path.resolve("drizzle/schema.ts"), "utf8");
    const apply = fs.readFileSync(
      path.resolve("client/src/pages/Apply.tsx"),
      "utf8"
    );
    const jobs = fs.readFileSync(
      path.resolve("client/src/pages/Jobs.tsx"),
      "utf8"
    );
    const formBuilder = fs.readFileSync(
      path.resolve("client/src/pages/FormBuilder.tsx"),
      "utf8"
    );
    const preview = fs.readFileSync(
      path.resolve("client/src/components/PublicFormPreview.tsx"),
      "utf8"
    );
    const candidatesPage = fs.readFileSync(
      path.resolve("client/src/pages/Candidates.tsx"),
      "utf8"
    );
    const humanReview = fs.readFileSync(
      path.resolve("client/src/pages/HumanReview.tsx"),
      "utf8"
    );
    const evaluator = fs.readFileSync(
      path.resolve("server/agentEvaluator.ts"),
      "utf8"
    );
    const analysis = fs.readFileSync(
      path.resolve("docs/ANALISIS_FORMULARIOS_MULTIPLES_2.0.138.md"),
      "utf8"
    );

    expect(migration).toContain("ADD COLUMN IF NOT EXISTS public_token");
    expect(migration).toContain("application_forms_public_token_uq");
    expect(schema).toContain("publicToken");
    expect(tokens).toContain("randomBytes(16)");
    expect(importer).toContain("instrumentSignature");
    expect(importer).toContain("reusedForm");
    expect(importer).toContain("form_import_reused");
    const cleanup = fs.readFileSync(
      path.resolve("database/004_saneamiento_formularios_duplicados.sql"),
      "utf8"
    );
    expect(cleanup).toContain("duplicate_form_removed");
    expect(cleanup).toContain("redundante_sin_evidencia_unica");
    expect(cleanup).toContain("ON COMMIT DROP");
    expect(routers).toContain("getFormByToken: publicProcedure");
    expect(routers).toContain("getPreview: adminProcedure");
    expect(routers).toContain("f.public_token = $1");
    expect(routers).toContain("publicAnswerConfig");
    expect(routers).toContain("LEFT JOIN LATERAL");
    expect(routers).not.toContain("acceptedAnswers: row.accepted_answers");
    expect(apply).toContain('useRoute("/apply/f/:token")');
    expect(apply).toContain("formToken");
    expect(jobs).toContain("/apply/f/");
    expect(jobs).toContain("<Switch");
    expect(formBuilder).toContain("formId");
    expect(preview).toContain("Vista previa pública del formulario");
    expect(humanReview).toContain("Formulario No. {submission.version}");
    expect(evaluator).toContain("answerKeyFor");
    expect(evaluator).toContain("questionId: answer.question_id");
    expect(analysis).toContain("Análisis ontológico");
    expect(analysis).toContain("Análisis epistemológico");
    expect(analysis).toContain("Análisis fenomenológico");
    expect(analysis).toContain("Estrategia de propiedad intelectual");
  });

  it("administers the candidate personal RAG inside human review", () => {
    const migration = fs.readFileSync(
      path.resolve("drizzle/migrations/0026_candidate_knowledge.sql"),
      "utf8"
    );
    const module = fs.readFileSync(
      path.resolve("server/candidateKnowledge.ts"),
      "utf8"
    );
    const panel = fs.readFileSync(
      path.resolve("client/src/components/review/CandidateRagPanel.tsx"),
      "utf8"
    );
    const review = fs.readFileSync(
      path.resolve("client/src/components/review/ReviewEvidencePanels.tsx"),
      "utf8"
    );
    const routers = fs.readFileSync(path.resolve("server/routers.ts"), "utf8");
    const context = fs.readFileSync(
      path.resolve("server/conversationContext.ts"),
      "utf8"
    );
    const sync = fs.readFileSync(
      path.resolve("server/inboxSync.ts"),
      "utf8"
    );
    const webhook = fs.readFileSync(
      path.resolve("server/apiChatWebhook.ts"),
      "utf8"
    );

    // El módulo anterior de solo lectura se retira de Revisión Humana.
    expect(review).not.toContain("Conocimiento vigente y ciclos de información");
    expect(review).toContain("<CandidateRagPanel");

    // Migración expansiva: crea entidades nuevas y no toca el RAG de proyectos.
    expect(migration).toContain("candidate_knowledge_folders");
    expect(migration).toContain("candidate_knowledge_files");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS candidate_knowledge_file_id");
    expect(migration).not.toMatch(/DROP\s+TABLE/i);
    expect(migration).not.toMatch(/ALTER\s+TABLE\s+knowledge_files/i);
    expect(migration).not.toMatch(/ALTER\s+TABLE\s+knowledge_projects/i);
    // La migración 0022 es opcional: el vínculo con las aclaraciones debe
    // agregarse solo cuando esa tabla existe, o la migración fallaría a mitad.
    expect(migration).toContain("table_name = 'candidate_knowledge_notes'");
    expect(migration).not.toMatch(
      /^ALTER TABLE candidate_knowledge_notes/m
    );

    // El esquema declara las tablas nuevas: sin esa declaración una
    // sincronización las vería como sobrantes y podría eliminarlas.
    const schema = fs.readFileSync(path.resolve("drizzle/schema.ts"), "utf8");
    expect(schema).toContain('pgTable(\n  "candidate_knowledge_folders"');
    expect(schema).toContain('pgTable(\n  "candidate_knowledge_files"');
    expect(schema).toContain("candidateKnowledgeFolders");
    expect(schema).toContain("candidateKnowledgeFiles");
    expect(schema).toContain("candidate_knowledge_files_storage_uq");
    // El patrón de auto-referencia replica el de las carpetas de proyecto.
    expect(schema).toContain("candidate_knowledge_folders_name_uq");

    // Mismos límites institucionales y misma política que el RAG de proyectos.
    expect(module).toContain("KNOWLEDGE_SUMMARY_WORD_LIMIT");    expect(module).toContain("KNOWLEDGE_ANALYSIS_WORD_LIMIT");
    expect(module).toContain("getKnowledgeSettings");
    expect(module).toContain("buildCandidateStorageKey");
    expect(module).toContain("analyzeKnowledgeDocument");
    expect(module).toContain("registerCandidateInboundDocument");

    // El expediente se alimenta desde el webhook y desde la sincronización.
    expect(sync).toContain("registerCandidateInboundDocument");
    expect(webhook).toContain("registerCandidateInboundDocument");

    // El agente recibe el expediente analizado en la capa personal.
    expect(context).toContain("Expediente documental del candidato");
    expect(context).toContain("knowledgeDocuments");

    // Alcance de visor separado del RAG de proyectos.
    const viewer = fs.readFileSync(
      path.resolve("server/viewerAccess.ts"),
      "utf8"
    );
    expect(viewer).toContain('"knowledge" | "inbox" | "candidate"');
    expect(routers).toContain('createViewerToken("candidate"');
    expect(routers).toContain("candidateKnowledge: router({");

    // El panel ofrece arrastre, árbol, visor y análisis editable.
    expect(panel).toContain("+ Arrastre y Suelte");
    expect(panel).toContain("Carpetas");
    expect(panel).toContain("Generar análisis de IA");
    expect(panel).toContain("Guardar análisis");
    expect(panel).toContain("Base de conocimiento de la plaza");
    expect(panel).toContain("Ciclos abiertos");
    expect(panel).toContain("Aclaraciones confirmadas por la persona");
  });

  it("scopes the WhatsApp inbox to the candidate under review", () => {
    const conversation = fs.readFileSync(
      path.resolve("client/src/components/review/CandidateConversationPanel.tsx"),
      "utf8"
    );
    const review = fs.readFileSync(
      path.resolve("client/src/components/review/ReviewEvidencePanels.tsx"),
      "utf8"
    );

    // Sustituye al panel compacto por el recorrido completo de la bandeja.
    expect(review).toContain("<CandidateConversationPanel");
    expect(review).not.toContain("Abrir bandeja completa");

    // Consume los mismos procedimientos que la bandeja general: la conducta
    // —permisos, guardarraíl salarial, auditoría y encolado— es idéntica.
    for (const procedure of [
      "inbox.list",
      "inbox.detail",
      "inbox.setAutomation",
      "inbox.markRead",
      "inbox.syncNow",
      "inbox.sendText",
      "inbox.sendLink",
      "inbox.sendLocation",
      "inbox.sendFile",
      "inbox.sendPtt",
      "inbox.deleteMessage",
    ]) {
      expect(conversation).toContain(procedure);
    }

    // Historial completo del candidato, no el recorte de la última hora.
    expect(conversation).toContain('timeRange: "all"');
    expect(conversation).toContain("applicationId");

    // Herramientas operativas presentes y sujetas al control humano.
    expect(conversation).toContain("Activar JARVI HR");
    expect(conversation).toContain("Control humano");
    expect(conversation).toContain("Excepción administrativa auditada");
    expect(conversation).toContain("Nota de voz");
    expect(conversation).toContain("Enlace");
    expect(conversation).toContain("Ubicación");
    expect(conversation).toContain("Archivo");
    expect(conversation).toContain("humanKeyboard");
    expect(conversation).toContain("messageTicks");

    // El documento recibido por el canal entra al RAG Personal del candidato.
    expect(conversation).toContain("RAG");
    expect(conversation).toContain("exclusiva de la persona en estudio");
  });

  it("closes every administrative sheet with the activity summary", () => {
    const layout = fs.readFileSync(
      path.resolve("client/src/components/DashboardLayout.tsx"),
      "utf8"
    );
    const bar = fs.readFileSync(
      path.resolve("client/src/components/ActivityAuditBar.tsx"),
      "utf8"
    );

    // El aviso se monta una sola vez en el layout, de modo que aparece en todas
    // las hojas administrativas por construcción, no por repetición.
    expect(layout.match(/<ActivityAuditBar \/>/g)).toHaveLength(1);

    // Cierra la hoja: va después del contenido y separa por arriba.
    const children = layout.indexOf("{children}");
    const barSlot = layout.indexOf("<ActivityAuditBar />");
    expect(children).toBeGreaterThan(-1);
    expect(barSlot).toBeGreaterThan(children);
    expect(bar).toContain("mt-4 rounded-2xl");
    expect(bar).not.toContain("mb-4 rounded-2xl");

    // El registro de la vista y su consulta no dependen de la posición.
    expect(bar).toContain("page_opened");
    expect(bar).toContain("activity.overview");
    expect(bar).toContain("Ver control ISO");
  });

  it("publishes the academic-commercial README with auditable proportions and references", () => {
    const readme = fs.readFileSync(path.resolve("README.md"), "utf8");
    const academicBody = readme.slice(0, readme.indexOf("## Referencias"));
    const historyStart = academicBody.indexOf("<!-- release-history:start -->");
    const historyEnd =
      academicBody.indexOf("<!-- release-history:end -->") +
      "<!-- release-history:end -->".length;
    // La auditoría mide la PROSA, no el registro de versiones. El registro es un
    // apéndice append-only que crece una entrada por release: incluirlo en el
    // techo obligaba a recortar texto académico en cada versión, con lo que la
    // medida dejaba de describir el cuerpo del documento. El registro conserva
    // su propio límite para que tampoco crezca sin control.
    const prose = (
      academicBody.slice(0, historyStart) + academicBody.slice(historyEnd)
    ).trim();
    const proseWordCount = prose.split(/\s+/).length;
    const historyWordCount = academicBody
      .slice(historyStart, historyEnd)
      .trim()
      .split(/\s+/).length;
    const bibliography = readme
      .slice(readme.indexOf("## Referencias"), readme.indexOf("## Licencia"))
      .match(/^\d+\./gm);

    expect(readme).toContain("Talento AISA · JARVI RH 2.0.176");
    expect(readme).toContain(
      'src="client/public/brand/talento-aisa-personaje.png" width="240"'
    );
    expect(historyStart).toBeGreaterThan(-1);
    expect(historyEnd).toBeGreaterThan(historyStart);
    // La prosa académica se conserva acotada; el registro histórico mantiene su
    // lugar y un techo propio.
    expect(proseWordCount).toBeGreaterThanOrEqual(2_400);
    expect(proseWordCount).toBeLessThanOrEqual(2_900);
    expect(historyWordCount).toBeLessThanOrEqual(2_600);
    expect(bibliography).toHaveLength(41);
    expect(readme).toContain("### API, infraestructura y modelos");
    expect(readme).toContain("<!-- release-history:start -->");
    expect(readme).toContain("### 17SEP2026 · JARVI RH 2.0.176");
    expect(readme).toContain("### 17SEP2026 · JARVI RH 2.0.157");
    expect(readme).toContain("### 17SEP2026 · JARVI RH 2.0.155");
    expect(readme).toContain("### 16SEP2026 · JARVI RH 2.0.154");
    expect(readme).toContain("### 16SEP2026 · JARVI RH 2.0.143");
    expect(readme).toContain("### 16SEP2026 · JARVI RH 2.0.142");
    expect(readme).toContain("### 16SEP2026 · JARVI RH 2.0.141");
    expect(readme).toContain("### 14SEP2026 · JARVI RH 2.0.140");
    expect(readme).toContain("### 11SEP2026 · JARVI RH 2.0.132");
    expect(readme).toContain("ISO/IEC 20000-1:2018");
    expect(readme).toContain("`inboxSync`");
    expect(readme).not.toContain("n8n: workflow 04");
    expect(readme).toContain("n8n quedó retirado");
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
    expect(readme).toContain("Langfuse%20SDK-5.11.1");
    expect(readme).toContain("LangGraph-1.4.14");
    expect(readme).toContain("no constituye certificación");
    expect(readme).toContain("Ontología, epistemología y fenomenología");
  });

  it("declara el servicio conversacional con hilo propio y doble RAG", () => {
    const blackBox = fs.readFileSync(
      path.resolve(`docs/PRUEBAS_CAJA_NEGRA_${APP_VERSION}.md`),
      "utf8"
    );
    const persona = fs.readFileSync(
      path.resolve("shared/conversationPersona.ts"),
      "utf8"
    );
    const engine = fs.readFileSync(
      path.resolve("server/conversationEngine.ts"),
      "utf8"
    );
    const outbox = fs.readFileSync(
      path.resolve("server/conversationOutbox.ts"),
      "utf8"
    );
    const routing = fs.readFileSync(path.resolve("server/routers.ts"), "utf8");
    const review = fs.readFileSync(
      path.resolve("client/src/pages/HumanReview.tsx"),
      "utf8"
    );
    const identityHeader = fs.readFileSync(
      path.resolve("client/src/components/review/CandidateReviewSummary.tsx"),
      "utf8"
    );
    const viewerPanel = fs.readFileSync(
      path.resolve("client/src/components/review/CandidateViewerPanel.tsx"),
      "utf8"
    );

    expect(blackBox).toContain(`Pruebas de caja negra · JARVI RH ${APP_VERSION}`);
    expect(blackBox).toContain("BN-CONV-01");
    expect(blackBox).toContain("BN-CONV-20");
    expect(blackBox).toContain("conversation_turns");
    expect(persona).toContain("CONVERSATION_CONDUCT");
    expect(persona).toContain("verifyConversationConduct");
    expect(persona).toContain("una sola pregunta abierta");
    expect(engine).toContain("store: false");
    expect(engine).toContain("enqueueAgentReply");
    expect(outbox).toContain("dispatchQueuedReplies");
    expect(routing).toContain("conversationPanelState");
    expect(routing).toContain("runConversationTurn");
    expect(review).toContain("ReviewEvidencePanels");
    expect(review).toContain("<CandidateReviewSummary");
    expect(identityHeader).toContain("salaryLabel");
    expect(identityHeader).toContain("declaredLocationLabel");
    expect(identityHeader).toContain("Punteo IA");
    expect(identityHeader).toContain("candidates.setStatus");
    // El panel de Vista 360° vive en la ficha, encima del resumen y de la
    // decisión, con su matriz por bloques y su navegación.
    expect(review).toContain("<CandidateViewerPanel");
    expect(viewerPanel).toContain("Vista 360° del Candidato");
    expect(viewerPanel).toContain("Navegación de bloques de evaluación");
    expect(viewerPanel).toContain("Matriz de evaluación IA");
    expect(review.indexOf("<CandidateViewerPanel")).toBeLessThan(
      review.indexOf("Resumen de perfil")
    );
    // La bitácora ocupa el lugar de la caja de solicitud de CV que la
    // reingeniería de hojas dejó sin función, y el resumen vacío de la
    // conversación se retira porque el panel de conversación lo sustituye.
    expect(review.indexOf("<CandidateViewerPanel")).toBeLessThan(
      review.indexOf("Bitácora")
    );
    expect(review).toContain("Bitácora");
    expect(review).not.toContain("Solicitud de CV por WhatsApp");
    expect(review).not.toContain("Conversación WhatsApp");
    expect(review).not.toContain("Aún no hay mensajes asociados");
  });

  it("mantiene el método de evaluación fuera del paquete del cliente", () => {
    const agentConfig = fs.readFileSync(
      path.resolve("shared/agentConfig.ts"),
      "utf8"
    );
    const agentSettings = fs.readFileSync(
      path.resolve("server/agentSettings.ts"),
      "utf8"
    );
    const evaluator = fs.readFileSync(
      path.resolve("server/agentEvaluator.ts"),
      "utf8"
    );
    const page = fs.readFileSync(
      path.resolve("client/src/pages/AgentEvaluator.tsx"),
      "utf8"
    );
    const panel = fs.readFileSync(
      path.resolve("client/src/components/review/CandidateViewerPanel.tsx"),
      "utf8"
    );
    const clientSources = readClientSources();

    // El know-how no se distribuye al navegador: llega en una respuesta
    // autenticada y solo en la superficie administrativa que lo gobierna.
    expect(clientSources).not.toContain("EVALUATION_BLOCKS");
    expect(clientSources).not.toContain("SCORE_BANDS");
    expect(clientSources).not.toContain("SALARY_GOVERNANCE_POLICY");
    expect(clientSources).not.toContain("DEFAULT_AGENT_SETTINGS");
    expect(clientSources).not.toContain("DEFAULT_AGENT_INSTRUCTIONS");
    expect(clientSources).not.toContain("DEFAULT_METHODOLOGY_INTERPRETATION");
    for (const blockId of [
      "identificacion_ajuste",
      "evidencia_experiencia",
      "disponibilidad_logistica",
      "riesgos_brechas",
      "dictamen_ia",
    ]) {
      expect(clientSources).not.toContain(blockId);
    }

    // El servidor conserva el catálogo del método y lo publica únicamente al
    // constructor administrativo.
    expect(agentConfig).toContain("weight:");
    expect(agentSettings).toContain("function methodCatalog()");
    expect(agentSettings).toContain("evaluationBlocks: EVALUATION_BLOCKS");
    expect(agentSettings).toContain("scoreBands: SCORE_BANDS");
    expect(agentSettings).toContain(
      "salaryGovernancePolicy: SALARY_GOVERNANCE_POLICY"
    );
    expect(agentSettings).toContain(
      "defaultInstructions: DEFAULT_AGENT_INSTRUCTIONS"
    );
    expect(page).toContain("method.evaluationBlocks");
    expect(page).toContain("method.scoreBands");
    expect(page).toContain("method.salaryGovernancePolicy");
    expect(page).toContain("method.defaultInstructions");

    // La ficha recibe la etiqueta del bloque resuelta por el servidor.
    expect(evaluator).toContain("export function withBlockLabels");
    expect(panel).toContain("{block.label ?? block.id}");
  });

  it("configura la evaluación de CV y compone su cierre sin efectos laterales", () => {
    const cvAnalysis = fs.readFileSync(
      path.resolve("server/cvAnalysis.ts"),
      "utf8"
    );
    const cvRequest = fs.readFileSync(
      path.resolve("server/cvRequest.ts"),
      "utf8"
    );
    const config = fs.readFileSync(
      path.resolve("client/src/pages/Config.tsx"),
      "utf8"
    );
    const routing = fs.readFileSync(path.resolve("server/routers.ts"), "utf8");

    // El módulo reúne la configuración editorial del expediente de CV.
    expect(cvAnalysis).toContain("cv_thank_you_message");
    expect(cvAnalysis).toContain("cv_contact_notice");
    expect(cvAnalysis).toContain("cv_essence_word_limit");
    expect(cvAnalysis).toContain("CV_ESSENCE_DEFAULT_WORD_LIMIT = 550");
    expect(cvAnalysis).toContain("export function renderCvText");
    expect(cvAnalysis).toContain("export function composeCvClosing");
    expect(cvAnalysis).toContain("export async function loadCvAnalysisConfiguration");
    expect(cvAnalysis).toContain("export async function cvAwaitingState");
    expect(routing).toContain("cvAnalysis: adminProcedure.query");

    // El cierre viaja en la misma lectura que alimenta el mensaje: no agrega
    // consultas al despacho y usa el texto institucional cuando no se configuró.
    expect(cvRequest).toContain("composeCvClosingFromSettings");
    expect(cvRequest).toContain("AS cv_thank_you_message");
    expect(cvRequest).toContain("AS cv_contact_notice");

    // La guardia salarial se evalúa antes de tocar la base.
    expect(cvRequest.indexOf("assertNoAutomatedSalaryOffer(requestMessage)")).toBeLessThan(
      cvRequest.indexOf("pg_advisory_xact_lock")
    );

    // La hoja administrativa nombra el módulo y expone su configuración.
    expect(config).toContain("Evaluación de CV con IA");
    expect(config).not.toContain("Preferencias de comunicación");
    expect(config).toContain("Mensaje de agradecimiento");
    expect(config).toContain("Aviso de contacto");
    expect(config).toContain("Palabras de la esencia del CV");
    expect(config).toContain("trpc.config.cvAnalysis.useQuery()");

    // La esencia del CV se genera en el servidor, por fragmentos y acotada por
    // la configuración; el expediente entra al evaluador como capa declarada.
    expect(cvAnalysis).toContain("export function chunkCvText");
    expect(cvAnalysis).toContain("export async function analyzeCandidateCvEssence");
    expect(cvAnalysis).toContain("limitWords(essence, configuration.essenceWordLimit)");
    expect(cvAnalysis).toContain("candidate_cv_essence_generated");
    const evaluatorSource = fs.readFileSync(
      path.resolve("server/agentEvaluator.ts"),
      "utf8"
    );
    expect(evaluatorSource).toContain("async function loadCandidateEvidence");
    expect(evaluatorSource).toContain("EXPEDIENTE DOCUMENTAL DEL CANDIDATO");
    expect(evaluatorSource).toContain("candidateEvidence");
    const migration0027 = fs.readFileSync(
      path.resolve("drizzle/migrations/0027_candidate_cv_essence.sql"),
      "utf8"
    );
    expect(migration0027).toContain("ADD COLUMN IF NOT EXISTS cv_essence");
    expect(migration0027).toContain("cv_essence_status");
    expect(migration0027).toContain("cv_essence_updated_at");
    expect(routing).toContain("generateCvEssence: roleProcedure");
    expect(routing).toContain("cvAnalysis: roleProcedure");

    // El panel se monta junto a las respuestas de formularios en la ficha.
    const review = fs.readFileSync(
      path.resolve("client/src/pages/HumanReview.tsx"),
      "utf8"
    );
    expect(review).toContain("<CandidateCvAnalysisPanel");
    expect(review.indexOf("Formularios y anuncios · respuestas")).toBeLessThan(
      review.indexOf("<CandidateCvAnalysisPanel")
    );
  });

  it("declara el ciclo automático de pruebas treinta segundos después del formulario", () => {
    const automation = fs.readFileSync(
      path.resolve("server/assessmentAutomation.ts"),
      "utf8"
    );
    const cvRequest = fs.readFileSync(
      path.resolve("server/cvRequest.ts"),
      "utf8"
    );
    const worker = fs.readFileSync(
      path.resolve("server/conversationWorker.ts"),
      "utf8"
    );
    const assessments = fs.readFileSync(
      path.resolve("client/src/pages/Assessments.tsx"),
      "utf8"
    );
    const routing = fs.readFileSync(path.resolve("server/routers.ts"), "utf8");
    const migration = fs.readFileSync(
      path.resolve("drizzle/migrations/0028_assessment_cycles.sql"),
      "utf8"
    );
    const attemptsMigration = fs.readFileSync(
      path.resolve("drizzle/migrations/0030_assessment_item_attempts.sql"),
      "utf8"
    );
    const inbox = fs.readFileSync(path.resolve("server/inbox.ts"), "utf8");
    const conversationPanel = fs.readFileSync(
      path.resolve("client/src/components/review/CandidateConversationPanel.tsx"),
      "utf8"
    );

    // La ventana declarada y la semántica del interruptor apagado.
    expect(automation).toContain("ASSESSMENT_START_DELAY_SECONDS = 30");
    expect(automation).toContain("export function planAssessmentCycle");
    expect(automation).toContain("export async function scheduleAssessmentCycle");
    expect(automation).toContain("export async function runAssessmentCycleSweep");
    expect(automation).toContain('state: "apagado"');
    expect(automation).toContain("assessment_cycle_started");

    // El ciclo se registra al solicitar el CV y lo promueve el barrido.
    expect(cvRequest).toContain("scheduleAssessmentCycle(pool, applicationId)");
    expect(worker).toContain("runAssessmentCycleSweep(pool");
    expect(worker).toContain("assessment,");

    // Interruptor administrable y su migración.
    expect(routing).toContain("saveAutomation: adminProcedure");
    expect(routing).toContain("automation: roleProcedure.query");
    expect(assessments).toContain("Ciclo automático de pruebas");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS assessment_cycles");
    expect(migration).toContain("ready_at timestamptz NOT NULL");

    // Ejecución del instrumento: decisión pura, traza por ítem y cierre.
    expect(automation).toContain("export function planAssessmentStep");
    expect(automation).toContain("export async function runAssessmentStepSweep");
    expect(automation).toContain("export function judgeAssessmentAnswer");
    expect(automation).toContain("export function assessmentExecutionScore");
    expect(automation).toContain("ASSESSMENT_MIN_ANSWER_WORDS");
    expect(automation).toContain("completeAssessmentCycle(pool, {");
    expect(attemptsMigration).toContain(
      "CREATE TABLE IF NOT EXISTS assessment_item_attempts"
    );
    expect(attemptsMigration).toContain(
      "assessment_item_attempts_identity_uq"
    );

    // Continuidad: el interruptor suspende la ejecución sin suprimir la
    // obligación, y ambos barridos comparten el mismo punto de arranque para
    // que el ciclo también se ejecute en el despliegue separado por capacidad.
    expect(automation).toContain('reason: "automation_disabled"');
    expect(automation).toContain("assessmentGreetingMessageKey");
    expect(automation).toContain("assessmentItemMessageKey");
    expect(worker).toContain("runAssessmentStepSweep(pool");
    expect(worker).toContain("const assessment = await runAssessmentCycleSweep");
    expect(worker).toContain("conversationsInProtocol");
    expect(worker).toContain("const protocol = await runAssessmentStepSweep");
    expect(worker).toContain("return { assessment, protocol, turns }");

    // Identidad única del acto: la ficha lee el ciclo y no la entidad legada.
    expect(inbox).toContain("FROM assessment_cycles cycle");
    expect(inbox).toContain("progress_label");
    expect(inbox).not.toContain("FROM assessment_sessions");
    expect(conversationPanel).toContain("Avance de la prueba");
  });

  it("declara el despliegue separado por capacidad con cola dedicada", () => {
    const blackBox = fs.readFileSync(
      path.resolve(`docs/PRUEBAS_CAJA_NEGRA_${APP_VERSION}.md`),
      "utf8"
    );
    const guide = fs.readFileSync(
      path.resolve("docs/GUIA_EASYPANEL_CONVERSACION_2.0.142.md"),
      "utf8"
    );
    const governance = fs.readFileSync(
      path.resolve("docs/RELEASE_GOVERNANCE.md"),
      "utf8"
    );
    const split = fs.readFileSync(
      path.resolve("drizzle/migrations/0023_conversation_service_split.sql"),
      "utf8"
    );

    expect(blackBox).toContain(`Pruebas de caja negra · JARVI RH ${APP_VERSION}`);
    expect(blackBox).toContain("BN-SPLIT-01");
    expect(blackBox).toContain("BN-SPLIT-12");
    expect(guide).toContain("CONVERSATION_SERVICE_CAPABILITY");
    expect(guide).toContain("conversation_reconciliation");
    expect(guide).toContain("server/services/sender.ts");
    expect(guide).toContain("ALTER ROLE jarvi_receptor");
    expect(governance).toContain("Alcance candidato 2.0.176");
    expect(split).toContain("FOR UPDATE");
    expect(split).not.toContain("PASSWORD '");
  });
  it("administra los endpoints de ApiChat por capacidad conversacional", () => {
    const settings = fs.readFileSync(
      path.resolve("server/apiChatSettings.ts"),
      "utf8"
    );
    const config = fs.readFileSync(path.resolve("client/src/pages/Config.tsx"), "utf8");
    const blackBox = fs.readFileSync(
      path.resolve(`docs/PRUEBAS_CAJA_NEGRA_${APP_VERSION}.md`),
      "utf8"
    );
    const guide = fs.readFileSync(
      path.resolve("docs/GUIA_EASYPANEL_CONVERSACION_2.0.142.md"),
      "utf8"
    );

    // El catálogo declara capacidad, consumidores e indispensable para el agente.
    expect(settings).toContain("APICHAT_ENDPOINT_CAPABILITIES");
    expect(settings).toContain("APICHAT_ENDPOINT_CONSUMERS");
    expect(settings).toContain("requiredForAgent");
    expect(settings).toContain("conversationUse");
    expect(settings).toContain("computeApiChatCapabilityReadiness");
    expect(settings).toContain("apiChatCapabilityAdvisories");
    expect(settings).toContain("no consume ningún endpoint");
    expect(settings).toContain(
      "sin este endpoint la conversación no se alimenta ni se rehidrata"
    );
    expect(settings).toContain(
      "sin este endpoint el agente no puede contestar"
    );

    // La pantalla muestra la capacidad, los consumidores y los avisos.
    expect(config).toContain("ENDPOINT_CAPABILITY_LABELS");
    expect(config).toContain("ENDPOINT_CONSUMER_LABELS");
    expect(config).toContain("conversationMode");
    expect(config).toContain("advisories");
    expect(config).toContain("capabilities");

    // Caja negra y guía publican los casos y la consulta única de verificación.
    expect(blackBox).toContain("BN-EP-01");
    expect(blackBox).toContain("BN-EP-09");
    expect(guide).toContain("GATE GLOBAL");
    expect(guide).toContain("conversation_outbox_message_uq");
    expect(guide).toContain("DATABASE_URL_RECEIVER");
    expect(guide).toContain("CONVERSATION_SERVICE_CAPABILITY");
  });

  it("activa el servicio conversacional desde el panel sin variables de entorno", () => {
    const activation = fs.readFileSync(
      path.resolve("server/conversationActivation.ts"),
      "utf8"
    );
    const migration = fs.readFileSync(
      path.resolve("drizzle/migrations/0024_conversation_activation.sql"),
      "utf8"
    );
    const config = fs.readFileSync(
      path.resolve("client/src/pages/Config.tsx"),
      "utf8"
    );
    const serviceRuntime = fs.readFileSync(
      path.resolve("server/services/serviceRuntime.ts"),
      "utf8"
    );
    const blackBox = fs.readFileSync(
      path.resolve(`docs/PRUEBAS_CAJA_NEGRA_${APP_VERSION}.md`),
      "utf8"
    );
    const guide = fs.readFileSync(
      path.resolve("docs/GUIA_EASYPANEL_CONVERSACION_2.0.142.md"),
      "utf8"
    );

    // Preactivación sembrada por la migración.
    expect(migration).toContain("ON CONFLICT (provider, setting_key) DO NOTHING");
    expect(migration).toContain("'conversation', 'agent_enabled'");
    expect(migration).toContain("'conversation', 'service_mode'");

    // Activación gobernada por el panel con valores de fábrica encendidos.
    expect(activation).toContain("DEFAULT_CONVERSATION_ACTIVATION");
    expect(activation).toContain("agentEnabled: true");
    expect(activation).toContain("saveConversationActivation");
    expect(activation).toContain("activation_updated");
    expect(activation).toContain("conversationActivationAdvisories");

    // La capacidad es intrínseca al punto de entrada.
    expect(serviceRuntime).toContain("intrínseca al punto de entrada");
    expect(serviceRuntime).toContain("Desactivado por configuración");
    expect(serviceRuntime).not.toContain("CONVERSATION_SERVICE_MODE=split");

    // Panel y documentos.
    expect(config).toContain("Activación del servicio conversacional");
    expect(config).toContain("saveConversationActivation");
    expect(blackBox).toContain("BN-ACT-01");
    expect(blackBox).toContain("BN-ACT-12");
    expect(guide).toContain("No se requiere ninguna variable de entorno nueva");
  });

  it("publica el script único de despliegue sincronizado con las migraciones", () => {
    // El generador falla si el artefacto quedó desactualizado.
    expect(() =>
      execFileSync(
        "node",
        ["scripts/build-conversation-deployment-sql.mjs", "--check"],
        { cwd: path.resolve("."), stdio: "pipe" }
      )
    ).not.toThrow();

    const deploy = fs.readFileSync(
      path.resolve("database/005_servicio_conversacional_listo.sql"),
      "utf8"
    );
    const blackBox = fs.readFileSync(
      path.resolve(`docs/PRUEBAS_CAJA_NEGRA_${APP_VERSION}.md`),
      "utf8"
    );
    const guide = fs.readFileSync(
      path.resolve("docs/GUIA_EASYPANEL_CONVERSACION_2.0.142.md"),
      "utf8"
    );
    const manifest = fs.readFileSync(
      path.resolve("MANIFIESTO_ENTREGA.md"),
      "utf8"
    );

    // Las migraciones y la verificación autocertificada viajan juntas.
    expect(deploy).toContain("Origen: drizzle/migrations/0022_conversational_agent.sql");
    expect(deploy).toContain("Origen: drizzle/migrations/0023_conversation_service_split.sql");
    expect(deploy).toContain("Origen: drizzle/migrations/0024_conversation_activation.sql");
    // El artefacto no deja fuera las tablas del expediente, del ciclo ni de su
    // traza: lo que se aplica en un solo paso es lo que se verifica al final.
    expect(deploy).toContain(
      "Origen: drizzle/migrations/0027_candidate_cv_essence.sql"
    );
    expect(deploy).toContain(
      "Origen: drizzle/migrations/0028_assessment_cycles.sql"
    );
    expect(deploy).toContain(
      "Origen: drizzle/migrations/0030_assessment_item_attempts.sql"
    );
    expect(deploy).toContain("Migracion 0030 - identidad unica del intento");
    expect(deploy).toContain("CREATE TABLE IF NOT EXISTS conversation_outbox");
    expect(deploy).toContain("INSERT INTO integration_settings");
    expect(deploy).toContain("WITH controles AS (");
    expect(deploy).toContain("GATE GLOBAL");
    expect(deploy).toContain("PASSWORD NULL");
    expect(deploy).not.toContain("PASSWORD '");
    expect(deploy).toContain("insufficient_privilege");

    // Los documentos apuntan al script único.
    expect(blackBox).toContain("BN-READY-01");
    expect(blackBox).toContain("005_servicio_conversacional_listo.sql");
    expect(guide).toContain("005_servicio_conversacional_listo.sql");
    expect(manifest).toContain("005_servicio_conversacional_listo.sql");
  });
});
