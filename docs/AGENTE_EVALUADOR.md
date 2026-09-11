# Módulo Agente de IA LangGraph

## Viabilidad técnica

La implementación es viable sobre la arquitectura actual. Reutiliza React, tRPC,
PostgreSQL y los permisos administrativos existentes. Las migraciones
`0008_agent_evaluator.sql` y `0010_agent_score_statuses.sql` alinean el historial
con los cinco estados de la escala; `0014_cognitive_governance.sql` agrega
protocolos versionados, sesiones, asignación del agente, actividad, adjuntos
preparatorios y controles de conversación. Las preferencias y credenciales se
almacenan en `integration_settings` con el proveedor `ai_agent`.

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
9. Una poscondición léxica bloquea patrones conocidos de oferta o propuesta
   económica; la revisión humana cubre formulaciones no contempladas.

La evaluación automática se agenda en memoria mediante `setImmediate` después
de responder al formulario para no bloquear al postulante. No existe todavía
cola durable, reintento ni reconciliación; un reclutador puede ejecutar o repetir
la evaluación manualmente desde el detalle del candidato.

## Dependencias incorporadas

| Paquete                | Función                                                    |
| ---------------------- | ---------------------------------------------------------- |
| `openai`               | Verificación de credencial y acceso al modelo              |
| `@langchain/openai`    | Adaptador LangChain para Responses API                     |
| `@langchain/core`      | Mensajes y contratos base                                  |
| `@langchain/langgraph` | Grafo controlado de evaluación                             |
| `langfuse`             | Trazas técnicas y verificación de proyecto                 |
| `zod`                  | Validación estricta de configuración y salida estructurada |

La implementación usa Responses API cuando la preferencia administrativa está
habilitada y Structured Outputs. La
documentación oficial de OpenAI recomienda `json_schema` sobre el modo JSON
anterior para modelos compatibles:
<https://developers.openai.com/api/reference/typescript/resources/beta/subresources/responses/methods/create>.

## Modelos especializados y audio

El módulo separa cuatro decisiones de modelo: evaluación general, protocolo de
prueba, resumen de actividad y transcripción/TTS. Los endpoints de OpenAI son
constantes informativas y no campos editables, para evitar que una URL arbitraria
se convierta en un destino SSRF:

| Uso | Endpoint | Estado en 2.0.130 |
| --- | --- | --- |
| Evaluación | `https://api.openai.com/v1/responses` | Integrado en el evaluador cuando Responses API está habilitada. |
| Transcripción | `https://api.openai.com/v1/audio/transcriptions` | Servicio aislado implementado y probado; no conectado a medios entrantes de ApiChat. |
| Texto a voz | `https://api.openai.com/v1/audio/speech` | Servicio aislado implementado y probado; no conectado a la bandeja productiva. |

La configuración inicial usa `gpt-4o-mini-transcribe`, `gpt-4o-mini-tts`, voz
`coral` y cuotas de 5 MB para audio y documentos. La transcripción admite
`flac`, `mp3`, `mp4`, `mpeg`, `mpga`, `m4a`, `ogg`, `wav` y `webm`. TTS puede
devolver `mp3`, `opus`, `aac`, `flac`, `wav` o `pcm`; la entrada se limita a
4,096 caracteres. El servicio usa idioma español predeterminado, temperatura 0,
timeout de 30 segundos, sin reintentos internos y con rotación principal/respaldo.

Fuentes oficiales: [transcripción de audio](https://developers.openai.com/api/reference/cli/resources/audio/subresources/transcriptions/methods/create) y [texto a voz](https://developers.openai.com/api/reference/cli/resources/audio/subresources/speech/methods/create).

Los selectores `psychometric_model` y `activity_summary_model` quedan preparados.
La ejecución adaptativa de protocolos todavía no invoca al primero; los títulos
de 11 palabras y resúmenes de 35 palabras de actividad son deterministas y no
invocan al segundo. Esta distinción impide presentar una preferencia almacenada
como funcionalidad productiva terminada.

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
   `drizzle/migrations/0010_agent_score_statuses.sql` y
   `drizzle/migrations/0014_cognitive_governance.sql`.
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
11. Probar transcripción y TTS con archivos sintéticos dentro de cuota; no
    habilitar medios entrantes hasta disponer de bucket, detección de MIME,
    antivirus, retención y borrado.

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
- Una instrucción fija y una poscondición bloquean patrones conocidos de ofertas
  económicas en evaluación y solicitud automática de CV. No constituyen una
  garantía semántica formal. La expectativa salarial inicia en cero y solo cambia
  ante evidencia explícita del candidato; negaciones, cantidades de ventas,
  presupuestos o experiencia no se interpretan como salario. Si existen varias
  declaraciones, se conserva el menor monto en GTQ.
- Un protocolo con 64 criterios de gobierno no verificados, una puerta de activación o una puntuación no
  acredita validez psicométrica. Hasta contar con evidencia externa de constructo,
  confiabilidad, población, equidad y administración estandarizada, su uso debe
  denominarse evaluación conversacional experimental y no decisoria.

Referencias metodológicas: [Standards for Educational and Psychological Testing](https://www.testingstandards.net/), [APA Guidelines for Psychological Evaluations in Occupationally-Mandated Exams](https://www.apa.org/practice/guidelines/psychological-evaluations.html) y [EEOC sobre pruebas de selección laboral](https://www.eeoc.gov/laws/guidance/employment-tests-and-selection-procedures). La referencia de EEOC sirve como criterio comparado y no se presenta como legislación guatemalteca.
