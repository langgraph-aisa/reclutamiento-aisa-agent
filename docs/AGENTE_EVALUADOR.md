# Módulo Agente de IA LangGraph

## Viabilidad técnica

La implementación es viable sobre la arquitectura actual. Reutiliza React, tRPC,
PostgreSQL y los permisos administrativos existentes; no requiere una tabla nueva.
Las migraciones `0008_agent_evaluator.sql` y `0010_agent_score_statuses.sql`
alinean el historial con los cinco estados de la escala. Las preferencias y credenciales se almacenan en
`integration_settings` con el proveedor `ai_agent`.

El flujo aplicado es:

1. La postulación queda registrada en PostgreSQL.
2. Las reglas deterministas comprueban respuestas aprobadas y rangos.
3. Un incumplimiento `hard_fail` produce `no_calificado` antes de llamar a OpenAI.
4. LangGraph coordina la llamada de LangChain a OpenAI Responses API con salida
   estructurada.
5. El servidor calcula el promedio ponderado; no acepta un total libre generado
   por el modelo.
6. Se persisten puntuación, bloque, motivo, resumen, brechas, evidencia, modelo y
   bitácora.
7. Si la clave principal falla, se intenta una vez con `API Key Back Up`.
8. Si Langfuse está configurado, se registra una traza técnica sin nombre,
   teléfono, correo ni respuestas del candidato.

La evaluación automática se inicia después de responder al formulario para no
bloquear al postulante. Un reclutador también puede ejecutar o repetir la
evaluación desde el detalle del candidato.

## Dependencias incorporadas

| Paquete                | Función                                                    |
| ---------------------- | ---------------------------------------------------------- |
| `openai`               | Verificación de credencial y acceso al modelo              |
| `@langchain/openai`    | Adaptador LangChain para Responses API                     |
| `@langchain/core`      | Mensajes y contratos base                                  |
| `@langchain/langgraph` | Grafo controlado de evaluación                             |
| `langfuse`             | Trazas técnicas y verificación de proyecto                 |
| `zod`                  | Validación estricta de configuración y salida estructurada |

La implementación usa `useResponsesApi: true` y Structured Outputs. La
documentación oficial de OpenAI recomienda `json_schema` sobre el modo JSON
anterior para modelos compatibles:
<https://developers.openai.com/api/reference/typescript/resources/beta/subresources/responses/methods/create>.

## Configuración recomendada en EasyPanel

Se recomienda agregar al servicio web una clave estable, aleatoria y de 32
caracteres o más:

```dotenv
AGENT_SETTINGS_ENCRYPTION_KEY=REEMPLAZAR_CON_UN_SECRETO_ALEATORIO_ESTABLE
```

Puede generarse fuera del servidor con:

```bash
openssl rand -base64 48
```

Para evitar que un despliegue sin esa variable bloquee al administrador, el
servidor usa en orden `AGENT_SETTINGS_ENCRYPTION_KEY`, `JWT_SECRET` y
`DATABASE_URL`, y deriva de la primera disponible una clave AES de 256 bits. Al
descifrar también prueba las fuentes restantes, lo que conserva las credenciales
si después se agrega una clave dedicada. No deben cambiarse o eliminarse todas
las fuentes con las que se hayan cifrado credenciales existentes.

Las claves de OpenAI y Langfuse se ingresan únicamente en **Agente de IA
LangGraph**.
No se incluyen en `.env`, capturas, logs, tickets ni repositorios. Se cifran con
AES-256-GCM y la API devuelve solo una máscara con los últimos cuatro caracteres.

## Puesta en marcha

1. Desplegar el código, ejecutar `pnpm install --frozen-lockfile` y aplicar las
   migraciones pendientes, incluida
   `drizzle/migrations/0010_agent_score_statuses.sql`.
2. Confirmar `DATABASE_URL` y `JWT_SECRET`; configurar además
   `AGENT_SETTINGS_ENCRYPTION_KEY` como separación criptográfica recomendada.
3. Ingresar como Administrador y abrir **Agente de IA LangGraph**.
4. Guardar API Key, API Key Back Up opcional y seleccionar el modelo.
5. Usar **Verificar** en cada clave configurada.
6. Revisar instrucciones, máximo de palabras e interpretación metodológica.
7. Activar **Usar SIERA y MST-EIR**.
8. Activar **Habilitar OpenAI Responses API** y guardar la configuración.
9. Configurar Langfuse de forma opcional, indicar
   `LANGFUSE_TRACING_ENVIRONMENT`, guardar y verificar la conexión.
10. Evaluar una postulación de prueba sin datos personales reales.

## Controles y límites

- Administración es el único rol que consulta o modifica credenciales.
- Reclutador y Administración pueden solicitar una evaluación de un candidato.
- El máximo de claves OpenAI está fijado en dos ranuras.
- El resumen admite entre 50 y 1,000 palabras.
- Una descalificación crítica prevalece sobre una puntuación alta.
- De 90 a 100 se asigna `pre_calificado_prioritario`.
- De 80 a 89 se asigna `pre_calificado`.
- De 70 a 79 se asigna `pre_calificado_condicionado`.
- De 60 a 69 se asigna `pendiente_revision_humana`.
- De 0 a 59 se asigna `no_calificado`.
- Ninguno de esos estados dispara la solicitud de CV; esa acción continúa
  reservada al cambio humano a `calificado`.
- La verificación OpenAI consulta el acceso al modelo y no envía datos de un
  candidato.
