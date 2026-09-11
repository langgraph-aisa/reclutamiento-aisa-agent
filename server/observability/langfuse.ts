import { createHash, createHmac } from "node:crypto";
import { isIP } from "node:net";
import {
  context,
  isSpanContextValid,
  propagation,
  SamplingDecision,
  trace,
  TraceFlags,
  type Attributes,
  type Context,
  type Link,
  type SpanKind,
} from "@opentelemetry/api";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { LangfuseClient } from "@langfuse/client";
import { CallbackHandler } from "@langfuse/langchain";
import { observeOpenAI, type LangfuseConfig } from "@langfuse/openai";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import {
  LangfuseOtelSpanAttributes,
  propagateAttributes,
  setLangfuseTracerProvider,
  startActiveObservation,
  type LangfuseObservation,
  type LangfuseObservationType,
  type ObservationLevel,
} from "@langfuse/tracing";
import type { Pool } from "pg";
import { getAgentRuntimeSettings } from "../agentSettings";
import {
  pseudonymizeTelemetryId,
  redactTelemetry,
  safeTelemetryToken,
  sameOpaqueFingerprint,
  sanitizeTelemetryRecord,
  TELEMETRY_OMITTED,
  TELEMETRY_REDACTED,
  type TelemetryCaptureMode,
} from "./redaction";

const OFFICIAL_LANGFUSE_ORIGINS = new Set([
  "https://cloud.langfuse.com",
  "https://us.cloud.langfuse.com",
  "https://jp.cloud.langfuse.com",
  "https://hipaa.cloud.langfuse.com",
]);

const DEFAULT_RELEASE = "2.0.131";
const SERVICE_NAME = "talento-aisa";

export type LangfuseReasonCode =
  | "DISABLED"
  | "MISSING_CREDENTIALS"
  | "MISSING_PSEUDONYMIZATION_KEY"
  | "INVALID_BASE_URL"
  | "INVALID_ENVIRONMENT"
  | "INVALID_SAMPLE_RATE"
  | "AUTHENTICATION_FAILED"
  | "CONNECTION_FAILED"
  | "INITIALIZATION_FAILED"
  | "ROTATION_REJECTED"
  | "STOPPED";

export type LangfuseOperationalState =
  | "disabled"
  | "initializing"
  | "ready"
  | "rotating"
  | "failed"
  | "stopped";

export interface LangfuseObservabilityStatus {
  state: LangfuseOperationalState;
  enabled: boolean;
  reasonCode?: LangfuseReasonCode;
  baseUrl?: string;
  environment?: string;
  captureMode?: TelemetryCaptureMode;
  sampleRate?: number;
  release?: string;
}

export interface LangfuseInitializationOptions {
  release?: string;
  allowedSelfHostedOrigins?: string[];
  pseudonymizationSecret?: string | Buffer;
}

export interface LangfuseRuntimeConfiguration
  extends LangfuseInitializationOptions {
  enabled: boolean;
  publicKey: string | null;
  secretKey: string | null;
  baseUrl: string;
  environment: string;
  captureMode: TelemetryCaptureMode;
  sampleRate: number;
}

export interface LangfuseObservationOptions {
  name: string;
  asType?: LangfuseObservationType;
  traceName?: string;
  sessionId?: string | number | null;
  userId?: string | number | null;
  tags?: string[];
  metadata?: Record<string, unknown>;
  input?: unknown;
  version?: string;
}

export interface LangfuseObservationUpdate {
  output?: unknown;
  metadata?: Record<string, unknown>;
  level?: ObservationLevel;
  statusMessage?: string;
  model?: string;
  modelParameters?: Record<string, string | number>;
  usageDetails?: Record<string, number>;
  costDetails?: Record<string, number>;
}

export interface SafeLangfuseObservation {
  readonly id: string | null;
  readonly traceId: string | null;
  update(attributes: LangfuseObservationUpdate): void;
}

export interface LangfuseCallbackOptions {
  userId?: string | number | null;
  sessionId?: string | number | null;
  tags?: string[];
  version?: string;
  traceMetadata?: Record<string, unknown>;
}

export interface LangfuseOpenAIOptions {
  traceName?: string;
  sessionId?: string | number | null;
  userId?: string | number | null;
  tags?: string[];
  generationName?: string;
  generationMetadata?: Record<string, unknown>;
}

