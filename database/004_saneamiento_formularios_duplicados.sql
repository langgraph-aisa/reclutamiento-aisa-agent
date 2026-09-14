-- ============================================================================
-- JARVI RH 2.0.138 · Saneamiento del instrumento duplicado (DBGate / EasyPanel)
-- Base objetivo: hiring-database-testing (PostgreSQL 17.11, esquema public)
--
-- QUÉ RESUELVE
--   Una plaza puede tener varias variantes por diseño (pruebas A/B/C/D). El fallo
--   epistemológico consiste en que la plaza quedó con DOS instrumentos para la
--   misma evidencia: uno vacío (sin participación) y otro que sí contiene las
--   respuestas. Este script retira el instrumento redundante SIN destruir
--   evidencia, deja el asiento de auditoría exigido por ISO/IEC 20000-1 y
--   verifica la integridad al final.
--
-- INVARIANTES QUE RESPETA (no son opcionales)
--   1. Ningún borrado puede eliminar evidencia única. Las respuestas del
--      instrumento redundante solo se retiran cuando existe una copia idéntica
--      en el instrumento conservado: misma postulación, mismo enunciado de
--      pregunta y mismo valor normalizado. Si queda una sola respuesta sin copia,
--      la guarda aborta y la base permanece intacta.
--   2. La postulación es única por (candidato, plaza): solo se reasigna su
--      formulario de origen, nunca se crea ni se duplica.
--   3. El candidato se identifica por su WhatsApp: no se toca `candidates`.
--   4. Toda retirada queda en `audit_log` con instantánea anterior y posterior,
--      incluida la lista de postulaciones que participaron en el instrumento
--      retirado. La evidencia histórica se conserva aunque el instrumento se
--      elimine.
--   5. La plaza no queda sin enlace público: si el instrumento retirado estaba
--      encendido, el superviviente debe encenderse desde el panel (sección D.4),
--      porque esa acción ejecuta la validación editorial y la auditoría.
--
-- ORDEN
--   A) Diagnóstico (solo lectura)  → confirme los identificadores
--   B) Guardas y saneamiento       → transacción única con auditoría
--   C) Verificación                → integridad y trazabilidad
--   D) Cierre operativo            → publicación desde el panel
--
-- ANTES DE EJECUTAR: haga respaldo de la base. Esta operación es un cambio
-- controlado: el asiento de auditoría es el registro de la modificación.
-- ============================================================================


-- ============================================================================
-- PARÁMETROS · Edite únicamente estos tres números.
--   Plaza 27 «Desarrollador Odoo (22 de mayo a 5 de septiembre)»:
--     26 → formulario versión 1 (herramienta, sin participación: redundante)
--     28 → formulario versión 2 (importado, con las respuestas: superviviente)
-- ============================================================================

DROP TABLE IF EXISTS saneamiento_parametros;
CREATE TEMP TABLE saneamiento_parametros AS
SELECT 27::integer AS plaza_id,
       26::integer AS form_redundante,
       28::integer AS form_conservado;

SELECT * FROM saneamiento_parametros;


-- ============================================================================
-- A · DIAGNÓSTICO (solo lectura)
-- ============================================================================

-- A.1 Instrumentos de la plaza con su evidencia.
SELECT
  f.id                                     AS formulario_id,
  f.version                                AS no_formulario,
  f.title                                  AS formulario,
  f.source                                 AS origen,
  f.published                              AS interruptor_encendido,
  f.public_token,
  (SELECT count(*) FROM form_questions q WHERE q.form_id = f.id)                AS preguntas,
  (SELECT count(*) FROM application_form_submissions s WHERE s.form_id = f.id)  AS participaciones,
  (SELECT count(*) FROM application_answers aa
     JOIN form_questions q ON q.id = aa.question_id WHERE q.form_id = f.id)     AS respuestas,
  (SELECT count(*) FROM applications a WHERE a.form_id = f.id)                  AS postulaciones_vinculadas
