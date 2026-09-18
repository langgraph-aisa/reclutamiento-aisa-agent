import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMediaTestDatabase } from "./testSupport/mediaDatabase";
import { recentAttachmentReceipts } from "./apiChatSettings";
import { apiChatChannelReport } from "./apiChatAudit";
import {
  loadTransportTraces,
  recordTransportTrace,
  summarizeTransportTrace,
} from "./transportTrace";

describe.runIf(Boolean(process.env.MEDIA_TEST_DATABASE_URL))(
  "PostgreSQL real: observabilidad de adjuntos",
  () => {
    let database: Awaited<ReturnType<typeof createMediaTestDatabase>>;
    let applicationId: number;
    beforeAll(async () => {
      database = await createMediaTestDatabase();
      const pool = database.pool;
      const candidate = (
        await pool.query(
          `INSERT INTO candidates(phone_international,full_name) VALUES('+50255550009','Prueba de observabilidad') RETURNING id`
        )
      ).rows[0].id;
      const position = (
        await pool.query(
          `INSERT INTO job_positions(public_slug,code,title,agent_key) VALUES('trace-test','trace-test','Ingeniero','test') RETURNING id`
        )
      ).rows[0].id;
      const form = (
        await pool.query(
          `INSERT INTO application_forms(job_position_id,title) VALUES($1,'Prueba') RETURNING id`,
          [position]
        )
      ).rows[0].id;
      applicationId = (
        await pool.query(
          `INSERT INTO applications(candidate_id,job_position_id,form_id) VALUES($1,$2,$3) RETURNING id`,
          [candidate, position, form]
        )
      ).rows[0].id;
    }, 60_000);
    afterAll(async () => {
      await database?.close();
    });

    it("cuenta uploaded_at de webhook y sondeo en el esquema migrado", async () => {
      for (const source of ["webhook", "sondeo", "manual"]) {
        await database.pool.query(
          `INSERT INTO candidate_knowledge_files
        (application_id,original_name,storage_key,mime_type,extension,size_bytes,source,uploaded_at)
        VALUES ($1,'prueba.pdf',$2,'application/pdf','pdf',5,$3,now())`,
          [applicationId, `trace-${source}`, source]
        );
      }
      const receipts = await recentAttachmentReceipts(database.pool);
      expect(receipts.available).toBe(true);
      expect(receipts.received).toBe(2);
      expect(receipts.lastReceivedAt).toBeInstanceOf(Date);
    });

    it("persiste JSONB minimizado y reconoce contenido en un lote anidado", async () => {
      const content = `data:application/pdf;base64,${Buffer.from("%PDF-1.7 evidencia privada").toString("base64")}`;
      const result = await recordTransportTrace(database.pool, {
        origin: "webhook",
        outcome: "aceptado-durable",
        eventId: "trace-test",
        body: {
          params: JSON.stringify({
            messages: [
              {
                type: "file",
                url: content,
                caption: "persona-confidencial",
                token: "secreto-no-almacenable",
              },
            ],
          }),
        },
      });
      expect(result.available).toBe(true);
      const traces = await loadTransportTraces(database.pool);
      expect(traces).toHaveLength(1);
      expect(summarizeTransportTrace(traces).withAttachment).toBe(1);
      expect(summarizeTransportTrace(traces).discarded).toBe(0);
      const serialized = JSON.stringify(traces);
      expect(serialized).not.toContain("persona-confidencial");
      expect(serialized).not.toContain("secreto-no-almacenable");
      expect(serialized).not.toContain(content);
    });

    it("distingue fallo SQL de ausencia de tráfico", async () => {
      await database.pool.query(
        "ALTER TABLE conversation_transport_traces RENAME TO traces_temporarily_unavailable"
      );
      try {
        await expect(loadTransportTraces(database.pool)).rejects.toThrow();
        const report = await apiChatChannelReport(database.pool);
        expect(report.available).toBe(false);
        expect(report.summary.state).toBe("observabilidad_no_disponible");
        expect(report.transport.summary.state).toBe("no-disponible");
      } finally {
        await database.pool.query(
          "ALTER TABLE traces_temporarily_unavailable RENAME TO conversation_transport_traces"
        );
      }
    });
  }
);
