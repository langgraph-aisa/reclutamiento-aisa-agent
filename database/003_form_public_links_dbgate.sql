-- ============================================================================
-- JARVI RH 2.0.138 · Consultas para DBGate (EasyPanel)
-- Base objetivo: hiring-database-testing (PostgreSQL 17.11, esquema public)
--
-- ORDEN DE EJECUCIÓN
--   1) SECCIÓN 1 es obligatoria ANTES de desplegar el artefacto 2.0.138:
--      el código nuevo lee application_forms.public_token.
--   2) SECCIONES 2 a 7 son de verificación: no modifican datos.
--   3) SECCIÓN 8 es opcional y está comentada; solo se usa con criterio.
--
-- La SECCIÓN 1 es idempotente: puede ejecutarse más de una vez sin efectos
-- adicionales. No toca drizzle._drizzle_migrations: esta migración numerada se
-- aplica manualmente, igual que 0015 a 0018.
-- ============================================================================


-- ============================================================================
-- SECCIÓN 1 · Migración 0019 (OBLIGATORIA)
-- Enlace seguro propio por formulario (variantes A/B/C/D) e interruptor individual.
-- ============================================================================

-- Token de capacidad: identifica un formulario concreto en su enlace público.
ALTER TABLE application_forms ADD COLUMN IF NOT EXISTS public_token varchar(32);

-- Rellena los formularios existentes. El identificador entra en la expresión, de
-- modo que cada fila recibe un token distinto en una sola sentencia (sin bloques
-- DO, para que DBGate no tenga que interpretar PL/pgSQL).
UPDATE application_forms
   SET public_token = md5(random()::text || clock_timestamp()::text || id::text)
 WHERE public_token IS NULL;

-- Todo formulario nuevo recibe un token aunque la aplicación no lo envíe.
ALTER TABLE application_forms
  ALTER COLUMN public_token SET DEFAULT md5(random()::text || clock_timestamp()::text);

ALTER TABLE application_forms ALTER COLUMN public_token SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS application_forms_public_token_uq
  ON application_forms (public_token);

-- La longitud mínima descarta valores vacíos o truncados en el enlace público.
ALTER TABLE application_forms DROP CONSTRAINT IF EXISTS application_forms_public_token_format_ck;
ALTER TABLE application_forms
  ADD CONSTRAINT application_forms_public_token_format_ck
  CHECK (length(public_token) >= 16);


-- ============================================================================
-- SECCIÓN 2 · Verificación de la migración (una fila con las tres columnas en true)
-- ============================================================================

SELECT
  EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'application_forms'
       AND column_name = 'public_token'
       AND is_nullable = 'NO'
  ) AS columna_public_token,
  EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND indexname = 'application_forms_public_token_uq'
  ) AS indice_unico,
  EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'application_forms_public_token_format_ck'
  ) AS control_longitud;


-- ============================================================================
-- SECCIÓN 3 · Inventario de formularios con su enlace público
-- Es lo que muestra "Formularios y anuncios" en /admin/jobs.
-- ============================================================================

SELECT
  p.id                                            AS plaza_id,
  p.title                                         AS plaza,
  p.published                                     AS plaza_publicada,
  f.id                                            AS formulario_id,
  f.version                                       AS no_formulario,
  f.title                                         AS formulario,
  f.source                                        AS origen,
  f.published                                     AS interruptor_encendido,
  f.public_token,
  '/apply/f/' || f.public_token                   AS enlace_seguro,
  (f.published AND p.published)                   AS enlace_disponible,
  (SELECT count(*) FROM form_questions q WHERE q.form_id = f.id)               AS preguntas,
  (SELECT count(*) FROM application_form_submissions s WHERE s.form_id = f.id) AS participaciones
FROM job_positions p
LEFT JOIN application_forms f ON f.job_position_id = p.id
ORDER BY p.created_at DESC, p.id, f.version, f.id;


-- ============================================================================
-- SECCIÓN 4 · Diagnóstico de la plaza reportada ("Desarrollador Odoo")
-- Cambie el patrón ILIKE si necesita otra plaza.
-- ============================================================================

SELECT
  p.id                                            AS plaza_id,
  p.title                                         AS plaza,
  p.public_slug                                   AS enlace_de_plaza,
  p.published                                     AS plaza_publicada,
  f.id                                            AS formulario_id,
  f.version                                       AS no_formulario,
  f.title                                         AS formulario,
  f.source                                        AS origen,
  f.published                                     AS interruptor_encendido,
  f.public_token,
  '/apply/f/' || f.public_token                   AS enlace_seguro,
  (SELECT count(*) FROM form_questions q WHERE q.form_id = f.id)               AS preguntas,
  (SELECT count(*) FROM application_form_submissions s WHERE s.form_id = f.id) AS participaciones
FROM job_positions p
LEFT JOIN application_forms f ON f.job_position_id = p.id
WHERE p.title ILIKE '%Odoo%'
ORDER BY p.id, f.version, f.id;

-- Plazas con más de un formulario: es válido (variantes A/B/C/D), pero eran las
-- que antes pintaban la tarjeta repetida en /admin/jobs por el LEFT JOIN.
SELECT
  p.id                        AS plaza_id,
  p.title                     AS plaza,
  count(f.id)                 AS formularios,
  count(*) FILTER (WHERE f.source = 'importado') AS importados,
  count(*) FILTER (WHERE f.published)            AS encendidos
FROM job_positions p
JOIN application_forms f ON f.job_position_id = p.id
GROUP BY p.id, p.title
HAVING count(f.id) > 1
ORDER BY formularios DESC, p.id;


-- ============================================================================
-- SECCIÓN 5 · Integridad de datos
--   5.1 a 5.4 deben devolver 0 filas: son violaciones de unicidad.
--   5.5 muestra el caso legítimo: un candidato en dos variantes de la misma plaza.
-- ============================================================================

