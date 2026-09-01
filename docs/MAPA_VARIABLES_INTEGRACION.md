# Mapa de variables de entorno e integración
## Talento Claro · n8n, OpenAI/ChatGPT y ApiChat/WhatsApp

**Proyecto:** `reclutamiento-automatizado`  
**Versión de referencia:** `30e4f611`  
**Fecha:** 27 de agosto de 2026

---

## 1. Propósito

Este documento identifica exactamente dónde se utilizan las variables de entorno de n8n, OpenAI/ChatGPT y ApiChat/WhatsApp dentro de Talento Claro. También distingue entre variables consumidas en tiempo de ejecución, nombres mostrados únicamente en la interfaz, credenciales nativas de n8n y marcadores que aún deben sustituirse después de importar los workflows.

La regla de seguridad es mantener tokens y credenciales fuera de los archivos JSON, el código fuente, el frontend y la documentación. Los valores reales deben registrarse en las variables de entorno del servicio n8n, en las credenciales nativas de n8n o en EasyPanel, según corresponda.

---

## 2. Resumen ejecutivo

Las variables operativas principales ya están conectadas de la siguiente forma:

| Variable | Estado | Ubicación de consumo |
|---|---|---|
| `N8N_AGENT_EVALUATION_URL` | Integrada | Workflow maestro, nodo **Disparar agente de plaza** |
| `N8N_MANUAL_STATUS_WEBHOOK_URL` | Integrada | Backend, mutación `candidates.setStatus` |
| `OPENAI_MODEL` | Integrada | Workflow de agente, nodo **OpenAI Chat Model** |
| `APICHAT_API_ENDPOINT` | Integrada | Workflow WhatsApp, dos nodos HTTP Request |
| `APICHAT_TOKEN` | Integrada | Encabezado Bearer de los dos nodos HTTP de ApiChat |
| `APICHAT_ACCOUNT_ID` | Integrada | Cuerpo JSON de los dos nodos HTTP de ApiChat |
| `APICHAT_CONNECT_TO` | Integrada | Cuerpo JSON de los dos nodos HTTP de ApiChat |
| `APICHAT_WEBHOOK_URL` | Preparada, no consumida | Interfaz administrativa y documentación únicamente |

La variable `APICHAT_WEBHOOK_URL` quedó reservada para eventos entrantes de ApiChat. Actualmente no existe un nodo runtime que la lea, por lo que todavía debe implementarse el webhook entrante si se desea recibir mensajes del candidato y alimentar el agente conversacional.

---

## 3. Variables de n8n y del agente de evaluación

### 3.1 `N8N_AGENT_EVALUATION_URL`

**Archivo:** `n8n-workflows/01_flujo_maestro_postulaciones.json`  
**Nodo:** **Disparar agente de plaza**  
**Tipo:** `n8n-nodes-base.httpRequest`  
**Expresión:**

```text
={{ $env.N8N_AGENT_EVALUATION_URL }}
```

**Línea de referencia:** 109.

El flujo maestro utiliza esta URL para enviar la aplicación nueva al workflow o router encargado de evaluar la plaza. La URL debe ser la URL de producción del webhook, no la URL del editor de n8n.

La URL compartida durante el análisis tenía el formato `/workflow/...`, que corresponde al editor de n8n. Después de activar un webhook, debe copiarse la URL de producción que muestra el propio nodo Webhook.

### 3.2 `N8N_MANUAL_STATUS_WEBHOOK_URL`

**Archivo:** `server/routers.ts`  
**Procedimiento:** `candidates.setStatus`  
**Código:** `process.env.N8N_MANUAL_STATUS_WEBHOOK_URL`

Cuando un administrador o reclutador cambia manualmente un candidato a `Calificado`, el backend envía una solicitud HTTP al workflow de revisión humana. El payload incluye:

```json
{
  "applicationId": 123,
  "status": "calificado",
  "actorType": "human",
  "actorUserId": 7,
  "comment": "Validado por reclutamiento"
}
```

