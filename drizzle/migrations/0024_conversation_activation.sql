-- JARVI RH 2.0.144: activación del servicio conversacional en el panel de configuración.
-- Migración PostgreSQL idempotente. No contiene credenciales ni datos personales.
--
-- Decisión de diseño: la activación deja de depender de variables de entorno.
-- Al aplicar esta migración el servicio queda **preactivado** con valores de
-- fábrica seguros; el operador ajusta cualquier interruptor desde
-- Configuración › WhatsApp y el cambio se audita. Las variables de entorno
-- permanecen únicamente como anulación manual para despliegues avanzados.

INSERT INTO integration_settings
  (provider, setting_key, setting_value, is_secret, updated_at)
VALUES
  ('conversation', 'agent_enabled',            'true',   false, now()),
  ('conversation', 'service_mode',             'single', false, now()),
  ('conversation', 'capability_receive',       'true',   false, now()),
  ('conversation', 'capability_reason',        'true',   false, now()),
  ('conversation', 'capability_send',          'true',   false, now()),
  ('conversation', 'outbox_dispatch_enabled',  'true',   false, now()),
  ('conversation', 'memory_turns',             '12',     false, now()),
  ('conversation', 'response_word_limit',      '90',     false, now())
ON CONFLICT (provider, setting_key) DO NOTHING;