FROM application_forms f
WHERE f.job_position_id = (SELECT plaza_id FROM saneamiento_parametros)
ORDER BY f.version, f.id;

-- A.2 Evidencia del instrumento redundante.
--     `respuestas_unicas` DEBE ser 0 para que la sección B deje la plaza con un
--     solo instrumento. Si es mayor que cero, la guarda aborta: esa evidencia no
--     tiene copia en el instrumento conservado y no se destruye.
SELECT
  (SELECT count(*) FROM application_answers aa
     JOIN form_questions q ON q.id = aa.question_id
    WHERE q.form_id = (SELECT form_redundante FROM saneamiento_parametros))     AS respuestas_en_redundante,
  (SELECT count(*) FROM application_answers aa_red
     JOIN form_questions q_red ON q_red.id = aa_red.question_id
    WHERE q_red.form_id = (SELECT form_redundante FROM saneamiento_parametros)
      AND EXISTS (
        SELECT 1
          FROM application_answers aa_con
          JOIN form_questions q_con ON q_con.id = aa_con.question_id
         WHERE aa_con.application_id = aa_red.application_id
           AND q_con.form_id = (SELECT form_conservado FROM saneamiento_parametros)
           AND lower(btrim(q_con.label)) = lower(btrim(q_red.label))
           AND COALESCE(aa_con.normalized_value, '') = COALESCE(aa_red.normalized_value, '')
      ))                                                                        AS respuestas_duplicadas,
  (SELECT count(*) FROM application_answers aa_red
     JOIN form_questions q_red ON q_red.id = aa_red.question_id
    WHERE q_red.form_id = (SELECT form_redundante FROM saneamiento_parametros)
      AND NOT EXISTS (
        SELECT 1
          FROM application_answers aa_con
          JOIN form_questions q_con ON q_con.id = aa_con.question_id
         WHERE aa_con.application_id = aa_red.application_id
           AND q_con.form_id = (SELECT form_conservado FROM saneamiento_parametros)
           AND lower(btrim(q_con.label)) = lower(btrim(q_red.label))
           AND COALESCE(aa_con.normalized_value, '') = COALESCE(aa_red.normalized_value, '')
      ))                                                                        AS respuestas_unicas,
  (SELECT count(*) FROM application_form_submissions s
    WHERE s.form_id = (SELECT form_redundante FROM saneamiento_parametros))     AS participaciones_en_redundante,
  (SELECT count(*) FROM applications a
    WHERE a.form_id = (SELECT form_redundante FROM saneamiento_parametros))     AS postulaciones_a_reasignar;

-- A.3 Evidencia duplicada entre ambos instrumentos (mismo candidato, misma
--     pregunta por `field_key` y mismo valor). Si devuelve filas, la sección C
--     conserva una copia canónica y retira la repetida.
SELECT
  c.phone_international              AS whatsapp,
  q_red.field_key                    AS pregunta,
  aa_red.normalized_value            AS valor_redundante,
  aa_con.normalized_value            AS valor_conservado
FROM application_answers aa_red
JOIN form_questions q_red ON q_red.id = aa_red.question_id
JOIN application_answers aa_con ON aa_con.application_id = aa_red.application_id
JOIN form_questions q_con ON q_con.id = aa_con.question_id
JOIN applications a ON a.id = aa_red.application_id
JOIN candidates c ON c.id = a.candidate_id
WHERE q_red.form_id = (SELECT form_redundante FROM saneamiento_parametros)
  AND q_con.form_id = (SELECT form_conservado FROM saneamiento_parametros)
  AND lower(btrim(q_con.label)) = lower(btrim(q_red.label))
  AND COALESCE(aa_con.normalized_value, '') = COALESCE(aa_red.normalized_value, '')
ORDER BY c.phone_international, q_red.label;

