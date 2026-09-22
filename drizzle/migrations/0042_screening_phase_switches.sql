-- 0042 · Interruptores de precalificación y entrevista por plaza
--
-- La plaza declara si el agente administra cada fase del banco de preguntas.
-- Por omisión ambas fases quedan habilitadas: la precalificación arranca al
-- recibir el CV y la entrevista al concluir la precalificación. Con la
-- entrevista apagada, el cierre institucional (agradecimiento y aviso de
-- contacto) se emite al concluir la precalificación, sin anunciar el paso.
-- Idempotente: se puede repetir sin efecto.

ALTER TABLE job_positions
  ADD COLUMN IF NOT EXISTS screening_precalificacion_enabled boolean NOT NULL DEFAULT true;

ALTER TABLE job_positions
  ADD COLUMN IF NOT EXISTS screening_entrevista_enabled boolean NOT NULL DEFAULT true;
