import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import express, { type Express, type RequestHandler } from "express";
import type { Pool } from "pg";
import { z } from "zod";
import {
  verifyApiChatInboundLink,
  verifyApiChatInboundLocation,
  verifyApiChatInboundText,
  verifyApiChatOutboundLink,
  verifyApiChatOutboundLocation,
  verifyApiChatOutboundText,
} from "./apichat";
import {
  getApiChatRuntimeSettings,
  getApiChatWebhookSecret,
} from "./apiChatSettings";
import { getPool } from "./db";
import {
  recordNormalizedInboundLink,
  recordNormalizedInboundLocation,
  recordNormalizedInboundText,
  recordNormalizedOutboundLink,
  recordNormalizedOutboundLocation,
  recordNormalizedOutboundText,
} from "./inbox";
import { withLangfuseObservation } from "./observability/langfuse";

export const APICHAT_NORMALIZED_WEBHOOK_PATH = "/api/webhooks/apichat/incoming";

const providerMessageId = z
  .string()
  .trim()
  .min(1)
  .max(180)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, {
    message: "providerMessageId contiene caracteres no admitidos.",
  });

const phoneInternational = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{7,14}$/, {
    message: "phoneInternational debe utilizar el formato E.164.",
  });

const secureHttpsUrl = z
  .string()
  .trim()
  .max(2_000)
  .refine(value => {
    try {
      const parsed = new URL(value);
      return (
        parsed.protocol === "https:" && !parsed.username && !parsed.password
      );
    } catch {
      return false;
    }
  }, "El enlace debe utilizar HTTPS y no debe incluir credenciales.");

export const NormalizedInboundTextSchema = z.discriminatedUnion(
  "messageType",
  [
    z
      .object({
        providerMessageId,
        phoneInternational,
        messageType: z.literal("text"),
        text: z.string().trim().min(1).max(10_000),
        direction: z.enum(["inbound", "outbound"]).optional(),
      })
      .strict(),
    z
      .object({
        providerMessageId,
        phoneInternational,
        messageType: z.literal("link"),
        link: secureHttpsUrl,
        caption: z.string().trim().max(1_000).optional(),
        direction: z.enum(["inbound", "outbound"]).optional(),
      })
      .strict(),
    z
      .object({
        providerMessageId,
        phoneInternational,
        messageType: z.literal("location"),
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        address: z.string().trim().max(300).optional(),
        direction: z.enum(["inbound", "outbound"]).optional(),
      })
      .strict(),
  ]
);

export const NormalizedInboundEventSchema = NormalizedInboundTextSchema;

export type NormalizedInboundEvent = z.infer<
  typeof NormalizedInboundTextSchema
>;

export type NormalizedInboundText = Extract<
  NormalizedInboundEvent,
  { messageType: "text" }
>;

export type InboundRecordInput = {
  applicationId: number;
  conversationId: number;
  providerMessageId: string;
  phoneInternational: string;
  direction: "inbound" | "outbound";
} & (
  | { messageType: "text"; text: string }
  | { messageType: "link"; link: string; caption?: string }
  | {
      messageType: "location";
      latitude: number;
      longitude: number;
      address?: string;
    }
);

export type InboundConversationResolution =
  | {
      kind: "resolved";
      applicationId: number;
      conversationId: number;
    }
  | { kind: "unmatched" }
  | { kind: "ambiguous" };

type WebhookPool = Pick<Pool, "query"> & Partial<Pick<Pool, "connect">>;

export function bearerToken(header: string | undefined) {
  if (!header) return null;
  const match = /^Bearer ([^\s]+)$/.exec(header.trim());
  return match?.[1] ?? null;
}

export function bearerMatchesSecret(
  authorization: string | undefined,
  expectedSecret: string
) {
  const supplied = bearerToken(authorization) ?? "";
  const suppliedDigest = createHash("sha256").update(supplied).digest();
  const expectedDigest = createHash("sha256").update(expectedSecret).digest();
  return supplied.length > 0 && timingSafeEqual(suppliedDigest, expectedDigest);
}