type ActiveRuntime = {
  sdk: NodeSDK;
  processor: LangfuseSpanProcessor;
  fingerprint: string;
  hmacKey: Buffer;
  status: LangfuseObservabilityStatus & { state: "ready"; enabled: true };
};

class ConfigurationError extends Error {
  constructor(readonly reasonCode: LangfuseReasonCode) {
    super(reasonCode);
    this.name = "ConfigurationError";
  }
}

let activeRuntime: ActiveRuntime | null = null;
let currentStatus: LangfuseObservabilityStatus = {
  state: "disabled",
  enabled: false,
  reasonCode: "DISABLED",
};
let transitionQueue: Promise<void> = Promise.resolve();

function serialized<T>(operation: () => Promise<T>) {
  const execution = transitionQueue.then(operation, operation);
  transitionQueue = execution.then(
    () => undefined,
    () => undefined
  );
  return execution;
}

function safeOrigin(value: string) {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.pathname !== "/" && url.pathname !== "")
    ) {
      return null;
    }
    if (
      isIP(url.hostname) !== 0 ||
      url.hostname === "localhost" ||
      url.hostname.endsWith(".localhost") ||
      url.hostname.endsWith(".local") ||
      url.hostname.endsWith(".internal")
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

/** Only official Cloud regions or an explicit HTTPS self-host allow-list pass. */
export function validateLangfuseBaseUrl(
  baseUrl: string,
  allowedSelfHostedOrigins: string[] = []
) {
  const origin = safeOrigin(baseUrl.trim());
  if (!origin) throw new ConfigurationError("INVALID_BASE_URL");
  if (OFFICIAL_LANGFUSE_ORIGINS.has(origin)) return origin;

  const allowList = new Set(
    allowedSelfHostedOrigins
      .map(safeOrigin)
      .filter((item): item is string => !!item)
  );
  if (!allowList.has(origin)) {
    throw new ConfigurationError("INVALID_BASE_URL");
  }
  return origin;
}

function validateEnvironment(value: string) {
  const environment = value.trim().toLowerCase();
  if (
    !/^[a-z0-9][a-z0-9_-]{0,39}$/.test(environment) ||
    environment.startsWith("langfuse")
  ) {
    throw new ConfigurationError("INVALID_ENVIRONMENT");
  }
  return environment;
}

function validateSampleRate(value: number) {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new ConfigurationError("INVALID_SAMPLE_RATE");
  }
  return value;
}

function deriveHmacKey(source: string | Buffer | undefined) {
  if (!source || Buffer.byteLength(source) < 32) {
    throw new ConfigurationError("MISSING_PSEUDONYMIZATION_KEY");
  }
  return createHmac("sha256", source)
    .update("talento-aisa/langfuse-pseudonymization/v1", "utf8")
    .digest();
}

function normalizeRuntimeConfiguration(
  configuration: LangfuseRuntimeConfiguration
) {
  if (!configuration.enabled) {
    throw new ConfigurationError("DISABLED");
  }
  const publicKey = configuration.publicKey?.trim();
  const secretKey = configuration.secretKey?.trim();
  if (!publicKey || !secretKey) {
    throw new ConfigurationError("MISSING_CREDENTIALS");
  }
  const baseUrl = validateLangfuseBaseUrl(
    configuration.baseUrl,
    configuration.allowedSelfHostedOrigins
  );
  const environment = validateEnvironment(configuration.environment);
  const sampleRate = validateSampleRate(configuration.sampleRate);
  const captureMode: TelemetryCaptureMode =
    configuration.captureMode === "redacted" ? "redacted" : "metadata_only";
  const release = safeTelemetryToken(
    configuration.release ?? DEFAULT_RELEASE,
    DEFAULT_RELEASE
  );
  const hmacKey = deriveHmacKey(configuration.pseudonymizationSecret);
  const fingerprint = createHash("sha256")
    .update(baseUrl)
    .update("\0")
    .update(environment)
    .update("\0")
    .update(String(sampleRate))
    .update("\0")
    .update(captureMode)
    .update("\0")
    .update(publicKey)
    .update("\0")
    .update(secretKey)
    .update("\0")
    .update(hmacKey)
    .digest("base64url");

  return {
    ...configuration,
    publicKey,
    secretKey,
    baseUrl,
    environment,
    sampleRate,
    captureMode,
    release,
    hmacKey,
    fingerprint,
  };
}

