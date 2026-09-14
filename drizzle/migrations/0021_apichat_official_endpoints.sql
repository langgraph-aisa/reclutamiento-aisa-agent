-- JARVI RH: línea base de la API nativa de ApiChat y de sus endpoints oficiales.
-- Migración PostgreSQL idempotente. No contiene credenciales ni datos personales.
-- Igual que 0015 a 0020, se aplica de forma manual y no se registra en el
-- diario de Drizzle para no alterar su último índice histórico.

-- Base oficial normalizada. El código acepta la base con o sin operación
-- (/v1/, /v1/sendText, /v1/messages) y la reduce a esta forma canónica.
INSERT INTO integration_settings (provider, setting_key, setting_value, is_secret, updated_at)
VALUES
  ('apichat', 'api_mode', 'native', false, now()),
  ('apichat', 'api_endpoint', 'https://api.apichat.io/v1/', false, now()),
  ('apichat', 'connect_to', 'apichat.io', false, now())
ON CONFLICT (provider, setting_key) DO NOTHING;

-- Endpoints oficiales del proveedor.
--   Encendidos: texto, archivo, enlace, ubicación e historial.
--     El historial es requisito de recepción; sin él la bandeja no sincroniza.
--   Apagados: nota de voz (requiere pipeline de audio no aprobado) y borrado
--     de mensajes (operación destructiva sujeta a procedimiento).
-- DO NOTHING preserva la decisión del operador en despliegues posteriores.
INSERT INTO integration_settings (provider, setting_key, setting_value, is_secret, updated_at)
VALUES
  ('apichat', 'endpoint_enabled:/sendMessage', 'true', false, now()),
  ('apichat', 'endpoint_enabled:/sendFile', 'true', false, now()),
  ('apichat', 'endpoint_enabled:/sendLink', 'true', false, now()),
  ('apichat', 'endpoint_enabled:/sendLocation', 'true', false, now()),
  ('apichat', 'endpoint_enabled:/messagesHistory', 'true', false, now()),
  ('apichat', 'endpoint_enabled:/sendPTT', 'false', false, now()),
  ('apichat', 'endpoint_enabled:/deleteMessage', 'false', false, now())
ON CONFLICT (provider, setting_key) DO NOTHING;
