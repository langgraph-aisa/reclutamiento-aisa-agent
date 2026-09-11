import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import express, { type Express, type RequestHandler } from "express";
import type { Pool } from "pg";
import { z } from "zod";
import { verifyApiChatInboundText } from "./apichat";
import {
  getApiChatRuntimeSettings,
  getApiChatWebhookSecret,
} from "./apiChatSettings";
import { getPool } from "./db";
import { recordNormalizedInboundText } from "./inbox";

export const APICHAT_NORMALIZED_WEBHOOK_PATH = "/api/webhooks/apichat/incoming";

const providerMessageId = z
  .string()
  .trim()
  .min(1)
  .max(180)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, {
    message: "providerMessageId contiene caracteres no admitidos.",
  });

export const NormalizedInboundTextSchema = z
  .object({
    providerMessageId,
    phoneInternational: z
      .string()
      .trim()
      .regex(/^\+[1-9]\d{7,14}$/, {
        message: "phoneInternational debe utilizar el formato E.164.",
      }),
    messageType: z.literal("text"),
    text: z.string().trim().min(1).max(10_000),
  })
  .strict();

export type NormalizedInboundText = z.infer<typeof NormalizedInboundTextSchema>;

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
) : Promise<InboundConversationResolution> {
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
  if (result.rows.length === 0) return { kind: "unmatched" };
  if (result.rows.length > 1) return { kind: "ambiguous" };
  return {
    kind: "resolved",
    applicationId: result.rows[0].application_id,
    conversationId: result.rows[0].conversation_id,
  };
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
  return { quarantineId: result.rows[0]?.id ?? null };
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
    event: NormalizedInboundText
  ) => Promise<boolean>;
  recordInbound: (
    pool: WebhookPool,
    input: {
      applicationId: number;
      conversationId: number;
      providerMessageId: string;
      phoneInternational: string;
      text: string;
    }
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

const defaultDependencies: WebhookDependencies = {
  pool: getPool,
  secret: pool => getApiChatWebhookSecret(pool as Pool),
  verifyProvider: async (pool, event) =>
    verifyApiChatInboundText(
      event,
      await getApiChatRuntimeSettings(pool as Pool)
    ),
  resolveConversation: resolveInboundConversation,
  recordInbound: (pool, input) =>
    recordNormalizedInboundText(pool as Pool, input),
  quarantineUnknown: quarantineUnknownInboundText,
};

export function createApiChatInboundWebhookHandler(
  overrides: Partial<WebhookDependencies> = {}
): RequestHandler {
  const dependencies = { ...defaultDependencies, ...overrides };
  return async (request, response) => {
    try {
      const pool = await dependencies.pool();
      if (!pool) {
        response.status(503).json({
          accepted: false,
          error: "El receptor no tiene conexión con PostgreSQL.",
        });
        return;
      }
      const secret = await dependencies.secret(pool);
      if (!secret) {
        response.status(503).json({
          accepted: false,
          error: "El secreto del webhook no está configurado.",
        });
        return;
      }
      if (!bearerMatchesSecret(request.get("authorization"), secret)) {
        response.status(401).json({ accepted: false, error: "No autorizado." });
        return;
      }

      const parsed = NormalizedInboundTextSchema.safeParse(request.body);
      if (!parsed.success) {
        response.status(400).json({
          accepted: false,
          error: "El evento normalizado de texto no es válido.",
        });
        return;
      }
      const event = parsed.data;
      const providerVerified = await dependencies.verifyProvider(pool, event);
      if (!providerVerified) {
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
          response.status(409).json({
            accepted: false,
            quarantined: true,
            error: "Existe más de una conversación activa para el teléfono.",
          });
          return;
        }
        response.status(202).json({ accepted: true, quarantined: true });
        return;
      }

      const recorded = await dependencies.recordInbound(pool, {
        applicationId: resolution.applicationId,
        conversationId: resolution.conversationId,
        providerMessageId: event.providerMessageId,
        phoneInternational: event.phoneInternational,
        text: event.text,
      });
      response.status(recorded.inserted ? 201 : 200).json({
        accepted: true,
        duplicate: !recorded.inserted,
        conversationId: recorded.conversationId,
      });
    } catch {
      // Deliberadamente no se registra el cuerpo: puede contener datos privados.
      response.status(500).json({
        accepted: false,
        error: "No fue posible registrar el evento entrante.",
      });
    }
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