function ratioSampler(sampleRate: number) {
  return {
    shouldSample(
      parentContext: Context,
      traceId: string,
      _spanName: string,
      _spanKind: SpanKind,
      _attributes: Attributes,
      _links: Link[]
    ) {
      const parent = trace.getSpanContext(parentContext);
      if (parent && isSpanContextValid(parent)) {
        return {
          decision:
            parent.traceFlags & TraceFlags.SAMPLED
              ? SamplingDecision.RECORD_AND_SAMPLED
              : SamplingDecision.NOT_RECORD,
        };
      }
      if (sampleRate === 0) return { decision: SamplingDecision.NOT_RECORD };
      if (sampleRate === 1) {
        return { decision: SamplingDecision.RECORD_AND_SAMPLED };
      }
      const bucket = Number.parseInt(traceId.slice(0, 13), 16);
      const maximum = 0xfffffffffffff;
      return {
        decision:
          bucket / maximum < sampleRate
            ? SamplingDecision.RECORD_AND_SAMPLED
            : SamplingDecision.NOT_RECORD,
      };
    },
    toString() {
      return `TalentoAisaTraceRatioSampler{${sampleRate}}`;
    },
  };
}

function sanitizedStringAttribute(
  key: string,
  value: string,
  hmacKey: Buffer,
  captureMode: TelemetryCaptureMode
) {
  const lowerKey = key.toLowerCase();
  const identifierAttribute =
    lowerKey === LangfuseOtelSpanAttributes.TRACE_USER_ID ||
    lowerKey === LangfuseOtelSpanAttributes.TRACE_SESSION_ID ||
    lowerKey === LangfuseOtelSpanAttributes.TRACE_COMPAT_USER_ID ||
    lowerKey === LangfuseOtelSpanAttributes.TRACE_COMPAT_SESSION_ID;
  if (identifierAttribute) {
    return value.startsWith("lfh_")
      ? value
      : pseudonymizeTelemetryId(lowerKey, value, hmacKey);
  }
  const structuredAttribute =
    lowerKey === LangfuseOtelSpanAttributes.OBSERVATION_INPUT ||
    lowerKey === LangfuseOtelSpanAttributes.TRACE_INPUT ||
    lowerKey === LangfuseOtelSpanAttributes.OBSERVATION_OUTPUT ||
    lowerKey === LangfuseOtelSpanAttributes.TRACE_OUTPUT ||
    lowerKey === LangfuseOtelSpanAttributes.OBSERVATION_METADATA ||
    lowerKey === LangfuseOtelSpanAttributes.TRACE_METADATA ||
    lowerKey === LangfuseOtelSpanAttributes.OBSERVATION_MODEL_PARAMETERS ||
    lowerKey === LangfuseOtelSpanAttributes.OBSERVATION_USAGE_DETAILS ||
    lowerKey === LangfuseOtelSpanAttributes.OBSERVATION_COST_DETAILS;
  if (structuredAttribute) {
    const sanitized = redactTelemetry(value, { hmacKey, captureMode });
    return typeof sanitized === "string"
      ? sanitized
      : JSON.stringify(sanitized);
  }
  const observationMetadataPrefix = `${LangfuseOtelSpanAttributes.OBSERVATION_METADATA}.`;
  const traceMetadataPrefix = `${LangfuseOtelSpanAttributes.TRACE_METADATA}.`;
  if (
    lowerKey.startsWith(observationMetadataPrefix) ||
    lowerKey.startsWith(traceMetadataPrefix)
  ) {
    const prefix = lowerKey.startsWith(observationMetadataPrefix)
      ? observationMetadataPrefix
      : traceMetadataPrefix;
    const logicalKey = key.slice(prefix.length);
    const sanitized = redactTelemetry(
      { [logicalKey]: value },
      { hmacKey, captureMode }
    );
    return sanitized && typeof sanitized === "object"
      ? (sanitized as Record<string, unknown>)[logicalKey]
      : TELEMETRY_REDACTED;
  }
  if (
    lowerKey === LangfuseOtelSpanAttributes.OBSERVATION_COMPLETION_START_TIME
  ) {
    try {
      const timestamp = JSON.parse(value) as unknown;
      return typeof timestamp === "string" &&
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(timestamp)
        ? JSON.stringify(timestamp)
        : TELEMETRY_REDACTED;
    } catch {
      return TELEMETRY_REDACTED;
    }
  }
  if (
    lowerKey === LangfuseOtelSpanAttributes.TRACE_NAME ||
    lowerKey === LangfuseOtelSpanAttributes.OBSERVATION_TYPE ||
    lowerKey === LangfuseOtelSpanAttributes.OBSERVATION_LEVEL ||
    lowerKey === LangfuseOtelSpanAttributes.OBSERVATION_MODEL ||
    lowerKey === LangfuseOtelSpanAttributes.ENVIRONMENT ||
    lowerKey === LangfuseOtelSpanAttributes.RELEASE ||
    lowerKey === LangfuseOtelSpanAttributes.VERSION ||
    lowerKey.includes("model") ||
    lowerKey.includes("environment") ||
    lowerKey.includes("release") ||
    lowerKey.endsWith(".type")
  ) {
    return safeTelemetryToken(value, "unclassified");
  }
  const masked = redactTelemetry({ [key]: value }, { hmacKey, captureMode });
  if (masked && typeof masked === "object" && !Array.isArray(masked)) {
    return (masked as Record<string, unknown>)[key];
  }
  return TELEMETRY_REDACTED;
}