export function quarantineFingerprint(secret: string, value: string) {
  return createHmac("sha256", secret).update(value, "utf8").digest("hex");
}

export async function resolveInboundConversation(
  pool: WebhookPool,
  phoneInternational: string
): Promise<InboundConversationResolution> {
  return withLangfuseObservation(
    {
      name: "apichat.webhook.resolve_conversation",
      asType: "retriever",
      metadata: {
        provider: "apichat",
        operation: "resolve_conversation",
        destinationDigits: phoneInternational.replace(/\D/g, "").length,
      },
    },
    async observation => {
      const result = await pool.query<{
        application_id: number;
        conversation_id: number;
      }>(
        `SELECT a.id AS application_id,conv.id AS conversation_id
           FROM candidates c
           JOIN applications a ON a.candidate_id=c.id
           JOIN conversations conv ON conv.application_id=a.id
          WHERE c.phone_international=$1
            AND conv.provider='apichat'
            AND conv.status IN ('pendiente','activo')
          ORDER BY conv.id
          LIMIT 2`,
        [phoneInternational]
      );
      const resolution: InboundConversationResolution =
        result.rows.length === 0
          ? { kind: "unmatched" }
          : result.rows.length > 1
            ? { kind: "ambiguous" }
            : {
                kind: "resolved",
                applicationId: result.rows[0].application_id,
                conversationId: result.rows[0].conversation_id,
              };
      observation.update({
        output: { status: "completed" },
        metadata: {
          outcome: resolution.kind,
          matchCount: result.rows.length,
        },
      });
      return resolution;
    }
  );
}

export async function quarantineUnknownInboundText(
  pool: WebhookPool,
  input: {
    providerMessageId: string;
    phoneInternational: string;
    webhookSecret: string;
    reason: "sin_conversacion_activa" | "conversacion_ambigua";
  }
) {
  return withLangfuseObservation(
    {
      name: "apichat.webhook.quarantine",
      asType: "guardrail",
      tags: ["apichat", "inbound", "quarantine"],
      metadata: {
        provider: "apichat",
        operation: "quarantine_inbound",
        outcome: input.reason,
        destinationDigits: input.phoneInternational.replace(/\D/g, "").length,
      },
    },
    async observation => {
      const providerMessageHash = quarantineFingerprint(
        input.webhookSecret,
        `message:${input.providerMessageId}`
      );
      const phoneFingerprint = quarantineFingerprint(
        input.webhookSecret,
        `phone:${input.phoneInternational}`
      );
      const result = await pool.query<{ id: number }>(
        `INSERT INTO inbound_message_quarantine
           (provider,provider_message_hash,phone_fingerprint,reason)
         VALUES ('apichat_normalized',$1,$2,$3)
         ON CONFLICT (provider,provider_message_hash) DO UPDATE
           SET occurrence_count=inbound_message_quarantine.occurrence_count+1,
               last_received_at=now()
         RETURNING id`,
        [providerMessageHash, phoneFingerprint, input.reason]
      );
      const quarantineId = result.rows[0]?.id ?? null;
      observation.update({
        output: { status: "completed" },
        metadata: {
          outcome: input.reason,
          persisted: quarantineId !== null,
        },
      });
      return { quarantineId };
    }
  );
}

type WebhookDependencies = {
  pool: () => Promise<WebhookPool | null>;
  secret: (pool: WebhookPool) => Promise<string | null>;
  resolveConversation: (
    pool: WebhookPool,
    phoneInternational: string
  ) => Promise<InboundConversationResolution>;
  verifyProvider: (
    pool: WebhookPool,
    event: NormalizedInboundEvent
  ) => Promise<boolean>;
  recordInbound: (
    pool: WebhookPool,
    input: InboundRecordInput
  ) => Promise<{ inserted: boolean; conversationId: number }>;
  quarantineUnknown: (
    pool: WebhookPool,
    input: {
      providerMessageId: string;
      phoneInternational: string;
      webhookSecret: string;
      reason: "sin_conversacion_activa" | "conversacion_ambigua";
    }
  ) => Promise<{ quarantineId: number | null }>;
};

