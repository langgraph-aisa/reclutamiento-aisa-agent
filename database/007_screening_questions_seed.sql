-- ============================================================================
-- 007 · Banco de preguntas de screening para la plaza
--       «Ejecutivo de Negocios (Ventas)»
-- ============================================================================
-- Carga idempotente y detallada de las directrices de la ficha, distribuidas en
-- las dos fases que administra el agente:
--
--   precalificacion  → filtros iniciales (después de recibir el CV)
--   entrevista       → segunda ronda (solo si supera la precalificación)
--
-- Cada pregunta declara:
--   field_key            clave única por plaza+fase (base de dependencias)
--   prompt               el texto exacto que recibe el candidato por WhatsApp
--   help_text            ayuda opcional que se envía debajo de la pregunta
--   hard_fail            descarte directo (sí/no)
--   accepted_answers     respuestas que aprueban la condición (jsonb)
--   answer_config        rango numérico cuando aplica (jsonb; p. ej. años)
--   evaluation_criteria  criterio que la IA usa para reforzar el descarte
--   depends_on_field_key dependencia opcional entre preguntas
--
-- El script es repetible: ON CONFLICT sobre (job_position_id, phase, field_key)
-- actualiza la pregunta en lugar de duplicarla. No borra preguntas ajenas a
-- esta carga ni modifica otras plazas.

BEGIN;

DO $$
DECLARE
  v_plaza bigint;
  v_precalificacion integer;
  v_entrevista integer;