function scrubReadableSpan(
  span: Parameters<LangfuseSpanProcessor["onEnd"]>[0],
  hmacKey: Buffer,
  captureMode: TelemetryCaptureMode
) {
  const mutable = span as typeof span & { name: string };
  mutable.name = safeTelemetryToken(mutable.name, "observed-operation");

  for (const [key, value] of Object.entries(mutable.attributes)) {
    if (typeof value === "number" || typeof value === "boolean") continue;
    if (Array.isArray(value)) {
      mutable.attributes[key] =
        key.toLowerCase() === LangfuseOtelSpanAttributes.TRACE_TAGS
          ? value.map(item => safeTelemetryToken(String(item), "unclassified"))
          : value.map(item =>
              String(
                sanitizedStringAttribute(
                  key,
                  String(item),
                  hmacKey,
                  captureMode
                )
              )
            );
      continue;
    }
    mutable.attributes[key] = String(
      sanitizedStringAttribute(key, String(value), hmacKey, captureMode)
    );
  }

  if (mutable.status.message) {
    mutable.status.message = "operation_failed";
  }
  for (const event of mutable.events) {
    if (!event.attributes) continue;
    for (const [key, value] of Object.entries(event.attributes)) {
      if (typeof value === "number" || typeof value === "boolean") continue;
      event.attributes[key] = TELEMETRY_REDACTED;
    }
  }
}

class PrivacyFirstLangfuseSpanProcessor extends LangfuseSpanProcessor {
  constructor(
    params: ConstructorParameters<typeof LangfuseSpanProcessor>[0],
    private readonly privacy: {
      hmacKey: Buffer;
      captureMode: TelemetryCaptureMode;
    }
  ) {
    super(params);
  }

  override onEnd(span: Parameters<LangfuseSpanProcessor["onEnd"]>[0]) {
    try {
      scrubReadableSpan(span, this.privacy.hmacKey, this.privacy.captureMode);
    } catch {
      for (const key of Object.keys(span.attributes)) {
        if (typeof span.attributes[key] === "string") {
          span.attributes[key] = TELEMETRY_REDACTED;
        }
      }
    }
    super.onEnd(span);
  }
}

class PrivacyFirstCallbackHandler extends CallbackHandler {
  override handleChainError(
    _error: unknown,
    runId: string,
    parentRunId?: string
  ) {
    return super.handleChainError(
      new Error("operation_failed"),
      runId,
      parentRunId
    );
  }

  override handleRetrieverError(
    _error: unknown,
    runId: string,
    parentRunId?: string
  ) {
    return super.handleRetrieverError(
      new Error("operation_failed"),
      runId,
      parentRunId
    );
  }

  override handleToolError(
    _error: unknown,
    runId: string,
    parentRunId?: string
  ) {
    return super.handleToolError(
      new Error("operation_failed"),
      runId,
      parentRunId
    );
  }

