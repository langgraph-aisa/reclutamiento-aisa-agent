# Variables vigentes de EasyPanel · JARVI RH

Última revisión: 11 de septiembre de 2026.

## Fuente de verdad

EasyPanel conserva únicamente secretos estructurales del servicio. Las credenciales operativas de OpenAI, Langfuse y ApiChat se administran desde la interfaz protegida y se almacenan cifradas en PostgreSQL. El navegador recibe estado y máscara, nunca el valor recuperable.

| Ámbito | Configuración | Fuente vigente |
| --- | --- | --- |
| Base de datos | `DATABASE_URL` | EasyPanel, secreto del servicio web |
| Sesión | `JWT_SECRET` | EasyPanel, secreto del servicio web |
| Cifrado de integraciones | `AGENT_SETTINGS_ENCRYPTION_KEY` | EasyPanel, secreto estable y dedicado |
| Correo | `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | EasyPanel |
| ApiChat | Modo, endpoint, conexión, webhook, Client ID, token y secreto entrante | Administración > Configuración > WhatsApp |
| OpenAI/Langfuse | Claves, modelos, voz, cuotas y preferencias | Administración > Agente de IA LangGraph |
| Puerto | `PORT` | Inyectado por EasyPanel |

No configure `OPENAI_API_KEY`, `N8N_AGENT_EVALUATION_URL` ni `N8N_MANUAL_STATUS_WEBHOOK_URL`: el runtime actual no consulta esas variables. Las credenciales de OpenAI, Langfuse y ApiChat se administran desde la interfaz protegida y se almacenan cifradas en PostgreSQL.

**Corrección de esta guía · 18 SEP 2026.** La versión anterior de este documento afirmaba que el runtime no consulta ninguna variable `APICHAT_*`. Esa afirmación es falsa para cuatro variables, y la primera condiciona la recepción por completo:

| Variable | ¿Obligatoria? | Efecto comprobado |
| --- | --- | --- |
| `APICHAT_WEBHOOK_SECRET` | **Sí, en producción** | Sin ella el webhook responde **503** a toda notificación; con ella y sin credencial válida responde **401** |
| `APICHAT_PUBLIC_BASE_URL` | Recomendada | Dirección pública con la que la bandeja anuncia al proveedor los archivos salientes |
| `APICHAT_MEDIA_ALLOWED_HOSTS` | Opcional | Dominios de medios admitidos, separados por coma; vacía, se admiten los destinos HTTPS públicos validados |
| `APICHAT_ACCOUNT_SCOPE` | Opcional | Ámbito de cuenta dentro de la clave de idempotencia de recepción |

La credencial del webhook viaja en la **URL** (`?key=…`) o en la cabecera `x-webhook-token`. **No se admite `Authorization: Bearer`** en esta ruta; configurarlo produce 401.

## Bloque de aplicación

Cada nombre debe registrarse como entrada independiente. No copie valores reales a documentación, capturas o logs.

```dotenv
NODE_ENV=production
DATABASE_URL=postgresql://USUARIO:CONTRASENA@HOST:5432/BASE?sslmode=require
JWT_SECRET=REEMPLAZAR_CON_VALOR_ALEATORIO_ESTABLE
AGENT_SETTINGS_ENCRYPTION_KEY=REEMPLAZAR_CON_OTRO_VALOR_ALEATORIO_ESTABLE
APICHAT_WEBHOOK_SECRET=REEMPLAZAR_CON_VALOR_ALEATORIO_ESTABLE
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=notificaciones@example.com
SMTP_PASSWORD=REEMPLAZAR
SMTP_FROM=Talento AISA <notificaciones@example.com>
```

La misma cadena de `APICHAT_WEBHOOK_SECRET` debe registrarse en la URL del webhook dentro del panel de ApiChat. `KNOWLEDGE_STORAGE_DIR` y `DOCUMENT_OCR_ENABLED` los declara la imagen; no hace falta repetirlos, salvo que el volumen se monte en otra ruta.

Genere `JWT_SECRET` y `AGENT_SETTINGS_ENCRYPTION_KEY` por separado, fuera del servidor:

```bash
openssl rand -base64 48
```

`AGENT_SETTINGS_ENCRYPTION_KEY` debe permanecer estable. El formato nuevo `enc:v2` usa AES-256-GCM, identificador de clave y AAD ligada a `provider:setting_key`. El servidor puede leer temporalmente valores `enc:v1` y materiales de respaldo para permitir su rotación; vuelva a guardar cada credencial para migrarla a `enc:v2` antes de retirar una fuente anterior.

## Despliegue

1. Configure las variables y seleccione Deploy/Redeploy.
2. Ejecute `pnpm install --frozen-lockfile` durante el build.
3. Aplique el esquema. **El camino correcto es el artefacto consolidado**, no `pnpm db:push`:

   ```bash
   pnpm deploy:sql
   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction \
        -f database/005_servicio_conversacional_listo.sql
   ```

   Al terminar debe imprimir el `GATE GLOBAL` en `OK`. **Corrección · 18 SEP 2026:** la versión anterior de esta guía indicaba `pnpm db:push`; esa orden ejecuta `drizzle-kit migrate` contra un diario que **termina en `0014_cognitive_governance`**, de modo que **no aplica** las migraciones `0035` a `0037` —traza del conducto, recepción durable y cola de procesamiento documental— y la instancia queda sin poder recibir archivo alguno. **No use `drizzle-kit push`**: borraría la tabla de trazas, que no está declarada en el esquema de Drizzle.
4. Ingrese como Administrador.
5. Guarde y verifique OpenAI/Langfuse en Agente de IA LangGraph.
6. Guarde y verifique ApiChat en Configuración > WhatsApp.
7. Use datos ficticios para la primera prueba controlada.

La migración no contiene tokens ni Client ID reales. El query inicial documentado en `ANALISIS_COGNITIVO_DORA_2.0.130.md` crea preferencias públicas y filas secretas nulas; los valores recuperables se ingresan exclusivamente por las tarjetas seguras.

## ApiChat directo

El backend evalúa directamente y envía ApiChat después del commit. La recepción no requiere importaciones: el puente `inboxSync` consulta `GET /v1/messages` cada segundo y rellena la bandeja con entradas y salidas deduplicadas por `providerMessageId`. No sustituya marcadores de credenciales por secretos dentro de archivos versionados ni presente esperas históricas como parte del runtime vigente.

## Verificación técnica

```bash
pnpm release:verify
pnpm test:black-box
pnpm test
pnpm check
pnpm build
```

Confirme además:

- ninguna respuesta administrativa contiene secretos completos;
- una credencial copiada entre proveedor o campo falla por AAD;
- ApiChat verifica estado sin enviar mensajes ni devolver QR;
- el webhook normalizado rechaza Bearer inválido y JSON no admitido;
- la rotación principal/respaldo de OpenAI se prueba con contenido sintético;
- respaldo, restauración y tiempos RPO/RTO se prueban en el ambiente objetivo.

## Diagnóstico

| Síntoma | Acción segura |
| --- | --- |
| PostgreSQL no conecta | Revise host interno, usuario, SSL y `DATABASE_URL`; no imprima la cadena completa. |
| La sesión se invalida al desplegar | Restaure el mismo `JWT_SECRET`. |
| Una credencial no puede descifrarse | Restaure la clave anterior, rote desde la UI y luego retire el material previo. |
| ApiChat responde 401/403 | Rote Client ID/token desde Configuración y use Verificar. |
| El webhook responde 401 | Compruebe que la URL registrada en ApiChat incluye `?key=<APICHAT_WEBHOOK_SECRET>` o que envía la cabecera `x-webhook-token`. La ruta no acepta `Authorization: Bearer`. |
| El webhook responde 503 | Falta `APICHAT_WEBHOOK_SECRET` en el servicio o la base no está disponible. Ambos casos se distinguen en la bitácora. |
| No llega ningún evento entrante | 1) Confirme que el canal de ApiChat está configurado y verificado en `Configuración › WhatsApp`. 2) Compruebe que la URL del webhook apunta al host público de producción. 3) Verifique con `POST /api/apichat/webhook?key=…` y contenido de prueba; un `GET` devuelve el HTML del aplicativo y **no** es una prueba válida. 4) Ejecute la verificación de tablas del apéndice de recepción. |
| Audio o CV no aparece | Puede estar recibido y rechazado por política, o conservado sin interpretar. Consulte la sección «Conducto del adjunto» de la Auditoría del canal de ApiChat y la tabla del apéndice: son estados distintos y ninguno autoriza a afirmar que el candidato no envió. |

## Límites

La presencia de pruebas automatizadas y controles ISO/DORA no constituye certificación. Permanecen como brechas declaradas el registro WORM de la bitácora, la custodia probatoria de la traza más allá de su retención de catorce días y la verificación de capacidad efectiva de OCR y transcodificación en el despliegue objetivo. **Corrección · 18 SEP 2026:** las ediciones anteriores declaraban aquí la ingesta de PDF, Word, MP3 y OGG como no implementada; esa afirmación dejó de ser cierta en 2.0.180–2.182. La recepción, la conservación, la extracción documental, el OCR gobernado y la transcripción están implementados y verificados por la caja negra del repositorio. La brecha vigente no es la recepción, sino el diagnóstico de los rechazos de política y el reproceso de un recibo agotado. Véase `docs/audits/2026-09-18-apichat/reauditoria_2.0.183.md`.

---

## Apéndice · Verificación de recepción en la instancia

Se ejecuta con un rol autorizado de lectura, antes de diagnosticar cualquier pérdida.

```sql
-- 1. ¿El conducto existe? Si alguna columna sale NULL, ninguna notificación puede conservarse.
SELECT to_regclass('public.apichat_inbound_receipts')      AS recibos,
       to_regclass('public.candidate_document_jobs')       AS trabajos,
       to_regclass('public.conversation_transport_traces') AS trazas;

-- 2. ¿Qué formatos admite la política del expediente?
--    Si falta 'ogg','opus','m4a','amr','aac','doc' o 'pdf', el archivo llega y no entra al expediente.
SELECT setting_value FROM integration_settings
 WHERE provider='knowledge' AND setting_key='allowed_extensions';

-- 3. ¿Existe destinatario para el teléfono del candidato?
--    Un teléfono sin postulación o sin conversación produce recibo agotado a los ≈21 minutos.
SELECT c.phone_international, conv.status, c.id AS conversation_id
  FROM candidates c
  JOIN applications a ON a.candidate_id = c.id
  JOIN conversations conv ON conv.application_id = a.id
 WHERE conv.provider='apichat' AND conv.status IN ('pendiente','activo');

-- 4. ¿Qué le ocurrió al mensaje investigado?
SELECT provider_message_id, origin, status, outcome, attempts, last_error
  FROM apichat_inbound_receipts
 ORDER BY received_at DESC LIMIT 20;
```

El expediente forense completo —con el árbol de decisión y las consultas por puerta— está en `docs/audits/2026-09-18-apichat/consultas_solo_lectura.sql`. El paso a paso de puesta en vivo está en `docs/audits/2026-09-18-apichat/plan_puesta_en_vivo.md`.
