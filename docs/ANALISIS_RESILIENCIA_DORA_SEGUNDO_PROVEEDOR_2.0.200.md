# Análisis de viabilidad técnica: segundo proveedor de IA (DeepSeek) para la capa de resiliencia DORA

Fecha de control: 2026-09-21. Alcance: backend TypeScript, agente LangGraph, consumidores de razonamiento de texto y servicios de audio. Este documento describe controles técnicos verificables; no constituye certificación ISO, validación jurídica ni garantía absoluta de disponibilidad.

## 1. Objeto

El artefacto consume OpenAI mediante dos credenciales del mismo proveedor (principal y respaldo) en cada superficie de IA. Esa rotación mitiga la caída de una credencial, pero no la caída del proveedor. El objeto de esta intervención es agregar un segundo proveedor —DeepSeek, accesible por API y compatible con el formato de OpenAI— para que la pérdida del proveedor primario no detenga el razonamiento del agente, y administrar desde la hoja administrativa cuál proveedor es primario y cuál secundario.

## 2. Superficies de consumo de IA y su superficie de API

| Consumidor | Archivo | Superficie usada | Salida estructurada |
| --- | --- | --- | --- |
| Evaluador LangGraph | `server/agentEvaluator.ts` | LangChain `ChatOpenAI` con Responses API | Sí (Zod estricto) |
| Agente conversacional | `server/conversationEngine.ts` | `responses.parse` + `zodTextFormat` | Sí |
| Esencia del CV | `server/cvAnalysis.ts` | `responses.parse` + `zodTextFormat` | Sí |
| RAG de conocimiento | `server/knowledge.ts` | `responses.parse` + `zodTextFormat` | Sí |
| Control editorial público | `server/profileEditorial.ts` | `responses.parse` + `zodTextFormat` | Sí |
| Agente del reclutador | `server/recruiterAgent.ts` | `responses.create` (texto libre) | No |
| Transcripción y voz | `server/_core/voiceTranscription.ts` | `audio.transcriptions` / `audio.speech` | No aplica |

## 3. Matriz de compatibilidad de DeepSeek

DeepSeek expone una API compatible con OpenAI únicamente en el punto `POST /chat/completions` (base `https://api.deepseek.com`). Las capacidades observadas son:

| Capacidad | OpenAI | DeepSeek |
| --- | --- | --- |
| Chat Completions | Sí | Sí |
| Responses API (`/responses`) | Sí | **No** |
| Salida JSON (`response_format: json_object`) | Sí | Sí, solo `deepseek-chat` |
| Llamada a funciones (tools) | Sí | Sí, solo `deepseek-chat` |
| Transcripción | Sí | **No** |
| Texto a voz | Sí | **No** |
| `deepseek-reasoner` (R1) con salida estructurada | No aplica | **No** (solo texto libre) |

La conclusión es taxativa: la sustitución resiliente es viable para **todo el razonamiento de texto** —evaluador, conversación, esencia del CV, RAG, editorial y reclutador— y **no es viable** para transcripción y voz, que no tienen equivalente en DeepSeek. Las superficies de audio conservan la rotación de credenciales de OpenAI; el análisis las declara fuera del alcance del segundo proveedor por inexistencia del servicio, no por omisión.

## 4. Diseño propuesto

### 4.1 Proveedor activo y cadena resiliente

Se introduce una preferencia `primaryProvider` con dos valores: `openai` y `deepseek`. El proveedor activo aporta sus dos credenciales (principal y respaldo) en primer lugar; el proveedor secundario aporta las suyas a continuación. La cadena de intentos queda así:

- Proveedor activo `openai`: OpenAI principal → OpenAI respaldo → DeepSeek principal → DeepSeek respaldo.
- Proveedor activo `deepseek`: DeepSeek principal → DeepSeek respaldo → OpenAI principal → OpenAI respaldo.

Cada consumidor conserva su bucle de intentos; lo único que cambia es que la lista de credenciales pasa de dos a cuatro y cada intento declara el proveedor y la ranura. La observabilidad Langfuse registra `provider` y `slot` en cada intento para que el fallo del proveedor sea distinguible del fallo de una credencial.

### 4.2 Salida estructurada neutra al proveedor

La salida estructurada se abstrae en un auxiliar único:

- Con OpenAI se conserva el camino actual (`responses.parse` + `zodTextFormat`), idéntico en comportamiento.
- Con DeepSeek se usa Chat Completions con `response_format: { type: "json_object" }`, se interpreta el JSON y se valida con el mismo esquema Zod. La superficie usada es siempre `deepseek-chat`, único modelo de DeepSeek con salida estructurada.

Los esquemas Zod y las instrucciones no se duplican: el auxiliar recibe el mismo esquema que ya gobierna cada consumidor.

### 4.3 Evaluador LangGraph

El nodo del grafo sigue siendo el mismo. La construcción del modelo se parametriza por proveedor: OpenAI usa `ChatOpenAI` con Responses API y `strict`; DeepSeek usa `ChatOpenAI` apuntado a la base de DeepSeek, sin Responses API, con salida estructurada por llamada a función sobre `deepseek-chat`.

### 4.4 Hoja administrativa

La página Agente de IA LangGraph incorpora:

- Un control de proveedor activo (switch excluyente: OpenAI o DeepSeek).
- La tarjeta del proveedor inactivo queda en gris y sin edición de credenciales.
- La tarjeta de DeepSeek, debajo de la de OpenAI, con selección de modelo y dos credenciales (API Key y API Key Back Up), simétrica a la existente.
- El botón de verificación distingue proveedor y ranura.

## 5. Riesgos y mitigaciones

| Riesgo | Mitigación |
| --- | --- |
| `deepseek-reasoner` no admite salida estructurada | La salida estructurada se fuerza a `deepseek-chat`; `deepseek-reasoner` queda reservado al texto libre del reclutador. |
| Cambio de formato de respuesta entre proveedores | El auxiliar centraliza el parseo y valida con Zod; un proveedor que devuelva JSON inválido se trata como intento fallido y se pasa al siguiente. |
| Registro del proveedor en la auditoría | Cada intento asienta `provider` y `slot`; la auditoría de evaluación conserva el modelo efectivo. |
| Transcripción y voz sin segundo proveedor | Se declaran fuera del alcance y conservan la rotación de credenciales de OpenAI; el análisis lo documenta como limitación de mercado. |
| Puertas de gobernanza | El censo de archivos de ejecución sube de 149 a 150 y la aserción de la puerta se actualiza; el nuevo módulo cumple español formal. |

## 6. Plan de implementación

1. `shared/agentConfig.ts`: catálogo `DEEPSEEK_MODELS`, constantes de proveedor y preferencias nuevas.
2. `server/agentProviders.ts` (nuevo): cadena resiliente, fábrica de cliente compatible, salida estructurada neutra y verificación por proveedor.
3. `server/agentSettings.ts`: claves secretas y preferencias de DeepSeek.
4. Migración de los seis consumidores de texto y del evaluador.
5. `server/routers.ts`: entrada de verificación por proveedor y validación de claves.
6. Hoja administrativa: switch de proveedor, tarjeta DeepSeek y estados en gris.
7. Pruebas y puertas: actualización del censo de archivos y cobertura del failover.
