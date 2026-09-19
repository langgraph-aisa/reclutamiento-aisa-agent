import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createMediaTestDatabase } from "./testSupport/mediaDatabase";
import type { TrpcContext } from "./_core/context";
import {
  expedienteChangedAfterReview,
  expedienteSignals,
} from "../shared/expedienteSignal";

/**
 * Caja negra de la señalización del expediente sobre PostgreSQL real.
 *
 * La señalización sólo sirve si el servidor la expone. Se verifica el contrato
 * observable por el reclutador en las hojas donde decide:
 *
 * 1. **La bandeja declara lo que la ficha declara.** La revisión humana y el
 *    último evento del expediente viajan con la conversación, de modo que el
 *    reclutador no tenga que abrir la ficha para reconocer un expediente ya
 *    dictaminado.
 * 2. **La procedencia es el asiento, no la escritura.** Una acción sin actor
 *    identificado no acredita una revisión humana; una acción del agente no
 *    cuenta como dictamen.
 * 3. **Un cambio posterior a la revisión se declara.** Recuperar un adjunto o
 *    volver a evaluar cambia el expediente: la señal lo dice en lugar de dejar
 *    creer que el sello sigue vigente.
 */

const enabled = Boolean(process.env.MEDIA_TEST_DATABASE_URL);