-- A.4 Instrumentos sin participación en toda la base: sirve para repetir este
--     saneamiento en otras plazas. Un instrumento vacío no es basura por sí
--     mismo; es redundante cuando la misma plaza ya tiene otro con evidencia.
SELECT
  p.id                                                                          AS plaza_id,
  p.title                                                                       AS plaza,
  f.id                                                                          AS formulario_id,
  f.version                                                                     AS no_formulario,
  f.source                                                                      AS origen,
  f.published                                                                   AS interruptor_encendido,
  (SELECT count(*) FROM form_questions q WHERE q.form_id = f.id)                AS preguntas,
  (SELECT count(*) FROM application_forms otro
    WHERE otro.job_position_id = f.job_position_id AND otro.id <> f.id)         AS otros_instrumentos
FROM application_forms f
JOIN job_positions p ON p.id = f.job_position_id
WHERE (SELECT count(*) FROM application_form_submissions s WHERE s.form_id = f.id) = 0
ORDER BY otros_instrumentos DESC, p.id, f.version;


-- ============================================================================
-- B · SANEAMIENTO (transacción única: guardas + auditoría + retirada)
-- Ejecute la sección completa de BEGIN a COMMIT.
-- ============================================================================

BEGIN;

-- B.1 Guardas. Cada condición es una restricción de la tabla temporal: si algo no
--     se cumple, la sentencia falla, la transacción se revierte y la base queda
--     intacta. El nombre de la restricción indica el motivo del rechazo.
DROP TABLE IF EXISTS saneamiento_guardia;
CREATE TEMP TABLE saneamiento_guardia (
  misma_plaza                    smallint NOT NULL CHECK (misma_plaza = 1),
  conservado_existe              smallint NOT NULL CHECK (conservado_existe = 1),
  redundante_existe              smallint NOT NULL CHECK (redundante_existe = 1),
  son_instrumentos_distintos     smallint NOT NULL CHECK (son_instrumentos_distintos = 1),
  redundante_sin_evidencia_unica integer  NOT NULL CHECK (redundante_sin_evidencia_unica = 0)
) ON COMMIT DROP;

INSERT INTO saneamiento_guardia (
  misma_plaza, conservado_existe, redundante_existe,
  son_instrumentos_distintos, redundante_sin_evidencia_unica
)
SELECT
  CASE WHEN (SELECT count(DISTINCT job_position_id) FROM application_forms
              WHERE id IN (SELECT form_conservado FROM saneamiento_parametros
                           UNION SELECT form_redundante FROM saneamiento_parametros)) = 1
       THEN 1 ELSE 0 END,
  (SELECT count(*) FROM application_forms WHERE id = (SELECT form_conservado FROM saneamiento_parametros)),
  (SELECT count(*) FROM application_forms WHERE id = (SELECT form_redundante FROM saneamiento_parametros)),
  CASE WHEN (SELECT form_conservado FROM saneamiento_parametros)
          <> (SELECT form_redundante FROM saneamiento_parametros)
       THEN 1 ELSE 0 END,
  (SELECT count(*) FROM application_answers aa_red
     JOIN form_questions q_red ON q_red.id = aa_red.question_id
    WHERE q_red.form_id = (SELECT form_redundante FROM saneamiento_parametros)
      AND NOT EXISTS (
        SELECT 1
          FROM application_answers aa_con
          JOIN form_questions q_con ON q_con.id = aa_con.question_id
         WHERE aa_con.application_id = aa_red.application_id
           AND q_con.form_id = (SELECT form_conservado FROM saneamiento_parametros)
           AND lower(btrim(q_con.label)) = lower(btrim(q_red.label))
           AND COALESCE(aa_con.normalized_value, '') = COALESCE(aa_red.normalized_value, '')
      ));