BEGIN
  SELECT id INTO v_plaza
    FROM job_positions
   WHERE title = 'Ejecutivo de Negocios (Ventas)'
   ORDER BY id
   LIMIT 1;

  IF v_plaza IS NULL THEN
    RAISE EXCEPTION 'No existe la plaza «Ejecutivo de Negocios (Ventas)». Cree la plaza antes de cargar el screening.';
  END IF;

  ----------------------------------------------------------------------------
  -- FASE 1 · PRECALIFICACIÓN
  ----------------------------------------------------------------------------
  INSERT INTO screening_questions
    (job_position_id, phase, field_key, order_index, prompt, help_text, type,
     hard_fail, accepted_answers, answer_config, evaluation_criteria,
     depends_on_field_key)
  VALUES
    (
      v_plaza, 'precalificacion', 'residencia_guatemala', 0,
      '¿Reside usted dentro del departamento de Guatemala?',
      'Responda sí o no.',
      'texto',
      true,
      '["sí","si","resido en guatemala","vivo en guatemala"]'::jsonb,
      '{}'::jsonb,
      'Apruebe solo si la persona confirma residir dentro del departamento de Guatemala.',
      NULL
    ),
    (
      v_plaza, 'precalificacion', 'laborando_actualmente', 1,
      '¿Se encuentra laborando actualmente?',
      'Responda sí o no.',
      'texto',
      true,
      '["no","desempleado","desempleada","sin trabajo"]'::jsonb,
      '{}'::jsonb,
      'Apruebe solo si la persona declara NO estar laborando actualmente.',
      NULL
    ),
    (
      v_plaza, 'precalificacion', 'experiencia_ventas', 2,
      '¿Cuántos años de experiencia en ventas acumula?',
      'Responda solo con el número de años completos, por ejemplo: 3.',
      'texto',
      true,
      '[]'::jsonb,
      '{"min":2}'::jsonb,
      'Apruebe solo si la experiencia declarada es de 2 años o más. Si responde en meses, convierta a años antes de decidir.',
      NULL
    ),
    (
      v_plaza, 'precalificacion', 'licencia_conducir', 3,
      '¿Posee licencia de conducir tipo A, B o C vigente, o vencida que pueda renovar de inmediato?',
      'Responda sí o no.',
      'texto',
      true,
      '["sí","si","tengo licencia"]'::jsonb,
      '{}'::jsonb,
      'Apruebe solo si declara poseer licencia de conducir A, B o C vigente o renovable de inmediato.',
      NULL
    ),
    (
      v_plaza, 'precalificacion', 'disponibilidad_campo', 4,
      '¿Tiene disponibilidad para trabajo de campo y para laborar fines de semana cuando sea necesario?',
      'Responda sí o no.',
      'texto',
      true,
      '["sí","si"]'::jsonb,
      '{}'::jsonb,
      'Apruebe solo si confirma disponibilidad para trabajo de campo y fines de semana.',
      NULL
    ),
    (
      v_plaza, 'precalificacion', 'compromisos_horarios', 5,
      '¿Tiene compromisos que limiten su disponibilidad horaria?',
      'Responda sí o no.',
      'texto',
      true,
      '["no"]'::jsonb,
      '{}'::jsonb,
      'Apruebe solo si declara NO tener compromisos que limiten la disponibilidad horaria.',
      NULL
    ),
    (
      v_plaza, 'precalificacion', 'disponibilidad_viajes', 6,
      '¿Tiene disponibilidad para realizar viajes ocasionales al interior del país?',
      'Responda sí o no.',
      'texto',
      true,
      '["sí","si"]'::jsonb,
      '{}'::jsonb,
      'Apruebe solo si confirma disponibilidad para viajes ocasionales al interior.',
      NULL
    ),
    (
      v_plaza, 'precalificacion', 'negocios_propios', 7,
      '¿Posee negocios propios?',
      'Responda sí o no.',
      'texto',
      true,
      '["no"]'::jsonb,
      '{}'::jsonb,
      'Apruebe solo si declara NO poseer negocios propios.',
      NULL
    ),
    (
      v_plaza, 'precalificacion', 'transporte_propio', 8,
      '¿Cuenta con transporte propio, motocicleta o vehículo?',
      'Responda sí o no.',
      'texto',
      true,
      '["sí","si"]'::jsonb,
      '{}'::jsonb,
      'Apruebe solo si confirma contar con motocicleta o vehículo propio.',
      NULL
    ),
  ----------------------------------------------------------------------------
  -- FASE 2 · ENTREVISTA
  ----------------------------------------------------------------------------
    (
      v_plaza, 'entrevista', 'ajuste_productos', 0,
      'Tras revisar nuestros productos y servicios en el sitio web, ¿confirma que se ajusta a venderlos?',
      'Indique si está de acuerdo.',
      'texto',
      true,
      '["sí","si","estoy de acuerdo","me ajusto"]'::jsonb,
      '{}'::jsonb,
      'Apruebe solo si confirma que se ajusta a vender los productos y servicios de la empresa.',
      NULL
    ),
    (
      v_plaza, 'entrevista', 'salario_comisiones', 1,
      '¿Está dispuesto a trabajar con salario base (salario mínimo) y bonificaciones por ventas que aumentan conforme crecen las ventas mensuales?',
      'Responda sí o no.',
      'texto',
      true,
      '["sí","si","estoy dispuesto","acepto"]'::jsonb,
      '{}'::jsonb,
      'Apruebe solo si acepta salario base más bonificaciones por ventas.',
      NULL
    ),
    (
      v_plaza, 'entrevista', 'trabajo_presencial', 2,
      '¿Está dispuesto a trabajar de forma presencial en nuestras oficinas de la Zona 10?',
      'Responda sí o no.',
      'texto',
      true,
      '["sí","si","estoy dispuesto","acepto"]'::jsonb,
      '{}'::jsonb,
      'Apruebe solo si acepta el trabajo presencial en la Zona 10.',
      NULL
    ),
    (
      v_plaza, 'entrevista', 'pruebas_ingreso', 3,
      '¿Está dispuesto a pasar las pruebas de ingreso, incluidas la de confiabilidad y las psicométricas?',
      'Responda sí o no.',
      'texto',
      true,
      '["sí","si","estoy dispuesto","acepto"]'::jsonb,
      '{}'::jsonb,
      'Apruebe solo si acepta las pruebas de ingreso.',
      NULL
    ),
    (
      v_plaza, 'entrevista', 'horarios_laborales', 4,
      '¿Está de acuerdo con los horarios laborales de la plaza?',
      'Responda sí o no.',
      'texto',
      true,
      '["sí","si","estoy de acuerdo","acepto"]'::jsonb,
      '{}'::jsonb,
      'Apruebe solo si acepta los horarios laborales.',
      NULL
    ),
    (
      v_plaza, 'entrevista', 'condiciones_laborales', 5,
      '¿Está de acuerdo con las condiciones laborales, incluidas las prestaciones de ley?',
      'Responda sí o no.',
      'texto',
      true,
      '["sí","si","estoy de acuerdo","acepto"]'::jsonb,
      '{}'::jsonb,
      'Apruebe solo si acepta las condiciones laborales.',
      NULL
    )
  ON CONFLICT (job_position_id, phase, field_key) DO UPDATE SET
    prompt = EXCLUDED.prompt,
    help_text = EXCLUDED.help_text,
    type = EXCLUDED.type,
    order_index = EXCLUDED.order_index,
    hard_fail = EXCLUDED.hard_fail,
    accepted_answers = EXCLUDED.accepted_answers,
    answer_config = EXCLUDED.answer_config,
    evaluation_criteria = EXCLUDED.evaluation_criteria,
    depends_on_field_key = EXCLUDED.depends_on_field_key,
    active = true,
    updated_at = now();

  SELECT count(*) INTO v_precalificacion
    FROM screening_questions
   WHERE job_position_id = v_plaza AND phase = 'precalificacion' AND active = true;

  SELECT count(*) INTO v_entrevista
    FROM screening_questions
   WHERE job_position_id = v_plaza AND phase = 'entrevista' AND active = true;

  RAISE NOTICE 'Screening cargado para la plaza %: % preguntas de precalificación y % de entrevista.',
    v_plaza, v_precalificacion, v_entrevista;
END $$;

COMMIT;