-- 5.1 Candidato duplicado por teléfono de WhatsApp.
SELECT phone_international, count(*) AS registros
  FROM candidates
 GROUP BY phone_international
HAVING count(*) > 1;

-- 5.2 Postulación duplicada por (candidato, plaza).
SELECT candidate_id, job_position_id, count(*) AS registros
  FROM applications
 GROUP BY candidate_id, job_position_id
HAVING count(*) > 1;

-- 5.3 Participación duplicada por (postulación, formulario).
SELECT application_id, form_id, count(*) AS registros
  FROM application_form_submissions
 GROUP BY application_id, form_id
HAVING count(*) > 1;

-- 5.4 Respuesta duplicada por (postulación, pregunta).
SELECT application_id, question_id, count(*) AS registros
  FROM application_answers
 GROUP BY application_id, question_id
HAVING count(*) > 1;

-- 5.5 Un mismo candidato participando en dos variantes de la misma plaza
--     (comportamiento esperado: 1 postulación, N participaciones).
SELECT
  c.full_name,
  c.phone_international,
  p.title                                   AS plaza,
  count(DISTINCT a.id)                      AS postulaciones,
  count(DISTINCT s.form_id)                 AS formularios_completados,
  string_agg(DISTINCT f.title, ' | ')       AS variantes
FROM candidates c
JOIN applications a ON a.candidate_id = c.id
JOIN job_positions p ON p.id = a.job_position_id
JOIN application_form_submissions s ON s.application_id = a.id
JOIN application_forms f ON f.id = s.form_id
GROUP BY c.id, c.full_name, c.phone_international, p.title
HAVING count(DISTINCT s.form_id) > 1
ORDER BY formularios_completados DESC;


-- ============================================================================
-- SECCIÓN 6 · Trazabilidad por formulario (lo que ve la ficha del candidato)
-- ============================================================================

SELECT
  c.full_name                                     AS candidato,
  c.phone_international                           AS whatsapp,
  a.id                                            AS postulacion,
  p.title                                         AS plaza,
  f.id                                            AS formulario_id,
  f.version                                       AS no_formulario,
  f.title                                         AS formulario,
  s.source                                        AS origen_participacion,
  s.submitted_at                                  AS fecha_participacion,
  count(aa.id)                                    AS respuestas_registradas
FROM applications a
JOIN candidates c ON c.id = a.candidate_id
JOIN job_positions p ON p.id = a.job_position_id
JOIN application_form_submissions s ON s.application_id = a.id
JOIN application_forms f ON f.id = s.form_id
LEFT JOIN application_answers aa
       ON aa.application_id = a.id
      AND aa.question_id IN (SELECT id FROM form_questions WHERE form_id = f.id)
GROUP BY c.full_name, c.phone_international, a.id, p.title, f.id, f.version, f.title, s.source, s.submitted_at
ORDER BY c.full_name, f.version;


-- ============================================================================
-- SECCIÓN 7 · Propiedad intelectual: metodología que NO debe viajar al navegador
-- El payload público entrega solo enunciado, ayuda, tipo, obligatoriedad, orden
-- y answer_config depurada (options/min/max). Estas columnas son reservadas.
-- ============================================================================

SELECT
  f.id                                            AS formulario_id,
  f.version                                       AS no_formulario,
  f.published                                     AS interruptor_encendido,
  count(q.id)                                     AS preguntas,
  count(*) FILTER (WHERE q.hard_fail)             AS con_descarte_critico,
  count(*) FILTER (WHERE jsonb_array_length(COALESCE(q.accepted_answers, '[]'::jsonb)) > 0) AS con_respuestas_aceptadas,
  count(*) FILTER (WHERE COALESCE(q.evaluation_criteria, '') <> '' OR COALESCE(q.ai_prompt, '') <> '') AS con_criterio_o_prompt
FROM application_forms f
LEFT JOIN form_questions q ON q.form_id = f.id AND q.active = true
GROUP BY f.id, f.version, f.published
ORDER BY f.id;

-- Simulación del payload público de una variante concreta:
-- sustituya el token por uno de la SECCIÓN 3.
-- SELECT q.field_key, q.label, q.type, q.required, q.order_index,
--        jsonb_build_object(
--          'options', q.answer_config -> 'options',
--          'min',     q.answer_config -> 'min',
--          'max',     q.answer_config -> 'max'
--        ) AS answer_config_publica
--   FROM application_forms f
--   JOIN form_questions q ON q.form_id = f.id AND q.active = true
--  WHERE f.public_token = 'PEGUE_AQUI_EL_TOKEN'
--  ORDER BY q.order_index;


-- ============================================================================
-- SECCIÓN 8 · OPCIONAL · Solo con criterio explícito. Está comentada.
-- Prefiera los botones del panel (interruptor, editar, importar) antes que SQL:
-- el panel registra auditoría y validación editorial; el SQL directo no.
-- ============================================================================

-- 8.1 Reparar un token ausente o demasiado corto (no debería ocurrir tras la
--     SECCIÓN 1; el índice único rechaza colisiones).
-- UPDATE application_forms
--    SET public_token = md5(random()::text || clock_timestamp()::text || id::text)
--  WHERE public_token IS NULL OR length(public_token) < 16;

-- 8.2 Encender el interruptor de una variante concreta.
--     ADVERTENCIA: omite normalizeStoredFormBundle y la auditoría del panel.
-- UPDATE application_forms SET published = true, updated_at = now() WHERE id = 0;

-- 8.3 Apagar el interruptor de una variante concreta (no borra evidencia).
-- UPDATE application_forms SET published = false, updated_at = now() WHERE id = 0;