-- B.2 Asiento de auditoría previo a la retirada (ISO/IEC 20000-1 · control de
--     cambios; ISO/IEC 27001 · integridad). Conserva la instantánea del
--     instrumento y la lista de postulaciones que participaron en él.
INSERT INTO audit_log (
  actor_user_id, entity_type, entity_id, action, before_json, after_json, comment
)
SELECT
  (SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1),
  'application_form',
  (SELECT form_redundante FROM saneamiento_parametros),
  'duplicate_form_removed',
  jsonb_build_object(
    'formulario', (SELECT to_jsonb(f) FROM application_forms f
                    WHERE f.id = (SELECT form_redundante FROM saneamiento_parametros)),
    'plazaId', (SELECT plaza_id FROM saneamiento_parametros),
    'preguntas', (SELECT count(*) FROM form_questions q
                   WHERE q.form_id = (SELECT form_redundante FROM saneamiento_parametros)),
    'participaciones', (SELECT count(*) FROM application_form_submissions s
                         WHERE s.form_id = (SELECT form_redundante FROM saneamiento_parametros)),
    'respuestasRetiradas', (SELECT count(*) FROM application_answers aa_red
                              JOIN form_questions q_red ON q_red.id = aa_red.question_id
                             WHERE q_red.form_id = (SELECT form_redundante FROM saneamiento_parametros)),
    'respuestasUnicasConservadas', 0,
    'postulacionesVinculadas', (SELECT count(*) FROM applications a
                                 WHERE a.form_id = (SELECT form_redundante FROM saneamiento_parametros)),
    'postulacionesParticipantes', (
      SELECT COALESCE(jsonb_agg(s.application_id ORDER BY s.application_id), '[]'::jsonb)
        FROM application_form_submissions s
       WHERE s.form_id = (SELECT form_redundante FROM saneamiento_parametros)
    )
  ),
  jsonb_build_object(
    'formularioConservado', (SELECT form_conservado FROM saneamiento_parametros),
    'motivo', 'Instrumento redundante: la plaza conserva la variante con la evidencia y ninguna respuesta única se perdió.'
  ),
  'Saneamiento del fallo epistémico: se retira un instrumento redundante. Las respuestas retiradas tenían copia idéntica en el instrumento conservado; la participación histórica queda registrada en este asiento.'
WHERE NOT EXISTS (
  SELECT 1 FROM audit_log
   WHERE entity_type = 'application_form'
     AND entity_id = (SELECT form_redundante FROM saneamiento_parametros)
     AND action = 'duplicate_form_removed'
);

-- B.3 Retiro de las respuestas duplicadas del instrumento redundante. Solo se
--     elimina la copia: la respuesta equivalente del instrumento conservado
--     permanece intacta y la guarda garantiza que no hay ninguna sin copia.
DELETE FROM application_answers aa
 USING form_questions q_red,
       application_answers aa_con,
       form_questions q_con
 WHERE q_red.id = aa.question_id
   AND q_red.form_id = (SELECT form_redundante FROM saneamiento_parametros)
   AND aa_con.application_id = aa.application_id
   AND q_con.id = aa_con.question_id
   AND q_con.form_id = (SELECT form_conservado FROM saneamiento_parametros)
   AND lower(btrim(q_con.label)) = lower(btrim(q_red.label))
   AND COALESCE(aa_con.normalized_value, '') = COALESCE(aa.normalized_value, '');

-- B.4 Reasignación del origen de la postulación al instrumento conservado.
--     `applications.form_id` es NOT NULL y sin borrado en cascada: sin este paso
--     la base rechazaría la retirada, lo que evita eliminar un formulario en uso.
UPDATE applications
   SET form_id = (SELECT form_conservado FROM saneamiento_parametros),
       updated_at = now()
 WHERE form_id = (SELECT form_redundante FROM saneamiento_parametros);

-- B.5 Retirada de participaciones e instrumento. Las preguntas caen en cascada.
--     Si quedara alguna respuesta, la restricción de `application_answers` hacia
--     `form_questions` impediría el borrado y la transacción se revertiría.
DELETE FROM application_form_submissions
 WHERE form_id = (SELECT form_redundante FROM saneamiento_parametros);

DELETE FROM application_forms
 WHERE id = (SELECT form_redundante FROM saneamiento_parametros);

