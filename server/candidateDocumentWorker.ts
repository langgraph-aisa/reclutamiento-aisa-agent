import type { Pool } from "pg";
import {
  analyzeCandidateDocument,
  type CandidateProcessingDependencies,
} from "./candidateKnowledge";
import { evaluateApplicationWithAgent } from "./agentEvaluator";

/**
 * Reevalúa el perfil del candidato cuando el currículum quedó analizado.
 *
 * El resumen y el análisis profundo ya viven en el expediente: el agente
 * evaluador vuelve a ejecutarse para que la ficha incorpore la evidencia nueva,
 * tal como el botón «Evaluar con agente IA». La operación es idempotente por
 * documento —una sola reevaluación por currículum recibido—, de modo que un
 * reintento del barrido no multiplique llamadas ni asientos.
 */
async function reevaluateProfileAfterCv(
  pool: Pool,
  input: {
    applicationId: number;
    fileId: number;
    evaluate?: (pool: Pool, applicationId: number) => Promise<unknown>;
  }
) {
  const already = await pool
    .query(
      `SELECT 1 FROM audit_log
        WHERE entity_type='candidate_knowledge_file' AND entity_id=$1
          AND action IN ('candidate_cv_reevaluated','candidate_cv_reevaluation_failed')
        LIMIT 1`,
      [input.fileId]
    )
    .catch(() => null);
  if (already?.rows[0]) return;
  const run =
    input.evaluate ??
    ((scoped: Pool, applicationId: number) =>
      evaluateApplicationWithAgent(scoped, applicationId));
  try {
    const evaluation = (await run(pool, input.applicationId)) as {
      classification?: unknown;
      score?: unknown;
    } | null;
    await pool.query(
      `INSERT INTO audit_log(entity_type,entity_id,action,after_json)
       VALUES('candidate_knowledge_file',$1,'candidate_cv_reevaluated',$2::jsonb)`,
      [
        input.fileId,
        JSON.stringify({
          applicationId: input.applicationId,
          classification: evaluation?.classification ?? null,
          score: typeof evaluation?.score === "number" ? evaluation.score : null,
        }),
      ]
    );
  } catch (error) {
    await pool
      .query(
        `INSERT INTO audit_log(entity_type,entity_id,action,after_json)
         VALUES('candidate_knowledge_file',$1,'candidate_cv_reevaluation_failed',$2::jsonb)`,
        [
          input.fileId,
          JSON.stringify({
            applicationId: input.applicationId,
            reason:
              error instanceof Error
                ? error.message.slice(0, 300)
                : "causa desconocida",
          }),
        ]
      )
      .catch(() => undefined);
  }
}

export async function candidateDocumentsProcessing(
  pool: Pick<Pool, "query">,
  applicationId: number
) {
  const result = await pool.query(
    `SELECT EXISTS (
    SELECT 1 FROM candidate_document_jobs j JOIN candidate_knowledge_files k ON k.id=j.file_id
    WHERE k.application_id=$1 AND j.state IN ('pending','running','retry')
  ) AS pending`,
    [applicationId]
  );
  return Boolean(result.rows[0]?.pending);
}

/** La fila de trabajo sobrevive al proceso; SKIP LOCKED y el advisory lock del
 * analizador protegen dos instancias y los reintentos de una lease vencida. */
export async function runCandidateDocumentSweep(
  pool: Pool,
  options: {
    limit?: number;
    dependencies?: CandidateProcessingDependencies;
  } = {}
) {
  const outcomes: Array<{ fileId: number; status: string }> = [];
  for (let index = 0; index < (options.limit ?? 2); index++) {
    const claimed = await pool.query(`UPDATE candidate_document_jobs j
      SET state='running',attempts=attempts+1,lease_until=now()+interval '15 minutes',updated_at=now()
      WHERE file_id=(SELECT file_id FROM candidate_document_jobs
        WHERE ((state IN ('pending','retry') AND available_at<=now()) OR (state='running' AND lease_until<now()))
        ORDER BY available_at,file_id FOR UPDATE SKIP LOCKED LIMIT 1)
      RETURNING file_id,attempts`);
    const job = claimed.rows[0];
    if (!job) break;
    const fileId = Number(job.file_id);
    let status = "error";
    let errorCode: string | null = "worker_failed";
    try {
      const result = await analyzeCandidateDocument(pool, fileId, null, {
        ...options.dependencies,
        skipCompleted: true,
      });
      status = result.analysisStatus;
      errorCode = result.errorCode;
      // El currículum recibido ya tiene resumen y análisis: se reevalúa el
      // perfil con esa evidencia nueva antes de dar el trabajo por concluido.
      if (
        status === "analizado" &&
        result.documentClass === "cv" &&
        result.applicationId
      ) {
        await reevaluateProfileAfterCv(pool, {
          applicationId: result.applicationId,
          fileId,
          evaluate: options.dependencies?.evaluate,
        });
      }
    } catch {
      /* El intento permanece recuperable aun si falla el registro del error. */
    }
    const complete = status === "analizado" || status === "no_aplica";
    const busy = errorCode === "processing_busy";
    const retry =
      busy ||
      (!complete &&
        Number(job.attempts) < 3 &&
        ![
          "storage_missing",
          "extraction_failed",
          "decoder_unavailable",
        ].includes(errorCode ?? ""));
    await pool.query(
      `UPDATE candidate_document_jobs SET state=$1,last_error_code=$2,
      attempts=CASE WHEN $5 THEN GREATEST(attempts-1,0) ELSE attempts END,
      available_at=now()+($3::int * interval '1 second'),lease_until=NULL,updated_at=now()
      WHERE file_id=$4`,
      [
        complete ? "completed" : retry ? "retry" : "failed",
        errorCode,
        Math.min(120, 15 * Number(job.attempts)),
        fileId,
        busy,
      ]
    );
    outcomes.push({ fileId, status });
  }
  return outcomes;
}

export function startCandidateDocumentWorker(
  poolProvider: () => Promise<Pool | null>,
  options: { intervalMs?: number } = {}
) {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const pool = await poolProvider();
      if (pool) await runCandidateDocumentSweep(pool);
    } catch (error) {
      console.warn(
        `[CandidateDocuments] Worker no disponible (${error instanceof Error ? error.name : "unknown"}).`
      );
    } finally {
      running = false;
    }
  }, options.intervalMs ?? 2_000);
  timer.unref?.();
  return () => clearInterval(timer);
}