  override handleLLMError(
    _error: unknown,
    runId: string,
    parentRunId?: string
  ) {
    return super.handleLLMError(
      new Error("operation_failed"),
      runId,
      parentRunId
    );
  }
}

function createRuntime(
  configuration: ReturnType<typeof normalizeRuntimeConfiguration>
) {
  const processor = new PrivacyFirstLangfuseSpanProcessor(
    {
      publicKey: configuration.publicKey,
      secretKey: configuration.secretKey,
      baseUrl: configuration.baseUrl,
      environment: configuration.environment,
      release: configuration.release,
      flushAt: 10,
      // The Langfuse v5 option is expressed in seconds (internally × 1,000).
      flushInterval: 1,
      timeout: 5,
      exportMode: "batched",
      mediaUploadEnabled: false,
      mask: ({ data }) =>
        redactTelemetry(data, {
          hmacKey: configuration.hmacKey,
          captureMode: configuration.captureMode,
        }),
    },
    {
      hmacKey: configuration.hmacKey,
      captureMode: configuration.captureMode,
    }
  );
  const sdk = new NodeSDK({
    autoDetectResources: false,
    serviceName: SERVICE_NAME,
    sampler: ratioSampler(configuration.sampleRate),
    spanProcessors: [processor],
  });
  sdk.start();
  return {
    sdk,
    processor,
    fingerprint: configuration.fingerprint,
    hmacKey: configuration.hmacKey,
    status: {
      state: "ready" as const,
      enabled: true as const,
      baseUrl: configuration.baseUrl,
      environment: configuration.environment,
      captureMode: configuration.captureMode,
      sampleRate: configuration.sampleRate,
      release: configuration.release,
    },
  };
}

async function probeConfiguration(
  configuration: ReturnType<typeof normalizeRuntimeConfiguration>
) {
  const client = new LangfuseClient({
    publicKey: configuration.publicKey,
    secretKey: configuration.secretKey,
    baseUrl: configuration.baseUrl,
    timeout: 5,
  });
  try {
    await client.api.projects.get({ timeoutInSeconds: 5, maxRetries: 0 });
  } finally {
    await client.shutdown().catch(() => undefined);
  }
}

function resetOpenTelemetryGlobals() {
  setLangfuseTracerProvider(null);
  trace.disable();
  context.disable();
  propagation.disable();
}

async function stopRuntime(runtime: ActiveRuntime) {
  await runtime.processor.forceFlush().catch(() => undefined);
  await runtime.sdk.shutdown().catch(() => undefined);
  resetOpenTelemetryGlobals();
}

function failedStatus(
  reasonCode: LangfuseReasonCode,
  state: LangfuseOperationalState = "failed"
): LangfuseObservabilityStatus {
  return { state, enabled: false, reasonCode };
}

export async function initializeLangfuse(
  rawConfiguration: LangfuseRuntimeConfiguration
): Promise<LangfuseObservabilityStatus> {
  return serialized(async () => {
    if (!rawConfiguration.enabled) {
      const previous = activeRuntime;
      activeRuntime = null;
      currentStatus = failedStatus("DISABLED", "disabled");
      if (previous) await stopRuntime(previous);
      return { ...currentStatus };
    }
    let configuration: ReturnType<typeof normalizeRuntimeConfiguration>;
    try {
      configuration = normalizeRuntimeConfiguration(rawConfiguration);
    } catch (error) {
      const reasonCode =
        error instanceof ConfigurationError
          ? error.reasonCode
          : "INITIALIZATION_FAILED";
      if (reasonCode === "MISSING_CREDENTIALS" && activeRuntime) {
        const previous = activeRuntime;
        activeRuntime = null;
        currentStatus = failedStatus("MISSING_CREDENTIALS", "disabled");
        await stopRuntime(previous);
        return { ...currentStatus };
      }
      if (activeRuntime) return { ...activeRuntime.status, reasonCode };
      currentStatus = failedStatus(
        reasonCode,
        reasonCode === "DISABLED" ? "disabled" : "failed"
      );
      return { ...currentStatus };
    }

    if (
      activeRuntime &&
      sameOpaqueFingerprint(
        activeRuntime.fingerprint,
        configuration.fingerprint
      )
    ) {
      currentStatus = activeRuntime.status;
      return { ...currentStatus };
    }

    const previous = activeRuntime;
    currentStatus = {
      state: previous ? "rotating" : "initializing",
      enabled: false,
      baseUrl: configuration.baseUrl,
      environment: configuration.environment,
      captureMode: configuration.captureMode,
      sampleRate: configuration.sampleRate,
      release: configuration.release,
    };

    if (previous) {
      try {
        await probeConfiguration(configuration);
      } catch {
        currentStatus = {
          ...previous.status,
          reasonCode: "ROTATION_REJECTED",
        };
        return { ...currentStatus };
      }
      activeRuntime = null;
      await stopRuntime(previous);
    }

    try {
      const runtime = createRuntime(configuration);
      activeRuntime = runtime;
      currentStatus = runtime.status;
    } catch {
      resetOpenTelemetryGlobals();
      activeRuntime = null;
      currentStatus = failedStatus("INITIALIZATION_FAILED");
    }
    return { ...currentStatus };
  });
}

