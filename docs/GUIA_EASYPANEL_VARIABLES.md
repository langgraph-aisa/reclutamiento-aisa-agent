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

No configure `APICHAT_*`, `OPENAI_API_KEY`, `N8N_AGENT_EVALUATION_URL` ni `N8N_MANUAL_STATUS_WEBHOOK_URL` para el runtime actual. Las funciones activas no consultan esas variables.

## Bloque de aplicación

Cada nombre debe registrarse como entrada independiente. No copie valores reales a documentación, capturas o logs.

```dotenv
NODE_ENV=production
DATABASE_URL=postgresql://USUARIO:CONTRASENA@HOST:5432/BASE?sslmode=require
JWT_SECRET=REEMPLAZAR_CON_VALOR_ALEATORIO_ESTABLE
AGENT_SETTINGS_ENCRYPTION_KEY=REEMPLAZAR_CON_OTRO_VALOR_ALEATORIO_ESTABLE
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=notificaciones@example.com
SMTP_PASSWORD=REEMPLAZAR
SMTP_FROM=Talento AISA <notificaciones@example.com>
```

Genere `JWT_SECRET` y `AGENT_SETTINGS_ENCRYPTION_KEY` por separado, fuera del servidor:

```bash
openssl rand -base64 48
```

`AGENT_SETTINGS_ENCRYPTION_KEY` debe permanecer estable. El formato nuevo `enc:v2` usa AES-256-GCM, identificador de clave y AAD ligada a `provider:setting_key`. El servidor puede leer temporalmente valores `enc:v1` y materiales de respaldo para permitir su rotación; vuelva a guardar cada credencial para migrarla a `enc:v2` antes de retirar una fuente anterior.

## Despliegue

1. Configure las variables y seleccione Deploy/Redeploy.
2. Ejecute `pnpm install --frozen-lockfile` durante el build.
3. Aplique el journal PostgreSQL con `pnpm db:push`; debe finalizar en `0014_cognitive_governance`.
4. Ingrese como Administrador.
5. Guarde y verifique OpenAI/Langfuse en Agente de IA LangGraph.
6. Guarde y verifique ApiChat en Configuración > WhatsApp.
7. Use datos ficticios para la primera prueba controlada.

La migración no contiene tokens ni Client ID reales. El query inicial documentado en `ANALISIS_COGNITIVO_DORA_2.0.130.md` crea preferencias públicas y filas secretas nulas; los valores recuperables se ingresan exclusivamente por las tarjetas seguras.

## n8n

Los workflows 01 a 03 son referencias históricas/importables. El backend evalúa directamente y envía ApiChat después del commit. El workflow 04 sí contiene un nodo Webhook real: después de importarlo, configure «Cabecera interna Talento AISA» con el mismo Bearer guardado en la UI, actívelo y registre la URL de producción `/webhook/apichat/incoming` en ApiChat. El adaptador mapea el sobre oficial `messages` y no contiene secretos.

No sustituya marcadores de credenciales por secretos dentro de un JSON versionado. No presente la espera histórica de 30 segundos ni los workflows opcionales como parte del runtime vigente.

## Verificación técnica

```bash
pnpm release:verify
pnpm test:black-box
pnpm test
pnpm check
pnpm build
python3 scripts/validate_workflows.py
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
| El webhook responde 401 | Configure el mismo secreto Bearer en la tarjeta y en el adaptador autorizado. |
| No llega un evento entrante | Confirme que el workflow 04 está importado y activo, que ApiChat usa la URL de producción y que la credencial Header Auth contiene el mismo Bearer de la UI. |
| Audio o CV no aparece | La ingesta productiva de medios aún no está implementada; no habilite una ruta improvisada sin MIME real, antivirus, cuota, bucket y retención. |

## Límites

La presencia de pruebas automatizadas y controles ISO/DORA no constituye certificación. La recepción completa de PDF, Word, MP3 u OGG, el almacenamiento de candidatos, la transcripción desde ApiChat, el outbox durable y un log WORM permanecen como brechas declaradas. Consulte `ANALISIS_COGNITIVO_DORA_2.0.130.md` antes de promover el release.
