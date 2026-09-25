-- 0044_dropbox_custody.sql
-- Sustituye Google Drive por Dropbox como única fuente de custodia del RAG de
-- proyectos y del RAG personal de cada candidato.
--
-- Qué cambia:
--   1. Retira las credenciales de Google Drive: la plataforma ya no las lee.
--   2. Renombra la cuenta que respalda cada proyecto a `dropbox_connection_user_id`.
--   3. Conmuta a 'dropbox' los proyectos que custodiaban en Drive y amplía la
--      restricción del modo de almacenamiento.
--
-- Es idempotente: repetirla no altera el resultado y no contiene credenciales.

-- 1. Credenciales de la plataforma anterior.
DELETE FROM "public"."integration_settings" WHERE "provider" = 'google_drive';

-- 2. Cuenta que respalda cada proyecto.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'knowledge_projects'
       AND column_name = 'drive_connection_user_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'knowledge_projects'
       AND column_name = 'dropbox_connection_user_id'
  ) THEN
    ALTER TABLE "public"."knowledge_projects"
      RENAME COLUMN "drive_connection_user_id" TO "dropbox_connection_user_id";
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'knowledge_projects_drive_connection_user_id_fkey'
  ) THEN
    ALTER TABLE "public"."knowledge_projects"
      RENAME CONSTRAINT "knowledge_projects_drive_connection_user_id_fkey"
      TO "knowledge_projects_dropbox_connection_user_id_fkey";
  END IF;
END $$;

-- 3. Modo de almacenamiento vigente.
ALTER TABLE "public"."knowledge_projects"
  DROP CONSTRAINT IF EXISTS "knowledge_projects_storage_mode_check";

UPDATE "public"."knowledge_projects"
   SET "storage_mode" = 'dropbox'
 WHERE "storage_mode" = 'drive';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'knowledge_projects_storage_mode_check'
  ) THEN
    ALTER TABLE "public"."knowledge_projects"
      ADD CONSTRAINT "knowledge_projects_storage_mode_check"
      CHECK ("storage_mode" IN ('local', 'dropbox'));
  END IF;
END $$;