COMMIT;


-- ============================================================================
-- C · VERIFICACIÓN (todas las consultas deben devolver el resultado indicado)
-- ============================================================================

-- C.1 La plaza conserva exactamente un instrumento, con la evidencia intacta.
SELECT
  f.id                                     AS formulario_id,
  f.version                                AS no_formulario,
  f.source                                 AS origen,
  f.published                              AS interruptor_encendido,
  (SELECT count(*) FROM form_questions q WHERE q.form_id = f.id)               AS preguntas,
  (SELECT count(*) FROM application_form_submissions s WHERE s.form_id = f.id) AS participaciones,
  (SELECT count(*) FROM application_answers aa
     JOIN form_questions q ON q.id = aa.question_id WHERE q.form_id = f.id)    AS respuestas
FROM application_forms f
WHERE f.job_position_id = (SELECT plaza_id FROM saneamiento_parametros)
ORDER BY f.version;

-- C.2 Integridad: las cuatro consultas deben devolver 0 filas.
SELECT candidate_id, job_position_id, count(*) AS registros
  FROM applications GROUP BY candidate_id, job_position_id HAVING count(*) > 1;

SELECT application_id, form_id, count(*) AS registros
  FROM application_form_submissions GROUP BY application_id, form_id HAVING count(*) > 1;

SELECT application_id, question_id, count(*) AS registros
  FROM application_answers GROUP BY application_id, question_id HAVING count(*) > 1;

SELECT q.form_id, q.field_key, count(*) AS registros
  FROM form_questions q GROUP BY q.form_id, q.field_key HAVING count(*) > 1;

-- C.3 Sin instrumentos huérfanos ni respuestas sin pregunta vigente.
SELECT count(*) AS instrumentos_huerfanos
  FROM application_forms f
 WHERE NOT EXISTS (SELECT 1 FROM job_positions p WHERE p.id = f.job_position_id);

SELECT count(*) AS respuestas_sin_pregunta
  FROM application_answers aa
 WHERE NOT EXISTS (SELECT 1 FROM form_questions q WHERE q.id = aa.question_id);

SELECT count(*) AS participaciones_sin_postulacion
  FROM application_form_submissions s
 WHERE NOT EXISTS (SELECT 1 FROM applications a WHERE a.id = s.application_id);

-- C.4 Trazabilidad del cambio (ISO/IEC 20000-1).
SELECT id, created_at, actor_user_id, entity_type, entity_id, action,
       before_json -> 'participaciones'          AS participaciones_retiradas,
       before_json -> 'postulacionesVinculadas'  AS postulaciones_reasignadas,
       after_json -> 'formularioConservado'      AS formulario_conservado
  FROM audit_log
 WHERE entity_type = 'application_form' AND action = 'duplicate_form_removed'
 ORDER BY created_at DESC;


-- ============================================================================
-- D · CIERRE OPERATIVO
-- ============================================================================

-- D.1 Si el instrumento retirado estaba encendido, la plaza queda sin enlace
--     público hasta encender el superviviente. Compruebe el estado:
SELECT f.id, f.version, f.published, f.public_token, '/apply/f/' || f.public_token AS enlace_seguro,
       p.published AS plaza_publicada
  FROM application_forms f
  JOIN job_positions p ON p.id = f.job_position_id
 WHERE f.job_position_id = (SELECT plaza_id FROM saneamiento_parametros);

-- D.2 Encienda el superviviente desde el panel: Plazas y anuncios → interruptor
--     del formulario. Esa acción ejecuta la validación editorial, el paquete
--     completo y la auditoría del cambio; el SQL directo omitiría las tres.
--
--     ADVERTENCIA: use esta vía solo con criterio explícito y registre el motivo.
-- UPDATE application_forms SET published = true, updated_at = now() WHERE id = 0;

-- D.3 Elimine la tabla temporal al terminar la sesión.
DROP TABLE IF EXISTS saneamiento_parametros;