El workflow receptor es `n8n-workflows/03_revision_humana_10m.json`, cuyo Webhook se denomina **Cambio humano de estado** y utiliza el path `reclutamiento/manual-status`.

### 3.3 `OPENAI_MODEL`

**Archivo:** `n8n-workflows/02_agente_plaza_template.json`  
**Nodo:** **OpenAI Chat Model**  
**Tipo:** `@n8n/n8n-nodes-langchain.lmChatOpenAi`  
**Expresión:**

```text
={{ $env.OPENAI_MODEL || 'gpt-5-mini' }}
```

**Línea de referencia:** 55.

El modelo se conecta al nodo **Evaluar respuestas abiertas** mediante la conexión `ai_languageModel`. La salida se valida mediante el nodo **Salida estructurada**, que exige `status`, `reason`, `profileSummary`, `keyPoints`, `confidence` y `ruleResults`.

---

## 4. Variables de ApiChat / WhatsApp

### 4.1 `APICHAT_API_ENDPOINT`

**Archivo:** `n8n-workflows/04_whatsapp_apichat.json`  
**Nodos:**

1. **Enviar mensaje al candidato**, línea 35.
2. **HTTP ApiChat alertas**, línea 81.

En ambos casos se utiliza:

```text
={{ $env.APICHAT_API_ENDPOINT }}
```

La variable debe contener el endpoint HTTP real para enviar mensajes mediante ApiChat.

### 4.2 `APICHAT_TOKEN`

**Archivo:** `n8n-workflows/04_whatsapp_apichat.json`  
**Nodos:** **Enviar mensaje al candidato** y **HTTP ApiChat alertas**.

Se utiliza en el encabezado HTTP:

```text
Authorization: Bearer {{ $env.APICHAT_TOKEN }}
```

No debe guardarse en el JSON exportado. El valor real debe estar disponible como variable de entorno para el proceso n8n.

### 4.3 `APICHAT_ACCOUNT_ID`

**Archivo:** `n8n-workflows/04_whatsapp_apichat.json`  
**Nodos:** **Enviar mensaje al candidato** y **HTTP ApiChat alertas**.

Se envía dentro del cuerpo JSON:

```javascript
{
  accountId: $env.APICHAT_ACCOUNT_ID,
  connectTo: $env.APICHAT_CONNECT_TO,
  to: $json.phoneInternational,
  message: $json.candidateMessage
}
```

La variable es obligatoria según el diseño de configuración.

### 4.4 `APICHAT_CONNECT_TO`

**Archivo:** `n8n-workflows/04_whatsapp_apichat.json`  
**Nodos:** **Enviar mensaje al candidato** y **HTTP ApiChat alertas**.

Se envía dentro del cuerpo JSON como `connectTo`. Debe identificar la conexión o instancia de WhatsApp que ApiChat utilizará para realizar el envío.

### 4.5 `APICHAT_WEBHOOK_URL`

**Archivos donde aparece:**

- `client/src/pages/Config.tsx`, en la tarjeta administrativa de ApiChat/WhatsApp.
- `docs/INSTALLATION.md`, en la tabla de variables.
- `docs/IMPLEMENTACION.md`, en la tabla de variables.

**Estado actual:** preparada y documentada, pero no consumida por un nodo runtime.

Esta variable está reservada para la URL de callbacks o eventos entrantes de ApiChat. Para integrarla operativamente se necesita crear un workflow adicional o un nodo Webhook que:

1. Reciba el evento entrante de ApiChat.
2. Valide firma, token o mecanismo de autenticación del proveedor.
3. Normalice teléfono, dirección del mensaje y contenido.
4. Registre el mensaje en `conversation_messages`.
5. Actualice `conversations` y el estado del candidato.
6. Envíe el evento al agente conversacional correspondiente.

---

## 5. Workflows y nodos relacionados

