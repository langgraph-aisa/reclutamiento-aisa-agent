# Guía técnica para configurar variables de entorno en EasyPanel
## Talento Claro · Aplicación web, n8n, PostgreSQL y ApiChat/WhatsApp

**Proyecto:** `reclutamiento-automatizado`  
**Objetivo:** configurar las variables directamente en EasyPanel 2.33.2 sobre una VPS de Google  
**Audiencia:** administrador técnico o responsable DevOps  
**Fecha:** 29 de agosto de 2026

---

## 1. Qué se va a configurar

La solución utiliza dos servicios de ejecución que deben configurarse por separado dentro de EasyPanel:

| Servicio EasyPanel | Variables principales | Responsabilidad |
|---|---|---|
| Aplicación web Talento Claro | `DATABASE_URL`, `JWT_SECRET`, `N8N_MANUAL_STATUS_WEBHOOK_URL` | Frontend, API, autenticación, PostgreSQL y disparo de revisión humana |
| n8n | `N8N_AGENT_EVALUATION_URL`, `OPENAI_MODEL`, `APICHAT_*` | Workflows, evaluación, espera de diez minutos y WhatsApp |
| PostgreSQL | Parámetros propios del servicio o URL de conexión | Persistencia central |

En EasyPanel 2.33.2, la ruta operativa que debe utilizarse es **Project → Service → Environment**. Allí se agregan o editan las variables del servicio y posteriormente se aplica el cambio con **Save/Deploy** o la acción equivalente de despliegue visible en esa instalación. La documentación oficial de EasyPanel indica que las variables se utilizan durante el build y la ejecución, y que los cambios requieren redeploy o reinicio para afectar al proceso en ejecución [1]. n8n, por su parte, admite configuración mediante variables de entorno en instalaciones self-hosted [2]. Si la etiqueta de un botón difiere levemente en la interfaz de 2.33.2, debe utilizarse la acción que despliega o reinicia el servicio; no basta con guardar el formulario si el contenedor no se recrea.

> **Regla principal:** una variable debe configurarse en el servicio que la consume. Definirla únicamente en el servicio web no la hace visible para n8n, y definirla únicamente en n8n no la hace visible para la aplicación Node.

---

## 2. Preparación antes de entrar a EasyPanel

Antes de modificar la configuración, reunir los siguientes datos:

| Dato | Ejemplo de formato | Dónde se obtiene |
|---|---|---|
| URL pública de la aplicación | `https://reclutamiento.example.com` | Dominio de EasyPanel |
| URL pública de n8n | `https://n8n.example.com` | Dominio de n8n |
| URL interna o externa de PostgreSQL | Host, puerto, base, usuario y SSL | Servicio PostgreSQL |
| Credencial PostgreSQL para n8n | Nombre de credencial | n8n → Credentials |
| Credencial OpenAI | API key o credencial administrada | n8n → Credentials |
| URL ApiChat | Endpoint POST real | Documentación de ApiChat |
| ID de cuenta ApiChat | Cadena o identificador | Cuenta ApiChat |
| Token ApiChat | Secreto | Cuenta ApiChat |
| Conexión WhatsApp | Nombre o identificador | ApiChat |

Realizar un respaldo de PostgreSQL y anotar los valores actuales antes de reemplazarlos. No copiar tokens en capturas de pantalla, repositorios, tickets ni archivos JSON de n8n.

---

## 3. Configurar el servicio de la aplicación web

### Paso 1: abrir el proyecto en EasyPanel 2.33.2

1. Entrar al panel de administración de EasyPanel 2.33.2.
2. Seleccionar el proyecto donde se ejecuta Talento Claro.
3. Abrir el servicio correspondiente a la aplicación web, no el servicio n8n.
4. Confirmar que el servicio tenga el código del proyecto `reclutamiento-automatizado`.
5. Verificar en la vista del servicio que el estado sea operativo antes de modificar variables.

### Paso 2: abrir `Environment`

