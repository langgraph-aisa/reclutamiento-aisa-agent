/**
 * Fragmentos SQL de la señalización del expediente.
 *
 * Un solo lugar declara de dónde salen las señales para que la Bandeja de
 * entrada, la búsqueda de Candidatos y la ficha del candidato presenten el mismo
 * fundamento. Si cada consulta inventara su propia procedencia, la interfaz
 * mostraría señales distintas para el mismo expediente y la señalización dejaría
 * de ser una prueba.
 *
 * Las dos derivaciones viven aquí y no en la interfaz: el cliente no decide qué
 * es una revisión humana ni qué es un evento del expediente, únicamente lo
 * presenta.
 */

/** Acciones de auditoría que constituyen un evento observable del expediente. */
export const EXPEDIENTE_EVENT_ACTIONS = [
  "candidate_file_received",
  "candidate_file_recovered",
  "candidate_file_analyzed",
  "candidate_file_analysis_updated",
  "candidate_cv_essence_generated",
  "candidate_expediente_acknowledged",
] as const;

const eventActionList = EXPEDIENTE_EVENT_ACTIONS.map(
  action => `'${action}'`
).join(",");

/**
 * Última revisión humana de la postulación.
 *
 * La fuente es `audit_log` con actor identificado: una escritura del agente o
 * del sincronizador no acredita que una persona haya revisado el expediente.
 */
export const HUMAN_REVIEW_LATERAL = `LEFT JOIN LATERAL (
             SELECT al.created_at AS human_review_at,al.action AS human_review_action,
                    u.name AS human_review_actor
               FROM audit_log al
               LEFT JOIN users u ON u.id=al.actor_user_id
              WHERE al.entity_type='application' AND al.entity_id=a.id
                AND al.actor_user_id IS NOT NULL
                AND al.action IN ('status_changed','comment_added')
              ORDER BY al.created_at DESC,al.id DESC
              LIMIT 1
           ) human_review ON true`;

/** Columnas que `HUMAN_REVIEW_LATERAL` aporta a la consulta. */
export const HUMAN_REVIEW_COLUMNS =
  "human_review.human_review_at,human_review.human_review_actor";

/**
 * Último evento del expediente y conteo de evaluaciones del agente.
 *
 * El evento se busca en los asientos del expediente —documentos del candidato y
 * acuse— y el conteo de evaluaciones distingue «nunca evaluado» de «evaluado más
 * de una vez», que es lo que vuelve visible una re-evaluación.
 */
export const EXPEDIENTE_SIGNAL_JOINS = `LEFT JOIN LATERAL (
             SELECT al.action AS expediente_event_action,
                    al.created_at AS expediente_event_at,
                    COALESCE(u.name,'JARVI HR') AS expediente_event_actor
               FROM audit_log al
               LEFT JOIN users u ON u.id=al.actor_user_id
              WHERE al.action IN (${eventActionList})
                AND (
                  (al.entity_type='candidate_knowledge_file'
                   AND al.entity_id IN (
                     SELECT id FROM candidate_knowledge_files WHERE application_id=a.id
                   ))
                  OR (al.entity_type='candidate_expediente' AND al.entity_id=a.candidate_id)
                )
              ORDER BY al.created_at DESC,al.id DESC
              LIMIT 1
           ) expediente_event ON true
           LEFT JOIN LATERAL (
             SELECT count(*)::int AS evaluation_count,
                    max(ev.created_at) AS last_evaluation_at
               FROM evaluations ev
              WHERE ev.application_id=a.id
           ) expediente_tally ON true`;

/** Columnas que `EXPEDIENTE_SIGNAL_JOINS` aporta a la consulta. */
export const EXPEDIENTE_SIGNAL_COLUMNS = `expediente_event.expediente_event_action,
             expediente_event.expediente_event_at,
             expediente_event.expediente_event_actor,
             expediente_tally.evaluation_count,expediente_tally.last_evaluation_at`;

/**
 * Proyección completa de la señalización para una consulta de postulaciones.
 *
 * Agrupa los dos bloques porque una señal sin la otra no responde la pregunta
 * del reclutador: la revisión sin los cambios posteriores haría creer que el
 * sello sigue vigente, y los cambios sin la revisión no dirían de qué estado
 * parten.
 */
export const EXPEDIENTE_SIGNAL_PROJECTION = `${EXPEDIENTE_SIGNAL_COLUMNS},
             ${HUMAN_REVIEW_COLUMNS}`;

export const EXPEDIENTE_SIGNAL_LATERALS = `${EXPEDIENTE_SIGNAL_JOINS}
           ${HUMAN_REVIEW_LATERAL}`;
