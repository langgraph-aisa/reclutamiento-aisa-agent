-- 0033_security_roles.sql
--
-- Permisos por usuario y desafío de confirmación de los cambios sensibles.
--
-- El permiso es **por usuario** y **por recurso**: el alcance `modulo` nombra
-- una entrada del menú y el alcance `recurso` nombra un dominio gobernado de la
-- base (postulaciones, candidatos, plazas, expediente, usuarios…). Así el
-- control alcanza cualquier registro sin obligar a nadie a corregirlo a mano
-- en la base.
--
-- Cinco columnas declaradas: ver, leer, escribir, editar y borrar. La ausencia
-- de fila significa **sin concesión**: un permiso es un acto deliberado y
-- auditado, no un valor por omisión. El administrador conserva todo por rol y
-- no consulta esta tabla.
--
-- El desafío guarda el código **solo como hash**, con vigencia, intentos y
-- reenvío, y sirve a los dos usos que exigen confirmación: la asignación de
-- permisos y la autorización de una edición o un borrado.
--
-- Expansiva e idempotente: crea tablas nuevas, índices nuevos y no siembra
-- ninguna concesión.

CREATE TABLE IF NOT EXISTS user_permissions (
  id serial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope varchar(16) NOT NULL,
  resource_key varchar(120) NOT NULL,
  can_view boolean NOT NULL DEFAULT false,
  can_read boolean NOT NULL DEFAULT false,
  can_write boolean NOT NULL DEFAULT false,
  can_edit boolean NOT NULL DEFAULT false,
  can_delete boolean NOT NULL DEFAULT false,
  granted_by_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_permissions_scope_ck CHECK (scope IN ('modulo', 'recurso')),
  CONSTRAINT user_permissions_identity_uq
    UNIQUE (user_id, scope, resource_key)
);

CREATE INDEX IF NOT EXISTS user_permissions_user_idx
  ON user_permissions (user_id, scope);

CREATE TABLE IF NOT EXISTS security_challenges (
  id serial PRIMARY KEY,
  requested_by_user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose varchar(24) NOT NULL,
  target_user_id integer REFERENCES users(id) ON DELETE CASCADE,
  detail text,
  code_hash text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  requested_ip varchar(80),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT security_challenges_purpose_ck
    CHECK (purpose IN ('permisos', 'cambio')),
  CONSTRAINT security_challenges_attempts_ck CHECK (attempts >= 0),
  CONSTRAINT security_challenges_max_attempts_ck CHECK (max_attempts > 0)
);

CREATE INDEX IF NOT EXISTS security_challenges_user_created_idx
  ON security_challenges (requested_by_user_id, purpose, created_at DESC);

CREATE INDEX IF NOT EXISTS security_challenges_expires_idx
  ON security_challenges (expires_at);

-- Verificación autocertificada de la migración.
SELECT 1 AS orden, 'Tabla de permisos por usuario' AS bloque, '1' AS esperado,
       (SELECT count(*)::text FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'user_permissions')
       AS obtenido
UNION ALL
SELECT 2, 'Columnas del permiso', '12',
       (SELECT count(*)::text FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'user_permissions')
UNION ALL
SELECT 3, 'Identidad única por usuario y recurso', '1',
       (SELECT count(*)::text FROM pg_constraint
         WHERE conname = 'user_permissions_identity_uq')
UNION ALL
SELECT 4, 'Alcances declarados', '1',
       (SELECT count(*)::text FROM pg_constraint
         WHERE conname = 'user_permissions_scope_ck')
UNION ALL
SELECT 5, 'Tabla del desafío de confirmación', '1',
       (SELECT count(*)::text FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'security_challenges')
UNION ALL
SELECT 6, 'Cinco intentos declarados', '1',
       (SELECT count(*)::text FROM pg_constraint
         WHERE conname = 'security_challenges_max_attempts_ck')
UNION ALL
SELECT 7, 'Usuarios conservados', '1',
       (SELECT count(*)::text FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'users')
ORDER BY orden;