Dentro del servicio de la aplicación, abrir la pestaña **Environment**. En EasyPanel 2.33.2, crear cada variable como una entrada independiente. Si la pantalla ofrece una opción para ocultar o proteger el valor, utilizarla para secretos como `JWT_SECRET`, contraseña de PostgreSQL y tokens. No pegar todo el bloque como una sola variable: cada nombre debe tener su propio valor.

### Paso 3: agregar variables de aplicación

#### `DATABASE_URL`

Esta es la conexión PostgreSQL que utiliza la aplicación Node y Drizzle. Debe incluir host, puerto, base, usuario, contraseña y los parámetros SSL exigidos por el proveedor.

Ejemplo conceptual:

```text
postgresql://USUARIO:CONTRASEÑA@HOST:5432/NOMBRE_BASE?sslmode=require
```

No utilizar literalmente los valores del ejemplo. Si PostgreSQL está dentro del mismo proyecto EasyPanel, preferir el hostname interno del servicio en lugar de una IP pública. Si el proveedor usa certificado propio, seguir su formato de SSL y no eliminar `sslmode=require` sin comprobar la política de conexión.

#### `JWT_SECRET`

Se utiliza para firmar la sesión de la aplicación. Debe ser una cadena aleatoria larga y estable. No cambiarla durante una sesión operativa, porque invalidaría las sesiones existentes.

Ejemplo de generación local:

```bash
openssl rand -base64 48
```

El valor generado se pega una sola vez en el campo secreto de EasyPanel. No debe registrarse en documentación ni logs.

#### `N8N_MANUAL_STATUS_WEBHOOK_URL`

La aplicación consume esta variable mediante `process.env.N8N_MANUAL_STATUS_WEBHOOK_URL` dentro de `server/routers.ts`, en la mutación `candidates.setStatus`. Se llama cuando un humano cambia el estado de un candidato a `Calificado`.

El valor debe ser la **URL de producción** del webhook de revisión humana, por ejemplo:

```text
https://n8n.example.com/webhook/reclutamiento/manual-status
```

No usar una URL del editor con formato `/workflow/<id>`.

### Paso 4: guardar y desplegar el servicio web

Guardar los cambios en EasyPanel 2.33.2 y ejecutar **Deploy/Redeploy** del servicio web. Si la interfaz presenta una confirmación, comprobar que el despliegue cree un contenedor con la nueva configuración. La configuración del servicio n8n se puede preparar antes, pero la aplicación no debe probarse contra el webhook hasta que ambos servicios hayan sido redeployados.

---

## 4. Configurar el servicio n8n

### Paso 1: abrir el servicio n8n en EasyPanel 2.33.2

1. Volver al proyecto de EasyPanel 2.33.2.
2. Abrir el servicio donde está instalado n8n.
3. Confirmar que es la instancia que atiende el dominio público de n8n.
4. Abrir la pestaña **Environment**.
5. Verificar que se está editando el servicio n8n y no el servicio de la aplicación web.

No colocar estas variables en el servicio de la aplicación web. Los workflows se ejecutan dentro del proceso n8n y resuelven las expresiones `$env.NOMBRE_VARIABLE` desde el entorno de n8n.

### Paso 2: agregar variables del flujo maestro

#### `N8N_AGENT_EVALUATION_URL`

El workflow `01_flujo_maestro_postulaciones.json` utiliza esta variable en el nodo **Disparar agente de plaza**, de tipo `HTTP Request`:

```text
={{ $env.N8N_AGENT_EVALUATION_URL }}
```

Debe apuntar a la URL de producción del agente o router de agentes. Ejemplo:

```text
https://n8n.example.com/webhook/reclutamiento/evaluate
```

Si se crean agentes independientes por plaza, esta URL puede apuntar a un router que seleccione la plaza o a un endpoint coordinador. Mantener la decisión consistente con la configuración del workflow maestro.

#### `OPENAI_MODEL`

El workflow `02_agente_plaza_template.json` utiliza esta variable en el nodo **OpenAI Chat Model**:

```text
={{ $env.OPENAI_MODEL || 'gpt-5-mini' }}
```

