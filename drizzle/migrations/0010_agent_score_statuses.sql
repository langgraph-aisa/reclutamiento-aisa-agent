ALTER TYPE "public"."application_status" ADD VALUE IF NOT EXISTS 'pre_calificado_prioritario' BEFORE 'pre_calificado';--> statement-breakpoint
ALTER TYPE "public"."application_status" ADD VALUE IF NOT EXISTS 'pre_calificado_condicionado' AFTER 'pre_calificado';--> statement-breakpoint
ALTER TYPE "public"."evaluation_status" ADD VALUE IF NOT EXISTS 'pre_calificado_prioritario' BEFORE 'pre_calificado';--> statement-breakpoint
ALTER TYPE "public"."evaluation_status" ADD VALUE IF NOT EXISTS 'pre_calificado_condicionado' AFTER 'pre_calificado';--> statement-breakpoint
CREATE OR REPLACE FUNCTION finalize_application_evaluation(app_id integer, evaluation jsonb)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  normalized_status application_status;
  normalized_status_key text;
  evaluation_score integer;
BEGIN
  IF evaluation->>'criticalDisqualification' = 'true'
     OR evaluation#>>'{deterministic,passed}' = 'false' THEN
    normalized_status_key := 'no_calificado';
  ELSIF COALESCE(evaluation->>'score', '') ~ '^[0-9]+([.][0-9]+)?$' THEN
    evaluation_score := GREATEST(
      0,
      LEAST(100, ROUND((evaluation->>'score')::numeric)::integer)
    );
    normalized_status_key := CASE
      WHEN evaluation_score >= 90 THEN 'pre_calificado_prioritario'
      WHEN evaluation_score >= 80 THEN 'pre_calificado'
      WHEN evaluation_score >= 70 THEN 'pre_calificado_condicionado'
      WHEN evaluation_score >= 60 THEN 'pendiente_revision_humana'
      ELSE 'no_calificado'
    END;
  ELSE
    normalized_status_key := CASE evaluation->>'status'
      WHEN 'pre_calificado_prioritario' THEN 'pre_calificado_prioritario'
      WHEN 'pre_calificado' THEN 'pre_calificado'
      WHEN 'pre_calificado_condicionado' THEN 'pre_calificado_condicionado'
      WHEN 'no_calificado' THEN 'no_calificado'
      WHEN 'pendiente_revision_humana' THEN 'pendiente_revision_humana'
      ELSE 'error_procesamiento'
    END;
  END IF;
  normalized_status := normalized_status_key::application_status;

  INSERT INTO evaluations (application_id, status, reason, profile_summary, rule_results, ai_payload, ai_model)
  VALUES (app_id, normalized_status::text::evaluation_status, COALESCE(evaluation->>'reason','Sin motivo'), COALESCE(evaluation->>'profileSummary','Sin resumen'), COALESCE(evaluation->'ruleResults','[]'::jsonb), evaluation, evaluation->>'aiModel');

  UPDATE application_answers aa
  SET deterministic_result = rules.result
  FROM jsonb_to_recordset(COALESCE(evaluation->'ruleResults','[]'::jsonb)) AS rules(question_id integer, result varchar)
  WHERE aa.application_id = app_id AND aa.question_id = rules.question_id;

  UPDATE applications
  SET status = normalized_status,
      evaluation_at = now(),
      evaluation_reason = COALESCE(evaluation->>'reason','Sin motivo'),
      profile_summary = COALESCE(evaluation->>'profileSummary','Sin resumen'),
      updated_at = now()
  WHERE id = app_id;

  RETURN jsonb_build_object('applicationId', app_id, 'status', normalized_status, 'reason', evaluation->>'reason', 'profileSummary', evaluation->>'profileSummary');
END;
$$;