async function verifyProviderDefault(
  pool: WebhookPool,
  event: NormalizedInboundEvent
) {
  const settings = await getApiChatRuntimeSettings(pool as Pool);
  const outbound = event.direction === "outbound";
  if (event.messageType === "link") {
    return outbound
      ? verifyApiChatOutboundLink(
          {
            providerMessageId: event.providerMessageId,
            phoneInternational: event.phoneInternational,
            link: event.link,
          },
          settings
        )
      : verifyApiChatInboundLink(
          {
            providerMessageId: event.providerMessageId,
            phoneInternational: event.phoneInternational,
            link: event.link,
          },
          settings
        );
  }
  if (event.messageType === "location") {
    return outbound
      ? verifyApiChatOutboundLocation(
          {
            providerMessageId: event.providerMessageId,
            phoneInternational: event.phoneInternational,
            latitude: event.latitude,
            longitude: event.longitude,
          },
          settings
        )
      : verifyApiChatInboundLocation(
          {
            providerMessageId: event.providerMessageId,
            phoneInternational: event.phoneInternational,
            latitude: event.latitude,
            longitude: event.longitude,
          },
          settings
        );
  }
  return outbound
    ? verifyApiChatOutboundText(
        {
          providerMessageId: event.providerMessageId,
          phoneInternational: event.phoneInternational,
          text: event.text,
        },
        settings
      )
    : verifyApiChatInboundText(
        {
          providerMessageId: event.providerMessageId,
          phoneInternational: event.phoneInternational,
          text: event.text,
        },
        settings
      );
}

function recordInboundDefault(
  pool: WebhookPool,
  input: InboundRecordInput
) {
  const record = input.direction === "outbound"
    ? {
        text: recordNormalizedOutboundText,
        link: recordNormalizedOutboundLink,
        location: recordNormalizedOutboundLocation,
      }
    : {
        text: recordNormalizedInboundText,
        link: recordNormalizedInboundLink,
        location: recordNormalizedInboundLocation,
      };
  const base = {
    applicationId: input.applicationId,
    conversationId: input.conversationId,
    providerMessageId: input.providerMessageId,
    phoneInternational: input.phoneInternational,
  };
  if (input.messageType === "link") {
    return record.link(pool as Pool, {
      ...base,
      link: input.link,
      caption: input.caption,
    });
  }
  if (input.messageType === "location") {
    return record.location(pool as Pool, {
      ...base,
      latitude: input.latitude,
      longitude: input.longitude,
      address: input.address,
    });
  }
  return record.text(pool as Pool, { ...base, text: input.text });
}

const defaultDependencies: WebhookDependencies = {
  pool: getPool,
  secret: pool => getApiChatWebhookSecret(pool as Pool),
  verifyProvider: verifyProviderDefault,
  resolveConversation: resolveInboundConversation,
  recordInbound: recordInboundDefault,
  quarantineUnknown: quarantineUnknownInboundText,
};