Definir un nombre de modelo disponible en la cuenta configurada. Si se deja vacía, el workflow utiliza el valor de respaldo indicado en la expresión. Para operación productiva se recomienda definir explícitamente el modelo aprobado y documentar la fecha de validación.

### Paso 3: agregar variables ApiChat

Crear las siguientes cinco entradas en el servicio n8n:

| Variable | Obligatoria | Valor que debe contener |
|---|---:|---|
| `APICHAT_WEBHOOK_URL` | No en la versión actual | URL reservada para eventos entrantes; todavía no es consumida por un nodo runtime |
| `APICHAT_CONNECT_TO` | Sí para envío | Nombre o identificador de la conexión WhatsApp |
| `APICHAT_API_ENDPOINT` | Sí para envío | Endpoint POST real de ApiChat |
| `APICHAT_ACCOUNT_ID` | Sí | ID de cuenta ApiChat |
| `APICHAT_TOKEN` | Sí | Token secreto de ApiChat |

En EasyPanel, marcar `APICHAT_TOKEN` como secreto si existe esa opción. Si la instalación no ofrece un tipo secreto, limitar el acceso al proyecto y evitar que el valor aparezca en logs o capturas.

### Paso 4: ejemplo de bloque de variables n8n

El siguiente bloque es una plantilla de referencia. Sustituir todos los valores de ejemplo:

```dotenv
N8N_AGENT_EVALUATION_URL=https://n8n.example.com/webhook/reclutamiento/evaluate
OPENAI_MODEL=gpt-5-mini
APICHAT_WEBHOOK_URL=https://n8n.example.com/webhook/apichat/incoming
APICHAT_CONNECT_TO=CONEXION_WHATSAPP
APICHAT_API_ENDPOINT=https://api.apichat.example/messages
APICHAT_ACCOUNT_ID=ID_DE_CUENTA
APICHAT_TOKEN=TOKEN_SECRETO
```

`APICHAT_WEBHOOK_URL` se documenta desde ahora para reservar el contrato de entrada, pero no debe darse por funcional hasta implementar el webhook que reciba, valide y registre mensajes entrantes.

---

## 5. Reiniciar o redeployar correctamente

Después de guardar las variables en el servicio web y en n8n:

1. En el servicio web, ejecutar **Deploy/Redeploy**.
2. En el servicio n8n, ejecutar **Deploy/Redeploy**.
3. Esperar a que ambos servicios indiquen estado saludable.
4. Revisar los logs de arranque sin imprimir secretos.
5. Abrir la interfaz web y la interfaz n8n por HTTPS.

EasyPanel aplica los cambios al reiniciar o redeployar el servicio [1]. En 2.33.2, confirmar visualmente el nuevo deployment o el cambio de fecha/estado del servicio antes de probar. Reiniciar únicamente la aplicación no actualiza el entorno del contenedor n8n, y reiniciar únicamente n8n no actualiza `process.env` de la aplicación web.

Si se modificó `DATABASE_URL` o el certificado SSL, reiniciar ambos servicios y volver a probar la conexión desde la aplicación y desde n8n.

---

## 6. Configurar credenciales dentro de n8n

Las variables de entorno no sustituyen las credenciales nativas de n8n que aparecen como `PENDIENTE` en los JSON.

### Credencial PostgreSQL

En n8n:

1. Abrir **Credentials**.
2. Crear una credencial PostgreSQL.
3. Introducir host, puerto, base, usuario, contraseña y SSL.
4. Ejecutar la prueba de conexión.
5. Asignar la credencial a todos estos nodos:
   - `01` → **Guardar postulación**.
   - `02` → **Cargar reglas de la plaza** y **Guardar evaluación**.
   - `03` → **Guardar ventana de revisión** y **Verificar estado actual**.
   - `04` → **Actualizar conversación**.

### Credencial OpenAI/ChatGPT

En n8n:

1. Abrir **Credentials**.
2. Crear la credencial que corresponda al nodo nativo OpenAI/ChatGPT.
3. Probar la credencial sin enviar información real de candidatos.
4. Asignarla al nodo **OpenAI Chat Model** del agente.
5. Confirmar que el nodo **Evaluar respuestas abiertas** conserva las conexiones `ai_languageModel` y `ai_outputParser`.

### Workflow de WhatsApp

En `03_revision_humana_10m.json`, el nodo **Continuar entrevista** contiene inicialmente:

```text
PENDIENTE_WORKFLOW_WHATSAPP
```

Después de importar `04_whatsapp_apichat.json`, sustituir ese marcador por el ID real del workflow de WhatsApp. Esto es una referencia interna de n8n, no una variable de entorno.

---

## 7. Validación desde la interfaz de n8n

La forma más segura de validar una variable es crear temporalmente un workflow administrativo de prueba o ejecutar un nodo Code controlado que verifique únicamente presencia, sin devolver secretos.

Ejemplo seguro para un nodo Code de diagnóstico:

```javascript
return [{
  json: {
    hasAgentUrl: Boolean($env.N8N_AGENT_EVALUATION_URL),
    hasOpenAIModel: Boolean($env.OPENAI_MODEL),
    hasApiChatEndpoint: Boolean($env.APICHAT_API_ENDPOINT),
    hasApiChatAccount: Boolean($env.APICHAT_ACCOUNT_ID),
    hasApiChatToken: Boolean($env.APICHAT_TOKEN),
    hasApiChatConnection: Boolean($env.APICHAT_CONNECT_TO)
  }
}];
```

No devolver `value: $env.APICHAT_TOKEN`, ni usar `console.log` con secretos. El nodo debe eliminarse o desactivarse después de la prueba.

También se puede verificar una expresión dentro de un nodo HTTP Request:

```text
URL: ={{ $env.APICHAT_API_ENDPOINT }}
```

La vista previa o ejecución debe mostrar que el campo no está vacío, pero no debe revelar el token completo.

---

## 8. Validación desde la aplicación web

La aplicación utiliza las siguientes variables de forma directa:

| Archivo | Variable | Validación |
|---|---|---|
| `server/_core/env.ts` | `DATABASE_URL` | El servidor intenta inicializar el pool PostgreSQL. |
| `server/_core/env.ts` | `JWT_SECRET` | Se utiliza para sesión y cookies. |
| `server/routers.ts` | `N8N_MANUAL_STATUS_WEBHOOK_URL` | Se llama al cambiar estado manualmente. |
| `server/integrations.secrets.test.ts` | `APICHAT_API_ENDPOINT`, `APICHAT_ACCOUNT_ID`, `APICHAT_TOKEN` | Valida presencia y realiza `OPTIONS` sin enviar mensajes. |

La pantalla `client/src/pages/Config.tsx` muestra los nombres `APICHAT_*` como referencia administrativa. No lee secretos desde el navegador ni los guarda en la base de datos.

---

## 9. Prueba integral recomendada

Realizar las pruebas en este orden para aislar errores:

1. Comprobar que PostgreSQL acepta una conexión desde la aplicación.
2. Ejecutar las migraciones y verificar que existen las tablas y funciones.
3. Comprobar que n8n puede conectarse con la credencial PostgreSQL.
4. Ejecutar el agente con un payload sintético que no contenga datos personales.
5. Confirmar la salida JSON estructurada de OpenAI/ChatGPT.
6. Enviar una postulación de prueba a la URL del flujo maestro.
7. Confirmar que se crea una sola aplicación.
8. Repetir el mismo teléfono y plaza para validar el HTTP 409 de duplicado.
9. Cambiar manualmente un candidato a `Calificado`.
10. Confirmar que `N8N_MANUAL_STATUS_WEBHOOK_URL` activa la espera de diez minutos.
11. Cambiar el estado antes de cumplir la espera y confirmar que la continuación se cancela.
12. Restaurar `Calificado`, esperar la ventana completa y probar ApiChat con un número controlado.
13. Confirmar el mensaje al candidato y la alerta interna.
14. Revisar que ningún log contenga tokens, contraseñas o payloads personales completos.

