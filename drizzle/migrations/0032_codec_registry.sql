-- 0032_codec_registry.sql
--
-- Registro de códecs y decodificadores del transporte, entregado **activado**.
--
-- El artefacto recibe lo que WhatsApp admite: el catálogo separa contenedor de
-- códec y declara, por entrada, qué hace el artefacto con ella. Esta migración
-- siembra las veinticinco entradas del catálogo con su interruptor encendido,
-- de modo que la instalación nazca completa y el operador solo apague lo que
-- decida mantener.
--
-- No sobrescribe decisiones: `DO NOTHING` conserva el valor que ya exista, de
-- modo que reaplicar la migración nunca revierte un apagado deliberado.
--
-- Expansiva e idempotente: inserta filas de configuración y no altera ni
-- elimina ninguna estructura existente.

INSERT INTO integration_settings
  (provider,setting_key,setting_value,is_secret,updated_at)
VALUES
  ('codecs','codec_enabled:audio-ogg-opus','true',false,now()),
  ('codecs','codec_enabled:audio-ogg-vorbis','true',false,now()),
  ('codecs','codec_enabled:audio-m4a-aac','true',false,now()),
  ('codecs','codec_enabled:audio-mp4-aac','true',false,now()),
  ('codecs','codec_enabled:audio-amr','true',false,now()),
  ('codecs','codec_enabled:audio-mp3','true',false,now()),
  ('codecs','codec_enabled:audio-webm-opus','true',false,now()),
  ('codecs','codec_enabled:video-mp4-h264','true',false,now()),
  ('codecs','codec_enabled:video-mp4-hevc','true',false,now()),
  ('codecs','codec_enabled:video-mp4-mpeg4','true',false,now()),
  ('codecs','codec_enabled:video-3gp','true',false,now()),
  ('codecs','codec_enabled:video-mov','true',false,now()),
  ('codecs','codec_enabled:imagen-jpeg','true',false,now()),
  ('codecs','codec_enabled:imagen-png','true',false,now()),
  ('codecs','codec_enabled:imagen-webp','true',false,now()),
  ('codecs','codec_enabled:doc-pdf','true',false,now()),
  ('codecs','codec_enabled:doc-docx','true',false,now()),
  ('codecs','codec_enabled:doc-doc','true',false,now()),
  ('codecs','codec_enabled:doc-xlsx','true',false,now()),
  ('codecs','codec_enabled:doc-xls','true',false,now()),
  ('codecs','codec_enabled:doc-pptx','true',false,now()),
  ('codecs','codec_enabled:doc-txt','true',false,now()),
  ('codecs','codec_enabled:doc-csv','true',false,now()),
  ('codecs','codec_enabled:doc-odt','true',false,now()),
  ('codecs','codec_enabled:doc-ods','true',false,now())
ON CONFLICT (provider,setting_key) DO NOTHING;

-- Verificación autocertificada de la migración.
SELECT 1 AS orden, 'Entradas del registro de códecs' AS bloque, '25' AS esperado,
       (SELECT count(*)::text FROM integration_settings
         WHERE provider = 'codecs') AS obtenido
UNION ALL
SELECT 2, 'Entradas entregadas activadas', '25',
       (SELECT count(*)::text FROM integration_settings
         WHERE provider = 'codecs' AND setting_value = 'true')
UNION ALL
SELECT 3, 'Claves únicas por entrada', '25',
       (SELECT count(DISTINCT setting_key)::text FROM integration_settings
         WHERE provider = 'codecs')
UNION ALL
SELECT 4, 'Ninguna entrada se guarda como secreto', '0',
       (SELECT count(*)::text FROM integration_settings
         WHERE provider = 'codecs' AND is_secret = true)
UNION ALL
SELECT 5, 'Configuración de integración conservada', '1',
       (SELECT count(*)::text FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'integration_settings')
ORDER BY orden;