describe.runIf(enabled)(
  "PostgreSQL real: señalización del expediente",
  () => {
    let database: Awaited<ReturnType<typeof createMediaTestDatabase>>;
    let reviewerId: number;
    const reviewerName = "Revisora de Señalización";
    let positionId: number;
    let formId: number;
    let reviewedId: number;
    let untouchedId: number;

    const context = () =>
      ({
        user: {
          id: reviewerId,
          openId: "email:senal@example.test",
          name: reviewerName,
          email: "senal@example.test",
          loginMethod: "email_code",
          role: "reclutador",
          active: true,
        },
        req: { headers: {} },
        res: {},
      }) as unknown as TrpcContext;

    const seedApplication = async (name: string, phone: string) => {
      const pool = database.pool;
      const candidate = Number(
        (
          await pool.query(
            `INSERT INTO candidates(phone_international,full_name)
             VALUES($1,$2) RETURNING id`,
            [phone, name]
          )
        ).rows[0].id
      );
      const application = Number(
        (
          await pool.query(
            `INSERT INTO applications(candidate_id,job_position_id,form_id,status,submitted_at)
             VALUES($1,$2,$3,'en_revision','2026-09-18T18:00:00Z') RETURNING id`,
            [candidate, positionId, formId]
          )
        ).rows[0].id
      );
      await pool.query(
        `INSERT INTO evaluations(application_id,status,reason,profile_summary,ai_payload)
         VALUES($1,'pre_calificado','Motivo sintético.','Resumen sintético.',$2::jsonb)`,
        [application, JSON.stringify({ score: 62 })]
      );
      await pool.query(
        `INSERT INTO conversations(application_id,status,automation_state)
         VALUES($1,'activa','human')`,
        [application]
      );
      return { candidate, application };
    };

    beforeAll(async () => {
      database = await createMediaTestDatabase();
      vi.stubEnv("DATABASE_URL", database.url);
      const pool = database.pool;
      reviewerId = Number(
        (
          await pool.query(
            `INSERT INTO users(open_id,role,active,name)
             VALUES('email:senal@example.test','reclutador',true,$1) RETURNING id`,
            [reviewerName]
          )
        ).rows[0].id
      );
      positionId = Number(
        (
          await pool.query(
            `INSERT INTO job_positions(public_slug,code,title,agent_key)
             VALUES('senal-test','senal-test','Desarrollador de Odoo','test') RETURNING id`
          )
        ).rows[0].id
      );
      formId = Number(
        (
          await pool.query(
            `INSERT INTO application_forms(job_position_id,title)
             VALUES($1,'Formulario de señalización') RETURNING id`,
            [positionId]
          )
        ).rows[0].id
      );
      reviewedId = (await seedApplication("Caso revisado", "+50255550201"))
        .application;
      untouchedId = (await seedApplication("Caso sin revisar", "+50255550202"))
        .application;
    }, 180_000);

    afterAll(async () => {
      const { getPool } = await import("./db");
      await (await getPool())?.end();
      await database?.close();
      vi.unstubAllEnvs();
    });

    it("publica la revisión humana y el evento del expediente en la bandeja", async () => {
      const { listInbox } = await import("./inbox");

      // Antes de la revisión la bandeja no sella nada.
      const before = await listInbox(database.pool, {
        applicationId: reviewedId,
        timeRange: "all",
      });
      expect(before.length).toBe(1);
      expect(before[0].human_review_at).toBeNull();
      expect(before[0].expediente_event_action).toBeNull();

      // La revisión humana es un asiento con actor identificado.
      const { appRouter } = await import("./routers");
      await appRouter.createCaller(context()).candidates.setStatus({
        id: reviewedId,
        status: "pendiente_revision_humana",
        comment: "Revisado con la evidencia del expediente.",
      });

      // La escritura sin actor no acredita revisión: no es un dictamen humano.
      await database.pool.query(
        `INSERT INTO audit_log(actor_user_id,entity_type,entity_id,action)
         VALUES(NULL,'application',$1,'status_changed')`,
        [untouchedId]
      );
      // Una acción del sincronizador tampoco, aunque tenga actor.
      await database.pool.query(
        `INSERT INTO audit_log(actor_user_id,entity_type,entity_id,action)
         VALUES($1,'application',$2,'inbox_human_takeover')`,
        [reviewerId, untouchedId]
      );

      const after = await listInbox(database.pool, {
        applicationId: reviewedId,
        timeRange: "all",
      });
      expect(after[0].human_review_at).toBeTruthy();
      expect(after[0].human_review_actor).toBe(reviewerName);

      const untouched = await listInbox(database.pool, {
        applicationId: untouchedId,
        timeRange: "all",
      });
      expect(untouched[0].human_review_at).toBeNull();
    });

    it("señaliza el adjunto recuperado y la re-evaluación del agente", async () => {
      const pool = database.pool;
      const fileId = Number(
        (
          await pool.query(
            `INSERT INTO candidate_knowledge_files
               (application_id,original_name,storage_key,mime_type,extension,size_bytes,source)
             VALUES($1,'SIERA-GT-SOLAR-GT.pdf',$2,'application/pdf','pdf',55296,'webhook')
             RETURNING id`,
            [reviewedId, `applications/${reviewedId}/siera.pdf`]
          )
        ).rows[0].id
      );

      // Un documento recibido antes de la revisión no declara cambio posterior.
      await pool.query(
        `INSERT INTO audit_log(actor_user_id,entity_type,entity_id,action,created_at)
         VALUES(NULL,'candidate_knowledge_file',$1,'candidate_file_received','2026-09-18T17:00:00Z')`,
        [fileId]
      );
      const { listInbox } = await import("./inbox");
      const received = (
        await listInbox(pool, { applicationId: reviewedId, timeRange: "all" })
      )[0];
      expect(received.expediente_event_action).toBe("candidate_file_received");
      expect(expedienteChangedAfterReview(received)).toBe(false);

      // La recuperación del adjunto conservado sí ocurre después: cambio.
      await pool.query(
        `INSERT INTO audit_log(actor_user_id,entity_type,entity_id,action,created_at)
         VALUES($1,'candidate_knowledge_file',$2,'candidate_file_recovered',now())`,
        [reviewerId, fileId]
      );
      const recovered = (
        await listInbox(pool, { applicationId: reviewedId, timeRange: "all" })
      )[0];
      expect(recovered.expediente_event_action).toBe("candidate_file_recovered");
      const kinds = expedienteSignals(recovered).map(signal => signal.kind);
      expect(kinds).toContain("human_review");
      expect(kinds).toContain("attachment_recovered");
      expect(expedienteChangedAfterReview(recovered)).toBe(true);

      // La re-evaluación del agente también cuenta como cambio del expediente.
      await pool.query(
        `INSERT INTO evaluations(application_id,status,reason,profile_summary,ai_payload)
         VALUES($1,'pre_calificado','Segunda pasada con el adjunto.','Resumen de la segunda pasada.',$2::jsonb)`,
        [reviewedId, JSON.stringify({ score: 78 })]
      );
      const reEvaluated = (
        await listInbox(pool, { applicationId: reviewedId, timeRange: "all" })
      )[0];
      expect(Number(reEvaluated.evaluation_count)).toBe(2);
      expect(expedienteSignals(reEvaluated).map(signal => signal.kind)).toContain(
        "re_evaluation"
      );
    });

    it("entrega la misma procedencia a la ficha del candidato", async () => {
      const { appRouter } = await import("./routers");
      const rows = await appRouter
        .createCaller(context())
        .candidates.reviewWorkspace({ applicationId: reviewedId });
      expect(rows.length).toBe(1);
      // Las mismas columnas que la bandeja: una sola procedencia, dos hojas.
      expect(rows[0].human_review_at).toBeTruthy();
      expect(rows[0].human_review_actor).toBe(reviewerName);
      expect(rows[0].expediente_event_action).toBe("candidate_file_recovered");
      expect(Number(rows[0].evaluation_count)).toBe(2);
      expect(expedienteChangedAfterReview(rows[0])).toBe(true);

      // La postulación sin revisión no inventa un sello.
      const untouched = await appRouter
        .createCaller(context())
        .candidates.reviewWorkspace({ applicationId: untouchedId });
      expect(untouched[0].human_review_at).toBeNull();
      expect(expedienteSignals(untouched[0])).toEqual([]);
    });
  },
  // El límite por defecto no alcanza: la primera prueba carga `./routers`, que
  // reúne la superficie completa del servidor. El resto del archivo reutiliza
  // ese módulo ya cargado.
  120_000
);
