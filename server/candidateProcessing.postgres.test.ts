import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createMediaTestDatabase } from "./testSupport/mediaDatabase";
import { registerCandidateInboundDocument } from "./candidateKnowledge";
import { decodeTransport } from "./base64Transport";
import {
  candidateDocumentsProcessing,
  runCandidateDocumentSweep,
} from "./candidateDocumentWorker";
import {
  loadConversationContextSource,
  buildConversationContext,
} from "./conversationContext";
import { runConversationTurn } from "./conversationEngine";

const enabled = Boolean(process.env.MEDIA_TEST_DATABASE_URL);
describe.runIf(enabled)(
  "PostgreSQL y volumen reales: procesamiento durable",
  () => {
    let database: Awaited<ReturnType<typeof createMediaTestDatabase>>;
    let directory: string;
    let applicationId: number;
    let conversationId: number;
    let fileId: number;
    beforeAll(async () => {
      database = await createMediaTestDatabase();
      directory = await fs.mkdtemp(path.join(os.tmpdir(), "candidate-pg-"));
      process.env.KNOWLEDGE_STORAGE_DIR = directory;
      const pool = database.pool;
      const candidate = (
        await pool.query(
          `INSERT INTO candidates(phone_international,full_name) VALUES('+50255550002','Candidato de prueba') RETURNING id`
        )
      ).rows[0].id;
      const position = (
        await pool.query(
          `INSERT INTO job_positions(public_slug,code,title,agent_key) VALUES('processing-test','processing-test','Ingeniero','test') RETURNING id`
        )
      ).rows[0].id;
      const form = (
        await pool.query(
          `INSERT INTO application_forms(job_position_id,title) VALUES($1,'Formulario de prueba') RETURNING id`,
          [position]
        )
      ).rows[0].id;
      applicationId = (
        await pool.query(
          `INSERT INTO applications(candidate_id,job_position_id,form_id) VALUES($1,$2,$3) RETURNING id`,
          [candidate, position, form]
        )
      ).rows[0].id;
      conversationId = (
        await pool.query(
          `INSERT INTO conversations(application_id,status,agent_enabled,human_takeover,automation_state) VALUES($1,'activo',true,false,'agent') RETURNING id`,
          [applicationId]
        )
      ).rows[0].id;
    }, 60_000);
    afterAll(async () => {
      await database?.close();
      if (directory) await fs.rm(directory, { recursive: true, force: true });
    });

    it("dos entregas simultáneas conservan un binario, un documento y un trabajo", async () => {
      const decoded = decodeTransport(
        {
          dataBase64: Buffer.from("OggS-functional-audio-fixture").toString(
            "base64"
          ),
          fileName: "respuesta.ogg",
        },
        { maxBytes: 5000 }
      );
      const deliveries = await Promise.all(
        [1, 2].map(() =>
          registerCandidateInboundDocument(database.pool, {
            applicationId,
            fileName: "respuesta.ogg",
            decoded,
          })
        )
      );
      expect(deliveries.map(value => value.outcome).sort()).toEqual([
        "accepted",
        "duplicate",
      ]);
      expect(new Set(deliveries.map(value => value.id)).size).toBe(1);
      fileId = deliveries[0].id;
      expect(
        (
          await database.pool.query(
            `SELECT count(*)::int AS n FROM candidate_document_jobs`
          )
        ).rows[0].n
      ).toBe(1);
      expect(
        (
          await fs.readdir(
            path.join(directory, "applications", String(applicationId))
          )
        ).length
      ).toBe(1);
      await database.pool.query(
        `INSERT INTO conversation_messages(conversation_id,direction,message_type,body,message_key,delivery_status,metadata) VALUES($1,'inbound','file','respuesta.ogg','test-audio','received',$2::jsonb)`,
        [
          conversationId,
          JSON.stringify({
            media: { candidateFileId: fileId, fileName: "respuesta.ogg" },
          }),
        ]
      );
      expect(
        await candidateDocumentsProcessing(database.pool, applicationId)
      ).toBe(true);
      const pending = await runConversationTurn(database.pool, {
        conversationId,
      });
      expect(pending).toMatchObject({ status: "skipped" });
      expect(
        (
          await database.pool.query(
            `SELECT count(*)::int AS n FROM conversation_turns`
          )
        ).rows[0].n
      ).toBe(0);
    });

    it("workers concurrentes procesan una vez el audio, publican transcripción y liberan el turno", async () => {
      const transcribe = vi.fn(async () => ({
        text: "Tengo cinco años de experiencia en sistemas.",
        model: "test-provider",
        keySlot: "primary" as const,
        language: "es",
      }));
      const analyze = vi.fn(async () => ({
        summary: "Experiencia declarada.",
        deepAnalysis: "Cinco años de experiencia en sistemas.",
        model: "gpt-4.1-mini-2025-04-14" as const,
        keySlot: "primary" as const,
        documentClass: "other" as const,
      }));
      await Promise.all(
        [1, 2].map(() =>
          runCandidateDocumentSweep(database.pool, {
            limit: 1,
            dependencies: { transcribe, analyze },
          })
        )
      );
      expect(transcribe).toHaveBeenCalledOnce();
      expect(analyze).toHaveBeenCalledOnce();
      expect(
        await candidateDocumentsProcessing(database.pool, applicationId)
      ).toBe(false);
      const message = (
        await database.pool.query(
          `SELECT transcript FROM conversation_messages WHERE message_key='test-audio'`
        )
      ).rows[0];
      expect(message.transcript).toContain("cinco años");
      const { source } = await loadConversationContextSource(
        database.pool,
        applicationId,
        { methodologies: false }
      );
      expect(source.attachments).toHaveLength(1);
      expect(buildConversationContext(source).rendered).toContain(
        "Cinco años de experiencia"
      );
      const generator = vi.fn(async () => ({
        output: {
          reply:
            "Recibí su archivo y registré su experiencia. ¿En qué municipio reside actualmente?",
          cycleDimension: "identificacion_ajuste" as const,
          cycleQuestion: null,
          closesPreviousCycle: false,
          knowledgeNote: null,
          escalate: false,
          escalateReason: null,
        },
        responseId: "test-response",
        model: "test-model",
      }));
      const settings = async () =>
        ({
          useResponsesApi: true,
          useMethodologies: false,
          model: "test-model",
          secrets: { openai_api_key: "test-only", openai_api_key_backup: "" },
        }) as never;
      // El paso 4 ejecuta la evaluación automática tras el turno libre; la
      // prueba la sustituye para no invocar el evaluador real.
      const evaluate = vi.fn(async () => undefined);
      const outcomes = await Promise.all(
        [1, 2].map(() =>
          runConversationTurn(database.pool, {
            conversationId,
            dependencies: { generator, settings, evaluate },
          })
        )
      );
      expect(outcomes.filter(value => value.status === "sent")).toHaveLength(1);
      expect(generator).toHaveBeenCalledOnce();
      expect(evaluate).toHaveBeenCalledOnce();
      expect(
        (
          await database.pool.query(
            `SELECT count(*)::int AS n FROM conversation_messages WHERE direction='outbound'`
          )
        ).rows[0].n
      ).toBe(1);
    });
  }
);