export function createApiChatInboundWebhookHandler(
  overrides: Partial<WebhookDependencies> = {}
): RequestHandler {
  const dependencies = { ...defaultDependencies, ...overrides };
  return async (request, response) => {
    await withLangfuseObservation(
      {
        name: "apichat.webhook.receive",
        asType: "chain",
        traceName: "apichat-inbound-webhook",
        tags: ["apichat", "webhook", "inbound"],
        metadata: {
          provider: "apichat",
          operation: "receive_webhook",
        },
      },
      async observation => {
        try {
          const pool = await dependencies.pool();
          if (!pool) {
            observation.update({
              metadata: { outcome: "database_unavailable", statusCode: 503 },
            });
            response.status(503).json({
              accepted: false,
              error: "El receptor no tiene conexión con PostgreSQL.",
            });
            return;
          }
          const secret = await dependencies.secret(pool);
          if (!secret) {
            observation.update({
              metadata: { outcome: "configuration_missing", statusCode: 503 },
            });
            response.status(503).json({
              accepted: false,
              error: "El secreto del webhook no está configurado.",
            });
            return;
          }
          if (!bearerMatchesSecret(request.get("authorization"), secret)) {
            observation.update({
              metadata: { outcome: "unauthorized", statusCode: 401 },
            });
            response
              .status(401)
              .json({ accepted: false, error: "No autorizado." });
            return;
          }

          const parsed = NormalizedInboundTextSchema.safeParse(request.body);
          if (!parsed.success) {
            observation.update({
              metadata: { outcome: "invalid_payload", statusCode: 400 },
            });
            response.status(400).json({
              accepted: false,
              error: "El evento normalizado de la bandeja no es válido.",
            });
            return;
          }
          const event = parsed.data;
          const providerVerified = await dependencies.verifyProvider(
            pool,
            event
          );
          if (!providerVerified) {
            observation.update({
              metadata: { outcome: "not_verified", statusCode: 422 },
            });
            response.status(422).json({
              accepted: false,
              error: "El mensaje no pudo verificarse con ApiChat.",
            });
            return;
          }
          const resolution = await dependencies.resolveConversation(
            pool,
            event.phoneInternational
          );
          if (resolution.kind !== "resolved") {
            await dependencies.quarantineUnknown(pool, {
              providerMessageId: event.providerMessageId,
              phoneInternational: event.phoneInternational,
              webhookSecret: secret,
              reason:
                resolution.kind === "ambiguous"
                  ? "conversacion_ambigua"
                  : "sin_conversacion_activa",
            });
            if (resolution.kind === "ambiguous") {
              observation.update({
                output: { status: "completed" },
                metadata: {
                  outcome: "quarantined_ambiguous",
                  statusCode: 409,
                },
              });
              response.status(409).json({
                accepted: false,
                quarantined: true,
                error:
                  "Existe más de una conversación activa para el teléfono.",
              });
              return;
            }
            observation.update({
              output: { status: "completed" },
              metadata: {
                outcome: "quarantined_unmatched",
                statusCode: 202,
              },
            });
            response.status(202).json({ accepted: true, quarantined: true });
            return;
          }

          const recorded = await dependencies.recordInbound(pool, {
            applicationId: resolution.applicationId,
            conversationId: resolution.conversationId,
            providerMessageId: event.providerMessageId,
            phoneInternational: event.phoneInternational,
            direction: event.direction ?? "inbound",
            ...(event.messageType === "text"
              ? { messageType: "text" as const, text: event.text }
              : event.messageType === "link"
                ? { messageType: "link" as const, link: event.link, caption: event.caption }
                : {
                    messageType: "location" as const,
                    latitude: event.latitude,
                    longitude: event.longitude,
                    address: event.address,
                  }),
          });
          const statusCode = recorded.inserted ? 201 : 200;
          observation.update({
            output: { status: "completed" },
            metadata: {
              outcome: recorded.inserted ? "inserted" : "duplicate",
              statusCode,
              inserted: recorded.inserted,
            },
          });
          response.status(statusCode).json({
            accepted: true,
            duplicate: !recorded.inserted,
            conversationId: recorded.conversationId,
          });
        } catch {
          // Deliberadamente no se registra el cuerpo: puede contener datos privados.
          observation.update({
            metadata: { outcome: "internal_error", statusCode: 500 },
          });
          response.status(500).json({
            accepted: false,
            error: "No fue posible registrar el evento entrante.",
          });
        }
      }
    );
  };
}

export function registerApiChatInboundWebhook(
  app: Express,
  overrides: Partial<WebhookDependencies> = {}
) {
  app.post(
    APICHAT_NORMALIZED_WEBHOOK_PATH,
    express.json({ limit: "32kb", type: "application/json" }),
    createApiChatInboundWebhookHandler(overrides)
  );
}
