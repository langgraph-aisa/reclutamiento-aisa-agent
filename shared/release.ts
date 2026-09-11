import packageMetadata from "../package.json";

export const PRODUCT_NAME = "JARVI RH";
export const APP_VERSION = packageMetadata.version;
export const RELEASE_LABEL = `${PRODUCT_NAME} ${APP_VERSION}`;
export const RELEASE_BRANCH = "main";
export const RELEASE_PATCH_CEILING = 999;

function auditedVersion(specifier: string) {
  return specifier.match(/\d+(?:\.\d+){1,2}/)?.[0] ?? "no identificada";
}

export const AUDITED_RUNTIME = {
  langfuseTracing: auditedVersion(
    packageMetadata.dependencies["@langfuse/tracing"]
  ),
  langfuseLangChain: auditedVersion(
    packageMetadata.dependencies["@langfuse/langchain"]
  ),
  langfuseOpenAI: auditedVersion(
    packageMetadata.dependencies["@langfuse/openai"]
  ),
  openTelemetry: auditedVersion(
    packageMetadata.dependencies["@opentelemetry/sdk-node"]
  ),
  langGraph: auditedVersion(
    packageMetadata.dependencies["@langchain/langgraph"]
  ),
  langChainOpenAI: auditedVersion(
    packageMetadata.dependencies["@langchain/openai"]
  ),
  openAiSdk: auditedVersion(packageMetadata.dependencies.openai),
  responsesApi: "v1/responses",
} as const;

export const QUALITY_REFERENCES = [
  "ISO/IEC 25010:2023",
  "ISO/IEC 27001:2022",
  "ISO/IEC/IEEE 29119-1:2022",
] as const;

export function nextReleaseVersion(version: string) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`Versión JARVI RH inválida: ${version}`);
  const [, majorText, minorText, patchText] = match;
  const major = Number(majorText);
  const minor = Number(minorText);
  const patch = Number(patchText);
  return patch >= RELEASE_PATCH_CEILING
    ? `${major}.${minor + 1}.0`
    : `${major}.${minor}.${patch + 1}`;
}
