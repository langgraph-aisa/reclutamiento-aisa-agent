-- JARVI RH 2.0.129: configuración inicial segura de ApiChat.
-- Los secretos se crean vacíos y deben guardarse desde Administración >
-- Configuración > WhatsApp para que el servidor los cifre con AES-256-GCM.
BEGIN;

INSERT INTO integration_settings
  (provider, setting_key, setting_value, is_secret, updated_at)
VALUES
  ('apichat', 'api_mode', 'native', false, now()),
  ('apichat', 'api_endpoint', 'https://api.apichat.io/v1/sendText', false, now()),
  ('apichat', 'connect_to', 'apichat.io', false, now()),
  ('apichat', 'webhook_url', 'https://aisa-testing-n8n-testing.4ugrim.easypanel.host/webhook/apichat/incoming', false, now()),
  ('apichat', 'client_id', NULL, true, now()),
  ('apichat', 'token', NULL, true, now()),
  ('apichat', 'account_id', NULL, true, now())
ON CONFLICT (provider, setting_key) DO NOTHING;

COMMIT;