| Workflow | Nodo | Tipo | Variables / credenciales |
|---|---|---|---|
| `01_flujo_maestro_postulaciones.json` | **Guardar postulación** | PostgreSQL | Credencial nativa PostgreSQL: `PENDIENTE` |
| `01_flujo_maestro_postulaciones.json` | **Disparar agente de plaza** | HTTP Request | `$env.N8N_AGENT_EVALUATION_URL` |
| `02_agente_plaza_template.json` | **Cargar reglas de la plaza** | PostgreSQL | Credencial nativa PostgreSQL: `PENDIENTE` |
| `02_agente_plaza_template.json` | **OpenAI Chat Model** | Chat Model | `$env.OPENAI_MODEL` + credencial OpenAI: `PENDIENTE` |
| `02_agente_plaza_template.json` | **Guardar evaluación** | PostgreSQL | Credencial nativa PostgreSQL: `PENDIENTE` |
| `03_revision_humana_10m.json` | **Cambio humano de estado** | Webhook | Recibe llamada desde `N8N_MANUAL_STATUS_WEBHOOK_URL` |
| `03_revision_humana_10m.json` | **Guardar ventana de revisión** | PostgreSQL | Credencial nativa PostgreSQL: `PENDIENTE` |
| `03_revision_humana_10m.json` | **Esperar 10 minutos** | Wait | No requiere variable externa |
| `03_revision_humana_10m.json` | **Verificar estado actual** | PostgreSQL | Credencial nativa PostgreSQL: `PENDIENTE` |
| `03_revision_humana_10m.json` | **Continuar entrevista** | Execute Workflow | `PENDIENTE_WORKFLOW_WHATSAPP` |
| `04_whatsapp_apichat.json` | **Enviar mensaje al candidato** | HTTP Request | `APICHAT_API_ENDPOINT`, `APICHAT_TOKEN`, `APICHAT_ACCOUNT_ID`, `APICHAT_CONNECT_TO` |
| `04_whatsapp_apichat.json` | **HTTP ApiChat alertas** | HTTP Request | `APICHAT_API_ENDPOINT`, `APICHAT_TOKEN`, `APICHAT_ACCOUNT_ID`, `APICHAT_CONNECT_TO` |
| `04_whatsapp_apichat.json` | **Actualizar conversación** | PostgreSQL | Credencial nativa PostgreSQL: `PENDIENTE` |

---

## 6. Credenciales nativas de n8n versus variables de entorno

No todo lo que aparece como `PENDIENTE` es una variable de entorno. Los siguientes elementos son credenciales o referencias internas de n8n:

| Elemento | Tipo | Acción requerida |
|---|---|---|
| `PENDIENTE` en nodos PostgreSQL | Credencial nativa | Crear una credencial PostgreSQL en n8n y asignarla a cada nodo. |
| `PENDIENTE` en OpenAI Chat Model | Credencial nativa | Crear una credencial OpenAI/ChatGPT y asignarla al nodo. |
| `PENDIENTE_WORKFLOW_WHATSAPP` | ID de workflow | Sustituirlo por el workflow ID real de WhatsApp después de importar. |
| `N8N_AGENT_EVALUATION_URL` | Variable de entorno | Definir URL pública de producción del agente. |
| `N8N_MANUAL_STATUS_WEBHOOK_URL` | Variable de entorno | Definir URL pública de producción de revisión humana. |
| `APICHAT_*` | Variables de entorno | Definirlas en el entorno del servicio n8n. |

La propiedad `meta.templateCredsSetupCompleted` permanece en `false` intencionalmente, porque las credenciales del usuario todavía no han sido asignadas.

---

## 7. Archivos que muestran los nombres, pero no ejecutan secretos

### 7.1 `client/src/pages/Config.tsx`

La pestaña administrativa **ApiChat / WhatsApp** muestra los nombres:

- `APICHAT_WEBHOOK_URL`
- `APICHAT_CONNECT_TO`
- `APICHAT_API_ENDPOINT`
- `APICHAT_ACCOUNT_ID`
- `APICHAT_TOKEN`

La pantalla no lee los valores reales mediante `process.env`, no los guarda en PostgreSQL y no los expone al navegador. Su propósito es informar al administrador qué variables deben configurarse en n8n.

