import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createMediaTestDatabase } from "./testSupport/mediaDatabase";
import type { TrpcContext } from "./_core/context";

/**
 * Caja negra de la matriz de revisión sobre PostgreSQL real.
 *
 * Se verifica el contrato observable por el evaluador, no la forma del código:
 *
 * 1. **Orden por calificación.** Un filtro configurado abre la matriz por la
 *    mejor evaluación; sin filtro la hoja es un registro de ingreso y se lee
 *    por fecha.
 * 2. **Sello de revisión humana.** El sello se deriva del asiento de la
 *    revisión —actor identificado y acción de revisión— y no de cualquier
 *    escritura sobre la postulación. Una acción del agente, del sincronizador o
 *    de la bandeja no acredita que una persona haya revisado el expediente.
 *
 * El ordenamiento por defecto y el sello son datos del servidor: si el
 * servidor no los expone, la hoja no puede mostrarlos por mucho que se pinte.
 */

const enabled = Boolean(process.env.MEDIA_TEST_DATABASE_URL);

describe.runIf(enabled)(
  "PostgreSQL real: matriz de revisión humana",
  () => {
    let database: Awaited<ReturnType<typeof createMediaTestDatabase>>;
    let reviewerId: number;
    const reviewerName = "Revisora Humana Sintética";
    let lowId: number;
    let highId: number;

    const context = () =>
      ({
        user: {
          id: reviewerId,
          openId: "email:revisora@example.test",
          name: reviewerName,
          email: "revisora@example.test",
          loginMethod: "email_code",
          role: "reclutador",
          active: true,
        },
        req: { headers: {} },
        res: {},
      }) as unknown as TrpcContext;

    beforeAll(async () => {
      database = await createMediaTestDatabase();
      vi.stubEnv("DATABASE_URL", database.url);
      const pool = database.pool;
      reviewerId = Number(
        (
          await pool.query(
            `INSERT INTO users(open_id,role,active,name)
             VALUES('email:revisora@example.test','reclutador',true,$1) RETURNING id`,
            [reviewerName]
          )
        ).rows[0].id
      );
      const position = Number(
        (
          await pool.query(
            `INSERT INTO job_positions(public_slug,code,title,agent_key)
             VALUES('matrix-test','matrix-test','Ingeniera de proyectos','test') RETURNING id`
          )
        ).rows[0].id
      );
      const form = Number(
        (
          await pool.query(
            `INSERT INTO application_forms(job_position_id,title)
             VALUES($1,'Formulario sintético') RETURNING id`,
            [position]
          )
        ).rows[0].id
      );
      const make = async (
        name: string,
        phone: string,
        score: number,
        submittedAt: string
      ) => {
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
               VALUES($1,$2,$3,'en_revision',$4) RETURNING id`,
              [candidate, position, form, submittedAt]
            )
          ).rows[0].id
        );
        await pool.query(
          `INSERT INTO evaluations(application_id,status,reason,profile_summary,ai_payload)
           VALUES($1,'pre_calificado',$2,$3,$4::jsonb)`,
          [
            application,
            "Motivo sintético del dictamen.",
            "Resumen sintético del perfil.",
            JSON.stringify({ score }),
          ]
        );
        return application;
      };
      lowId = await make(
        "Aspirante de punteo bajo",
        "+50255550101",
        40,
        "2026-09-18T18:00:00Z"
      );
      highId = await make(
        "Aspirante de punteo alto",
        "+50255550102",
        90,
        "2026-09-18T19:00:00Z"
      );
    }, 180_000);

    afterAll(async () => {
      const { getPool } = await import("./db");
      await (await getPool())?.end();
      await database?.close();
      vi.unstubAllEnvs();
    });

    it("ordena por la mejor calificación cuando el evaluador configura un filtro", async () => {
      const { appRouter } = await import("./routers");
      const caller = appRouter.createCaller(context());

      const filtered = await caller.candidates.reviewWorkspace({
        minimumScore: 0,
        sortBy: "score",
        sortDirection: "desc",
      });
      expect(filtered.map(row => Number(row.evaluation_score))).toEqual([90, 40]);
      expect(filtered[0].id).toBe(highId);

      // Sin filtro configurado la hoja es un registro de ingreso: manda la fecha.
      const byEntry = await caller.candidates.reviewWorkspace({
        sortBy: "submitted_at",
        sortDirection: "desc",
      });
      expect(byEntry[0].id).toBe(highId);
      expect(byEntry.map(row => row.id)).toEqual([highId, lowId]);
    });

    it("sella la revisión humana y no confunde con ella la escritura del sistema", async () => {
      const { appRouter } = await import("./routers");
      const caller = appRouter.createCaller(context());

      const before = await caller.candidates.reviewWorkspace({
        applicationId: highId,
      });
      expect(before[0].human_review_at).toBeNull();
      expect(before[0].human_review_actor).toBeNull();

      await caller.candidates.setStatus({
        id: highId,
        status: "pendiente_revision_humana",
        comment: "Revisado con la evidencia del expediente.",
      });

      const after = await caller.candidates.reviewWorkspace({
        applicationId: highId,
      });
      expect(after[0].human_review_at).toBeTruthy();
      expect(Number.isNaN(new Date(after[0].human_review_at).getTime())).toBe(
        false
      );
      expect(after[0].human_review_actor).toBe(reviewerName);
      expect(after[0].human_review_action).toBe("status_changed");

      // La otra postulación sigue sin sello: el sello es por expediente.
      expect(
        (
          await caller.candidates.reviewWorkspace({ applicationId: lowId })
        )[0].human_review_at
      ).toBeNull();

      // Una escritura del sistema —actor nulo— y una acción humana que no es la
      // revisión del expediente no acreditan una revisión humana.
      await database.pool.query(
        `INSERT INTO audit_log(actor_user_id,entity_type,entity_id,action)
         VALUES(NULL,'application',$1,'agent_hard_fail')`,
        [lowId]
      );
      await database.pool.query(
        `INSERT INTO audit_log(actor_user_id,entity_type,entity_id,action)
         VALUES($1,'application',$2,'inbox_human_takeover')`,
        [reviewerId, lowId]
      );
      const untouched = await caller.candidates.reviewWorkspace({
        applicationId: lowId,
      });
      expect(untouched[0].human_review_at).toBeNull();

      // El comentario humano viaja en el asiento, no en el sello: el sello
      // declara «revisado», no «qué se dijo».
      const recorded = await database.pool.query(
        `SELECT comment FROM audit_log
          WHERE entity_type='application' AND entity_id=$1
            AND action='status_changed' AND actor_user_id=$2`,
        [highId, reviewerId]
      );
      expect(recorded.rows[0]?.comment).toBe(
        "Revisado con la evidencia del expediente."
      );
    });

    it("ordena por la fecha del sello humano y deja al final lo no revisado", async () => {
      const { appRouter } = await import("./routers");
      const caller = appRouter.createCaller(context());
      await caller.candidates.setStatus({
        id: lowId,
        status: "pendiente_revision_humana",
      });
      const rows = await caller.candidates.reviewWorkspace({
        sortBy: "human_review",
        sortDirection: "desc",
      });
      // Ambas quedaron revisadas; el orden es por la fecha del sello, no por el
      // punteo, porque así lo pidió quien consulta.
      expect(rows.map(row => row.id)).toEqual([lowId, highId]);
      expect(rows.every(row => Boolean(row.human_review_at))).toBe(true);
    });
  },
  180_000
);
