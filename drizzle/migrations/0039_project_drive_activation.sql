-- 0039_project_drive_activation.sql
-- Activa la custodia por proyecto de forma explícita y reversible, y abre el
-- rol «Administrador de proyectos» para asignar y rotar la cuenta de Drive que
-- respalda cada proyecto.
ALTER TYPE "public"."user_role" ADD VALUE IF NOT EXISTS 'project_admin' BEFORE 'admin';

ALTER TABLE "public"."knowledge_projects"
  ADD COLUMN IF NOT EXISTS "drive_connection_user_id" integer REFERENCES "public"."users"("id") ON DELETE SET NULL;

ALTER TABLE "public"."knowledge_projects"
  ADD COLUMN IF NOT EXISTS "storage_mode" text NOT NULL DEFAULT 'local';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'knowledge_projects_storage_mode_check'
  ) THEN
    ALTER TABLE "public"."knowledge_projects"
      ADD CONSTRAINT "knowledge_projects_storage_mode_check"
      CHECK ("storage_mode" IN ('local', 'drive'));
  END IF;
END $$;