function configurationFromSettings(
  settings: Awaited<ReturnType<typeof getAgentRuntimeSettings>>,
  options: LangfuseInitializationOptions
): LangfuseRuntimeConfiguration {
  const extended = settings as typeof settings & {
    langfuseEnabled?: boolean;
    langfuseCaptureMode?: TelemetryCaptureMode;
    langfuseSampleRate?: number;
  };
  return {
    enabled: extended.langfuseEnabled ?? true,
    publicKey: settings.secrets.langfuse_public_key,
    secretKey: settings.secrets.langfuse_secret_key,
    baseUrl: settings.langfuseBaseUrl,
    environment: settings.langfuseEnvironment,
    captureMode: extended.langfuseCaptureMode ?? "metadata_only",
    sampleRate: extended.langfuseSampleRate ?? 1,
    release: options.release ?? DEFAULT_RELEASE,
    allowedSelfHostedOrigins: options.allowedSelfHostedOrigins,
    pseudonymizationSecret:
      options.pseudonymizationSecret ??
      process.env.LANGFUSE_PSEUDONYMIZATION_KEY ??
      process.env.AGENT_SETTINGS_ENCRYPTION_KEY,
  };
}

export async function initializeLangfuseFromDatabase(
  pool: Pool,
  options: LangfuseInitializationOptions = {}
) {
  try {
    const settings = await getAgentRuntimeSettings(pool);
    return initializeLangfuse(configurationFromSettings(settings, options));
  } catch {
    if (activeRuntime) return { ...activeRuntime.status };
    currentStatus = failedStatus("MISSING_CREDENTIALS");
    return { ...currentStatus };
  }
}

export function getLangfuseObservabilityStatus() {
  return { ...currentStatus };
}

function privacyOptions(runtime: ActiveRuntime) {
  return {
    hmacKey: runtime.hmacKey,
    captureMode: runtime.status.captureMode,
  };
}

function safeIdentifier(
  namespace: string,
  value: string | number | null | undefined,
  runtime: ActiveRuntime
) {
  if (value === null || value === undefined || String(value).trim() === "") {
    return undefined;
  }
  const candidate = String(value);
  return candidate.startsWith("lfh_")
    ? candidate
    : pseudonymizeTelemetryId(namespace, candidate, runtime.hmacKey);
}

function safeTags(tags: string[] | undefined) {
  return tags
    ?.map(tag => safeTelemetryToken(tag, ""))
    .filter((tag): tag is string => !!tag)
    .slice(0, 20);
}

function propagatedMetadata(
  metadata: Record<string, unknown> | undefined,
  runtime: ActiveRuntime
) {
  const sanitized = sanitizeTelemetryRecord(metadata, privacyOptions(runtime));
  if (!sanitized) return undefined;
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(sanitized)) {
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      output[key] = String(value).slice(0, 200);
    }
  }
  return output;
}

