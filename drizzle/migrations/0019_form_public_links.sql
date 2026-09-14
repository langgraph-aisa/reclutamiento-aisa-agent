-- JARVI RH 2.0.138: enlace seguro propio por formulario, disponibilidad individual y trazabilidad por formulario.
-- Migración PostgreSQL idempotente. No contiene credenciales ni datos de candidatos.

-- Token de capacidad: identifica un formulario concreto en su enlace público.
ALTER TABLE application_forms ADD COLUMN IF NOT EXISTS public_token varchar(32);

-- Rellena los formularios existentes antes de exigir el valor.
DO $$
DECLARE
  target record;
BEGIN
  FOR target IN SELECT id FROM application_forms WHERE public_token IS NULL LOOP
    UPDATE application_forms
       SET public_token = md5(
             random()::text || clock_timestamp()::text || target.id::text
           )
     WHERE id = target.id
       AND public_token IS NULL;
  END LOOP;
END $$;

-- Todo formulario nuevo recibe un token aunque la aplicación no lo envíe.
ALTER TABLE application_forms
  ALTER COLUMN public_token SET DEFAULT md5(random()::text || clock_timestamp()::text);

-- Segunda pasada defensiva: ningún formulario puede quedar sin token.
UPDATE application_forms
   SET public_token = md5(random()::text || clock_timestamp()::text || id::text)
 WHERE public_token IS NULL;

ALTER TABLE application_forms ALTER COLUMN public_token SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS application_forms_public_token_uq
  ON application_forms (public_token);

-- La longitud mínima descarta valores vacíos o truncados en el enlace público.
ALTER TABLE application_forms DROP CONSTRAINT IF EXISTS application_forms_public_token_format_ck;
ALTER TABLE application_forms
  ADD CONSTRAINT application_forms_public_token_format_ck
  CHECK (length(public_token) >= 16);