### 7.2 `server/integrations.secrets.test.ts`

Este archivo comprueba la presencia y forma de:

- `APICHAT_API_ENDPOINT`
- `APICHAT_TOKEN`
- `APICHAT_ACCOUNT_ID`

Cuando se proporcionan valores reales, ejecuta una solicitud `OPTIONS` de validación con autorización, sin enviar mensajes de WhatsApp. Si los valores están ausentes o contienen `PENDIENTE`, la prueba se omite explícitamente.

### 7.3 `server/_core/env.ts`

Este archivo centraliza variables propias de la aplicación, entre ellas `DATABASE_URL` y `JWT_SECRET`. No centraliza `APICHAT_*`, `N8N_*` ni `OPENAI_MODEL`; estas variables son consumidas directamente por n8n o por el procedimiento específico del backend.

---

## 8. Configuración recomendada en n8n

Definir en el entorno del servicio n8n, sin incluir las credenciales dentro de los JSON:

```bash
N8N_AGENT_EVALUATION_URL=https://tu-dominio-n8n/webhook/reclutamiento/evaluate
N8N_MANUAL_STATUS_WEBHOOK_URL=https://tu-dominio-n8n/webhook/reclutamiento/manual-status
OPENAI_MODEL=gpt-5-mini
APICHAT_WEBHOOK_URL=https://tu-dominio-n8n/webhook/apichat/incoming
APICHAT_CONNECT_TO=tu-conexion
APICHAT_API_ENDPOINT=https://api.apichat.example/messages
APICHAT_ACCOUNT_ID=tu-account-id
APICHAT_TOKEN=tu-token-secreto
```

Los valores anteriores son ejemplos de nombres y formato. No deben copiarse literalmente a producción sin confirmar las URLs y el contrato real de ApiChat.

Después de modificar variables de entorno en EasyPanel, reiniciar el servicio n8n y ejecutar una prueba controlada. Verificar que las expresiones aparezcan resueltas en la ejecución sin revelar valores secretos en los logs.

---

## 9. Checklist de configuración

| Paso | Acción | Estado esperado |
|---:|---|---|
| 1 | Crear credencial PostgreSQL en n8n | Credencial disponible y probada |
| 2 | Asignar PostgreSQL a todos los nodos Postgres | Ya no queda `PENDIENTE` en credenciales |
| 3 | Crear credencial OpenAI/ChatGPT | Credencial disponible y probada |
| 4 | Asignarla al nodo **OpenAI Chat Model** | Modelo puede ejecutar una evaluación de prueba |
| 5 | Definir `N8N_AGENT_EVALUATION_URL` | Flujo maestro alcanza el agente |
| 6 | Definir `N8N_MANUAL_STATUS_WEBHOOK_URL` | Cambio humano crea una espera |
| 7 | Definir las cuatro variables operativas de ApiChat | Solicitud HTTP llega al endpoint |
| 8 | Confirmar `APICHAT_ACCOUNT_ID` y `APICHAT_TOKEN` | Autorización aceptada |
| 9 | Reemplazar `PENDIENTE_WORKFLOW_WHATSAPP` | Execute Workflow apunta al workflow real |
| 10 | Probar un número de WhatsApp controlado | Mensaje candidato y alerta interna verificables |
| 11 | Implementar webhook entrante si se requiere conversación | `APICHAT_WEBHOOK_URL` deja de ser solo documental |

---

## 10. Conclusión

La integración actual ya consume en tiempo de ejecución las variables de evaluación, revisión humana y envío saliente de ApiChat. Las credenciales PostgreSQL y OpenAI/ChatGPT se mantienen como credenciales nativas pendientes, y el ID del subworkflow WhatsApp permanece como marcador pendiente de sustitución.

El único punto preparado pero todavía no conectado a ejecución es `APICHAT_WEBHOOK_URL`. Esa variable no puede considerarse integrada hasta que exista un webhook entrante que reciba, valide, registre y enrute los mensajes recibidos desde ApiChat.