function safeObservationUpdate(
  observation: LangfuseObservation,
  attributes: LangfuseObservationUpdate,
  runtime: ActiveRuntime
) {
  const privacy = privacyOptions(runtime);
  const update = {
    ...(runtime.status.captureMode === "redacted" && "output" in attributes
      ? { output: redactTelemetry(attributes.output, privacy) }
      : {}),
    metadata: sanitizeTelemetryRecord(attributes.metadata, privacy),
    level: attributes.level,
    statusMessage: attributes.statusMessage
      ? safeTelemetryToken(attributes.statusMessage, "operation_failed")
      : undefined,
    model: attributes.model
      ? safeTelemetryToken(attributes.model, "unclassified-model")
      : undefined,
    modelParameters: sanitizeTelemetryRecord(
      attributes.modelParameters,
      privacy
    ) as Record<string, string | number> | undefined,
    usageDetails: attributes.usageDetails,
    costDetails: attributes.costDetails,
  };
  try {
    // Every concrete Langfuse observation implements update; the union's
    // overloads are narrower than the common runtime contract.
    (
      observation as LangfuseObservation & {
        update(value: typeof update): LangfuseObservation;
      }
    ).update(update);
  } catch {
    // Telemetry must not alter the business result.
  }
}

const NOOP_OBSERVATION: SafeLangfuseObservation = Object.freeze({
  id: null,
  traceId: null,
  update: () => undefined,
});

export async function withLangfuseObservation<T>(
  options: LangfuseObservationOptions,
  fn: (observation: SafeLangfuseObservation) => T | Promise<T>
): Promise<T> {
  const runtime = activeRuntime;
  if (!runtime || currentStatus.state !== "ready") {
    return await fn(NOOP_OBSERVATION);
  }

  const privacy = privacyOptions(runtime);
  const name = safeTelemetryToken(options.name, "observed-operation");
  let businessInvoked = false;
  let businessCompleted = false;
  let businessResult: T | undefined;
  let businessError: unknown;

  try {
    return await startActiveObservation(
      name,
      async observation => {
        const adapter: SafeLangfuseObservation = {
          id: observation.id,
          traceId: observation.traceId,
          update: attributes =>
            safeObservationUpdate(observation, attributes, runtime),
        };
        const propagationInput = {
          traceName: options.traceName
            ? safeTelemetryToken(options.traceName, name)
            : name,
          userId: safeIdentifier("user", options.userId, runtime),
          sessionId: safeIdentifier("session", options.sessionId, runtime),
          tags: safeTags(options.tags),
          metadata: propagatedMetadata(options.metadata, runtime),
          version: options.version
            ? safeTelemetryToken(
                options.version,
                runtime.status.release ?? DEFAULT_RELEASE
              )
            : runtime.status.release,
          environment: runtime.status.environment,
          asBaggage: false,
        };
        return await propagateAttributes(propagationInput, async () => {
          businessInvoked = true;
          try {
            businessResult = await fn(adapter);
            businessCompleted = true;
            return businessResult;
          } catch (error) {
            businessError = error;
            adapter.update({ level: "ERROR", statusMessage: "business_error" });
            throw error;
          }
        });
      },
      {
        asType: options.asType ?? "span",
        ...(runtime.status.captureMode === "redacted" && "input" in options
          ? { input: redactTelemetry(options.input, privacy) }
          : {}),
        metadata: sanitizeTelemetryRecord(options.metadata, privacy),
        version: options.version
          ? safeTelemetryToken(
              options.version,
              runtime.status.release ?? DEFAULT_RELEASE
            )
          : runtime.status.release,
        environment: runtime.status.environment,
      } as never
    );
  } catch (error) {
    if (businessError !== undefined) throw businessError;
    if (businessCompleted) return businessResult as T;
    if (!businessInvoked) return await fn(NOOP_OBSERVATION);
    throw error;
  }
}

export function createLangfuseCallbackHandler(
  options: LangfuseCallbackOptions = {}
) {
  const runtime = activeRuntime;
  if (!runtime || currentStatus.state !== "ready") return null;
  try {
    return new PrivacyFirstCallbackHandler({
      userId: safeIdentifier("user", options.userId, runtime),
      sessionId: safeIdentifier("session", options.sessionId, runtime),
      tags: safeTags(options.tags),
      version: options.version
        ? safeTelemetryToken(
            options.version,
            runtime.status.release ?? DEFAULT_RELEASE
          )
        : runtime.status.release,
      traceMetadata: sanitizeTelemetryRecord(
        options.traceMetadata,
        privacyOptions(runtime)
      ),
    });
  } catch {
    return null;
  }
}