---

## 10. Diagnóstico de errores frecuentes

| Síntoma | Causa probable | Acción |
|---|---|---|
| Error `establishing an SSL connection` | `DATABASE_URL` incorrecta, SSL requerido o certificado no confiable | Revisar host, puerto, usuario, contraseña, `sslmode`, certificado y reiniciar ambos servicios. |
| `N8N_AGENT_EVALUATION_URL` vacío | Variable definida en el servicio web, no en n8n | Moverla a Environment del servicio n8n y redeployar n8n. |
| El cambio humano no activa la espera | `N8N_MANUAL_STATUS_WEBHOOK_URL` vacío o URL de editor | Configurar URL `/webhook/...` de producción en el servicio web y reiniciar la aplicación. |
| ApiChat devuelve 401/403 | Token o ID de cuenta inválido | Revisar `APICHAT_TOKEN`, `APICHAT_ACCOUNT_ID`, cuenta y permisos. |
| ApiChat devuelve 404 | Endpoint incorrecto | Confirmar `APICHAT_API_ENDPOINT` en la documentación o cuenta ApiChat. |
| ApiChat no usa la conexión esperada | `APICHAT_CONNECT_TO` incorrecto | Confirmar el identificador exacto de instancia/conexión. |
| El agente no responde JSON | Parser no conectado o modelo sin credencial | Revisar **OpenAI Chat Model**, **Salida estructurada** y credencial OpenAI. |
| El Wait no continúa | Persistencia de ejecuciones o configuración de n8n | Verificar almacenamiento de ejecuciones y que n8n pueda reanudar workflows. |
| El mensaje de WhatsApp no se envía | `PENDIENTE_WORKFLOW_WHATSAPP` no reemplazado | Asignar el ID real del workflow `04_whatsapp_apichat`. |
| La variable parece no cambiar | El contenedor conserva el entorno anterior | Guardar, redeployar/reiniciar el servicio y ejecutar una prueba nueva. |

---

## 11. Seguridad y mantenimiento

Las variables deben gestionarse con el menor alcance posible. `APICHAT_TOKEN`, `JWT_SECRET` y la contraseña de PostgreSQL son secretos. No enviarlos al frontend, no exponerlos en endpoints de diagnóstico y no incluirlos en workflows exportados.

Conservar un inventario de variables y registrar quién realizó cada cambio. Cuando se rote un token, actualizar EasyPanel, reiniciar n8n y ejecutar una prueba controlada. Si el token anterior continúa válido temporalmente, revocarlo después de confirmar el nuevo.

La configuración de producción debe utilizar HTTPS. Los webhooks públicos deben ser rutas de producción, no rutas del editor. El acceso a EasyPanel, n8n y PostgreSQL debe restringirse por autenticación, firewall y red privada cuando sea posible.

---

## 12. Referencias oficiales

[1] [EasyPanel Docs — App Service](https://easypanel.io/docs/services/app). Describe la configuración de servicios de aplicación, la pestaña Environment y el efecto de las variables en build y ejecución. La guía está adaptada a EasyPanel 2.33.2; los nombres exactos de botones pueden variar según el tipo de servicio o plantilla.

[2] [n8n Docs — Use environment variables](https://docs.n8n.io/deploy/host-n8n/configure-n8n/basic-configuration/use-environment-variables). Describe el uso de variables de entorno en instalaciones self-hosted y la configuración basada en archivos.

[3] [n8n Docs — Export and import workflows](https://docs.n8n.io/build/manage-workflows/export-and-import). Referencia para importar los JSON y reasignar credenciales después de la importación.

---

## 13. Criterio de finalización

La configuración se considera lista cuando la aplicación y n8n se han redeployado con sus variables respectivas, PostgreSQL acepta conexiones desde ambos servicios, las credenciales nativas dejaron de estar en estado pendiente, el agente devuelve JSON estructurado, la espera humana se cancela correctamente ante un cambio de estado y una prueba controlada envía WhatsApp al candidato y a los receptores internos.
