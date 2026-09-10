ALTER TABLE "job_positions" ALTER COLUMN "whatsapp_message" SET DEFAULT 'Gracias por postularse. Nos pondremos en contacto con usted para continuar con el proceso de evaluación.';--> statement-breakpoint

-- Homologa únicamente textos predeterminados del sistema. El contenido libre
-- redactado por administradores se conserva para evitar cambios semánticos.
UPDATE "job_positions"
SET "whatsapp_message" = 'Gracias por postularse. Nos pondremos en contacto con usted para continuar con el proceso de evaluación.'
WHERE btrim("whatsapp_message") = 'Gracias por aplicar. Te contactaremos para continuar con tu proceso de evaluación.';--> statement-breakpoint

UPDATE "integration_settings"
SET "setting_value" = 'Gracias por postularse. Nos pondremos en contacto con usted para continuar con el proceso de evaluación.',
    "updated_at" = now()
WHERE "provider" = 'recruitment'
  AND "setting_key" = 'whatsapp_message'
  AND btrim("setting_value") = 'Gracias por aplicar. Te contactaremos para continuar con tu proceso de evaluación.';--> statement-breakpoint

UPDATE "application_forms"
SET "intro" = 'Complete sus datos para postularse a esta plaza.',
    "updated_at" = now()
WHERE btrim("intro") = 'Completa tus datos para aplicar a esta plaza.';--> statement-breakpoint

UPDATE "form_questions"
SET "label" = replace(replace(replace(replace(replace(replace(replace(
      "label",
      '¿Cumples con', '¿Cumple con'),
      '¿Cuentas con', '¿Cuenta con'),
      ' experiencia relacionada tienes?', ' experiencia relacionada tiene?'),
      'Indica tu nivel académico alcanzado.', 'Indique su nivel académico alcanzado.'),
      ' municipio y zona resides?', ' municipio y zona reside?'),
      'Describe tu experiencia en', 'Describa su experiencia en'),
      '¿Cuántos años de experiencia tienes?', '¿Cuántos años de experiencia tiene?'),
    "help_text" = replace(replace(replace(
      "help_text",
      'Responde con información verificable.', 'Responda con información verificable.'),
      'Indica tu nivel académico alcanzado.', 'Indique su nivel académico alcanzado.'),
      'Explica cómo debe responder.', 'Explique cómo debe responder.'),
    "updated_at" = now()
WHERE "label" ~ '(Cumples|Cuentas|tienes\?|Indica tu|resides\?|Describe tu)'
   OR "help_text" ~ '(Responde con|Indica tu|Explica cómo)';--> statement-breakpoint

UPDATE "form_questions"
SET "evaluation_criteria" = replace(replace(
      "evaluation_criteria",
      'Considera calificado solo si', 'Considere que la persona está calificada solo si'),
      'conviértelos a meses totales', 'conviértalos a meses totales'),
    "updated_at" = now()
WHERE "evaluation_criteria" ~ '(Considera calificado|conviértelos a meses totales)';