export function observeOpenAIClient<SDKType extends object>(
  client: SDKType,
  options: LangfuseOpenAIOptions = {}
): SDKType {
  const runtime = activeRuntime;
  if (!runtime || currentStatus.state !== "ready") return client;
  const config: LangfuseConfig = {
    traceName: options.traceName
      ? safeTelemetryToken(options.traceName, "openai-operation")
      : undefined,
    sessionId: safeIdentifier("session", options.sessionId, runtime),
    userId: safeIdentifier("user", options.userId, runtime),
    tags: safeTags(options.tags),
    generationName: options.generationName
      ? safeTelemetryToken(options.generationName, "openai-generation")
      : undefined,
    generationMetadata: sanitizeTelemetryRecord(
      options.generationMetadata,
      privacyOptions(runtime)
    ),
  };
  try {
    return observeOpenAI(client, config);
  } catch {
    return client;
  }
}

export async function flushLangfuse() {
  const runtime = activeRuntime;
  if (!runtime) return false;
  try {
    await runtime.processor.forceFlush();
    return true;
  } catch {
    return false;
  }
}

export async function shutdownLangfuse() {
  return serialized(async () => {
    const runtime = activeRuntime;
    activeRuntime = null;
    if (runtime) await stopRuntime(runtime);
    currentStatus = failedStatus("STOPPED", "stopped");
  });
}

function connectionReason(error: unknown): LangfuseReasonCode {
  if (error instanceof ConfigurationError) return error.reasonCode;
  const status =
    error && typeof error === "object" && "statusCode" in error
      ? Number((error as { statusCode?: unknown }).statusCode)
      : error && typeof error === "object" && "status" in error
        ? Number((error as { status?: unknown }).status)
        : null;
  return status === 401 || status === 403
    ? "AUTHENTICATION_FAILED"
    : "CONNECTION_FAILED";
}

export type LangfuseVerificationResult =
  | {
      ok: true;
      projects: 1;
      traceId: string;
      baseUrl: string;
      environment: string;
    }
  | {
      ok: false;
      projects: 0;
      traceId: null;
      reasonCode: LangfuseReasonCode;
    };

export async function verifyLangfuseConnectionFromDatabase(
  pool: Pool,
  options: LangfuseInitializationOptions = {}
): Promise<LangfuseVerificationResult> {
  let configuration: LangfuseRuntimeConfiguration;
  let normalized: ReturnType<typeof normalizeRuntimeConfiguration>;
  try {
    const settings = await getAgentRuntimeSettings(pool);
    configuration = configurationFromSettings(settings, options);
    normalized = normalizeRuntimeConfiguration(configuration);
    await probeConfiguration(normalized);
  } catch (error) {
    return {
      ok: false,
      projects: 0,
      traceId: null,
      reasonCode: connectionReason(error),
    };
  }

  const status = await initializeLangfuse(configuration);
  if (
    status.state !== "ready" ||
    !activeRuntime ||
    !sameOpaqueFingerprint(activeRuntime.fingerprint, normalized.fingerprint)
  ) {
    return {
      ok: false,
      projects: 0,
      traceId: null,
      reasonCode: status.reasonCode ?? "INITIALIZATION_FAILED",
    };
  }

  let traceId: string | null = null;
  await withLangfuseObservation(
    {
      name: "langfuse-connection-verification",
      asType: "span",
      traceName: "langfuse-connection-verification",
      tags: ["configuration", "verification"],
      metadata: { operation: "connection-verification", outcome: "success" },
      version: status.release,
    },
    observation => {
      traceId = observation.traceId;
      observation.update({
        output: { status: "success" },
        metadata: { outcome: "success" },
      });
    }
  );
  if (!traceId || !(await flushLangfuse())) {
    return {
      ok: false,
      projects: 0,
      traceId: null,
      reasonCode: "CONNECTION_FAILED",
    };
  }
  return {
    ok: true,
    projects: 1,
    traceId,
    baseUrl: normalized.baseUrl,
    environment: normalized.environment,
  };
}

export const __langfuseTesting = {
  reset: async () => {
    await shutdownLangfuse();
    currentStatus = {
      state: "disabled",
      enabled: false,
      reasonCode: "DISABLED",
    };
  },
};
