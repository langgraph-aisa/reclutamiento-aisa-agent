# Auditoría de ejecución del ciclo conversacional de nueve etapas · JARVI HR 2.0.228

## Dictamen ejecutivo

El ciclo declarado —paso 1 Recepción, 2 Precalificación, 3 Entrevista, 4 Conversación del perfil, 5 Cierre, 6 Solicitud del currículum, 7 Espera, 8 Expectativa salarial y 9 Aviso de contacto— **se ejecuta en orden y el motor solo emite la primera etapa pendiente**: la secuencia está garantizada por `buildAgentStageVerdicts` + `firstPendingStage` (`server/agentActivityLog.ts`) y por las compuertas de `runConversationTurnInternal` (`server/conversationEngine.ts`). No hay una segunda vía que, con el comportamiento encendido, redacte respuestas conversacionales fuera de estas nueve etapas.

Sin embargo, existen **tres residuos de versiones anteriores** que afectan al flujo único y **doce cuellos de botella** que pueden detener o retrasar la prueba de QA que se ejecutará ahora. El más grave para la prueba: el **paso 7 no tiene recordatorio ni caducidad**, y el **protocolo psicométrico activo en la plaza bloquea los pasos 7 a 9** al excluir la conversación del motor mientras la prueba está en curso.

---

## 1. Objeto, alcance y criterios

- **Objeto:** verificar que el agente ejecuta exactamente los nueve pasos en orden, detectar residuos de otras versiones y enumerar los cuellos de botella que impiden la prueba de QA de extremo a extremo.
- **Alcance:** análisis estático del código fuente HEAD (`2.0.228`, `ac00e06`); reconstrucción de la cadena de llamadas; constantes de cadencia; sin acceso a la base de producción.
- **Criterios:** el ciclo institucional de `server/agentStages.ts` («Encendido, el agente determina que ejecuta exactamente el paso 1, luego el 2 … y termina con el 9; no puede hacer nada más que estas nueve etapas») y las compuertas del motor conversacional.

## 2. Método

Recorrido estático función por función del turno conversacional y de los barridos (`conversationWorker.ts`), con las precondiciones de cada compuerta, y contraste de cada superficie que escribe en `conversation_messages` contra el catálogo de etapas.

---

## 3. Mapa de ejecución paso a paso

| Paso | Módulo · función | Compuertas que pueden impedirlo | Efecto observado |
| --- | --- | --- | --- |
| 1 Recepción | `cvRequest.ts: dispatchWelcomeMessage` (invocado en `routers.ts:1993` tras el COMMIT de la postulación) | `flow_enabled=false`; etapa 1 apagada; sin contacto; clave `welcome:<id>` ya emitida | Bienvenida con plantilla `bienvenida_formulario`, una sola vez |
| 2 Precalificación | `screeningEngine.ts: runScreeningStepSweep` → `planScreeningStep` → `preguntar/evaluar` → `advanceScreening` | `flow_enabled=false`; etapa apagada; conversación bajo control humano (`agent_enabled=false` o `human_takeover=true`); sin preguntas activas | Nueve preguntas, una por pasada del barrido |
| 3 Entrevista | Misma cadena; `advanceScreening` promueve `phase='entrevista'` si `p.screening_entrevista_enabled` | Interruptor de entrevista de la plaza apagado (cierra sin preguntar); claves de pregunta calificadas por fase (`screening_item:<run>:<fase>:<índice>`) | Seis preguntas de la plaza |
| 4 Conversación del perfil | `conversationEngine.ts: runConversationTurnInternal` → generador libre, con el criterio de la etapa inyectado (`CRITERIO DE LA ETAPA`) | `agent_enabled`/`human_takeover`/`automation_state`; sin protocolo activo (`applicationHasActiveEvaluationAutomation`); adjuntos en procesamiento; descartado en screening | Respuesta abierta con una sola pregunta pendiente |
| 5 Cierre | `case "cierre"` del motor: concluye la conversación y **despacha la solicitud del currículum** (`requestCvForApplication`) sin mensaje propio | `retroalimentacion` pendiente antes del cierre | El expediente pasa a la espera del CV |
| 6 Solicitud CV | `cvRequest.ts: requestCvForApplication` → `renderCvRequestMessage` | `cvState` ya pendiente/recibido (no repite); plantilla vacía cae a `CV_REQUEST_TEMPLATE` | Mensaje de solicitud del CV |
| 7 Espera CV | `case "espera_cv"`: `emitCvReceiptTurn` solo si `cvState='recibido'` | CV no recibido → turno omitido **sin recordatorio ni caducidad** | Confirmación de recepción al llegar el documento |
| 8 Expectativa | `case "expectativa_salarial"`: `emitSalaryTurn` | Expectativa ya declarada en el formulario → omitida con motivo | Pregunta y confirmación en quetzales |
| 9 Aviso | `case "aviso_contacto"`: `emitContactNoticeTurn` | `aviso_contacto` ya emitido | Aviso y `automation_state='completed'`: no hay más turnos |

**Garantía de orden:** `firstPendingStage` devuelve la primera etapa no completada en la secuencia administrada y el motor solo actúa sobre esa etapa; las etapas posteriores no se emiten mientras una anterior siga pendiente (`conversationEngine.ts`, sección «El motor ejecuta únicamente la primera etapa pendiente»).

---

## 4. Residuos de otras versiones que afectan al flujo único

### R-01 — Triple fuente de texto del paso 6 (resago confirmado, prioridad media)

`renderCvRequestMessage` (`server/apichat.ts:45`) decide la plantilla en este orden: 1) `job_positions.whatsapp_message` —el «Mensaje base» por plaza de 2.0.214-2.0.220—, 2) la plantilla del paso 6 `solicitud_cv`, 3) la constante legada `CV_REQUEST_TEMPLATE`. Consecuencia: si la plaza conserva un `whatsapp_message`, **el texto emitido no es el administrable en la hoja «Etapas de la IA»**. Para la QA: comparar el mensaje recibido con la plantilla del paso 6 antes de reportar un defecto.

### R-02 — Claves legadas de cierre del CV (gobernado, prioridad baja)

`recruitment.cv_thank_you_message` y `cv_contact_notice` siguen vivas: el descarte del screening lee `cv_contact_notice` y el canal humano `candidateConservedRecovery.ts:1278` compone con ambas. Con el flujo encendido no redactan respuestas del agente; son una superficie doble de configuración.

### R-03 — Cola de evaluación automática (excluyente, sin interferencia)

`evaluatePendingApplication` (`automaticEvaluation.ts`) solicita CV con `solicitud_cv_cola`, pero 2.0.222 hace los modos excluyentes: encender la evaluación automática apaga `flow_enabled` y deshabilita las nueve etapas. Con el flujo encendido esta vía está inerte.

### R-04 — Protocolo psicométrico intercalado (resago de mayor impacto para la QA)

`requestCvForApplication` encadena `scheduleAssessmentCycle` (`cvRequest.ts`, comentario «Encadenado declarado») y la postulación también lo programa (`routers.ts:1999`). Si la plaza tiene un **protocolo psicométrico activo** (`assessment_protocols.status='activo'` con la automatización encendida), treinta segundos después el saludo de la prueba se intercala entre los pasos 6 y 7, y `conversationsInProtocol` excluye la conversación del motor mientras `assessment_cycles.state='en_curso'`: **los pasos 7, 8 y 9 quedan bloqueados hasta terminar la prueba psicométrica**. El barrido de screening tampoco consulta los ciclos de pruebas, de modo que preguntas del banco y reactivos psicométricos pueden convivir. No es una vía «oculta», pero contradice el enunciado de flujo único cuando la plaza tiene prueba activa.

### R-05 — Evaluación automática en cada turno del paso 4 (2.0.227, cadena paralela)

Tras cada turno de conversación libre el motor ejecuta `evaluateApplicationWithAgent`: una segunda llamada de LLM por turno (latencia y costo). El fallo se registra con `console.warn` y no detiene el turno, pero en la QA puede consumir presupuesto de proveedor o ralentizar el paso 4.

### R-06 — Bitácora sin líneas pendientes

`recordAgentLogVerdicts` solo persiste veredictos `completed`; una etapa pendiente no deja línea. Para auditar la QA hay que leer el estado de la base (sección 7), no solo la bitácora.

---

## 5. Cuellos de botella para la prueba de QA de hoy

| ID | Cuello | Dónde | Efecto en la QA | Mitigación inmediata |
| --- | --- | --- | --- | --- |
| B-01 | Cadencia del barrido: 2 s y **una pregunta por pasada** | `CONVERSATION_WORKER_INTERVAL_MS=2_000`; `runScreeningStepSweep` avanza una acción por pasada | Paso 2+3 (15 preguntas) toma ≥ 30 s | Esperar sin interrumpir; no enviar mensajes extra |
| B-02 | Lote de conversaciones: 5 por pasada; barridos con límite 20/50 | `CONVERSATION_WORKER_BATCH_LIMIT=5`; `candidateRuns LIMIT 20` | Otras conversaciones en cola retrasan la conversación de QA | Ejecutar la QA en una plaza sin tráfico concurrente |
| B-03 | Paso 4 duplica LLM por turno | `evaluateApplicationWithAgent` tras cada turno libre (2.0.227) | Latencia y rate limit; fallo solo con `console.warn` | Observar `last_agent_error` y el log del servicio |
| B-04 | Regeneración y escalamiento | `CONVERSATION_REGENERATION_LIMIT`; `escalateConversation` | Una respuesta con oferta salarial o conducta inválida escala a humano (`handoff_pending`) y saca la conversación del ciclo | Responder con respuestas simples; no mencionar cifras |
| B-05 | **Paso 7 sin recordatorio ni caducidad** | `case "espera_cv"` devuelve `skipped` mientras `cvState='pendiente'` | Si no se adjunta un documento clasificable como CV (`candidate_knowledge_files.document_class='cv'`), el flujo queda detenido indefinidamente; responder texto («Ok») no avanza | Adjuntar un PDF real; verificar que el pipeline lo clasifique `cv` |
| B-06 | Paso 8 se omite si la expectativa ya consta | veredicto `expectativa_salarial` con `source.salary.declared` | La QA no verá la pregunta salarial si el formulario ya la declaró | Declarar el formulario sin expectativa salarial |
| B-07 | Paso 9 concluye la automatización | `emitContactNoticeTurn` → `automation_state='completed'` | Mensajes posteriores no reciben turno; es el final por diseño | Considerar el 9 como fin de la prueba |
| B-08 | Despacho de la cola de salida | `AGENT_OUTBOX_BATCH_LIMIT=5`, reintento a 30 s, máximo 3 intentos | Un error transitorio del proveedor retrasa la entrega de cada mensaje | Verificar `delivery_status` de `conversation_messages` |
| B-09 | Protocolo psicométrico activo (R-04) | `scheduleAssessmentCycle` + `conversationsInProtocol` | Los pasos 7 a 9 se bloquean hasta terminar la prueba | Desactivar la automatización psicométrica o usar plaza sin protocolo activo |
| B-10 | Adjuntos en procesamiento | `candidateDocumentsProcessing` | Los turnos se omiten mientras el documento se analiza | Esperar el análisis antes de continuar |
| B-11 | Cerrojo consultivo por conversación | `pg_try_advisory_lock(139, id)` en `runConversationTurn` | Con varias instancias, una conversación se procesa de a una; sin bloqueo con una instancia | No forzar turnos manuales durante la QA |
| B-12 | Compuerta de protocolos de la plaza | `applicationHasActiveEvaluationAutomation` | Si precalificación, entrevista y psicométrico están apagados, el motor no conversa en el paso 4 | Verificar los interruptores de la plaza antes de la prueba |

---

## 6. Explicación en términos de ingeniería de software

**Cadena del turno.** El trabajador ejecuta cada 2 s: 1) `runAssessmentCycleSweep` y `runAssessmentStepSweep` (protocolo psicométrico), 2) `runScreeningStepSweep` (pasos 2 y 3), 3) `pendingConversationIds` —conversaciones con mensaje entrante sin turno y bajo control del agente—, 4) exclusiones `conversationsInProtocol` y `conversationsInScreening`, y 5) `runConversationTurn` por conversación. Precedencia declarada: el instrumento en curso conduce la conversación y el motor general no consume el turno.

**Máquina de estados.** `buildAgentStageVerdicts` es una función **pura**: recibe configuración, contexto y señales —`cvState`, `screeningPhase/Status`, interruptores de plaza, turnos libres reales— y devuelve un veredicto (`executed`/`skipped`/`pending`) por etapa en el orden administrado. `firstPendingStage` selecciona la primera con `completed=false`. El motor aplica una **transición por turno**: los casos deterministas emiten su plantilla y actualizan `conversation_stage`; la conversación libre cae por el `case "retroalimentacion": break`. El contrato «primera etapa pendiente detiene las siguientes» es la invariante de orden.

**Idempotencia y entrega.** Cada mensaje institucional nace con una `message_key` determinista (por ejemplo `cv_request:<id>`, `screening_item:<run>:<fase>:<índice>`, `welcome:<id>`) y se inserta con `ON CONFLICT (message_key) DO NOTHING`; la entrega la reclama la cola de salida con reintento acotado (3 intentos, 30 s). Esto impide duplicados pero también significa que **un fallo de entrega no interrumpe la máquina**: el flujo sigue aunque el candidato no vea el mensaje —verificar `delivery_status`.

**Evaluación acoplada (2.0.227).** El paso 4 ejecuta `evaluateApplicationWithAgent` dentro del mismo turno libre, protegido con `try/catch`: el acoplamiento introduce latencia y una segunda llamada de proveedor, y el fallo se degrada silenciosamente a `console.warn`.

---

## 7. Verificación de producción requerida antes de la QA

```sql
-- Flujo encendido y etapas
SELECT setting_key, setting_value FROM integration_settings
 WHERE provider='agent_stages' ORDER BY setting_key;

-- Interruptores de la plaza y residuo del mensaje base
SELECT p.title,p.screening_precalificacion_enabled,p.screening_entrevista_enabled,
       p.whatsapp_message
  FROM job_positions p WHERE p.title='Ejecutivo de Negocios (Ventas)';

-- Protocolos psicométricos activos y automatización
SELECT p.name,p.status FROM assessment_protocols p
 WHERE p.job_position_id=(SELECT id FROM job_positions WHERE title='Ejecutivo de Negocios (Ventas)');
SELECT setting_key,setting_value FROM integration_settings
 WHERE provider='assessments' AND setting_key IN ('psychometric_autostart','automation_enabled');

-- Estado de la conversación de la QA
SELECT c.automation_state,c.agent_enabled,c.human_takeover,c.conversation_stage,
       s.phase,s.status,s.current_question_index
  FROM conversations c
  LEFT JOIN screening_runs s ON s.application_id=c.application_id
  JOIN applications a ON a.id=c.application_id
  JOIN candidates cand ON cand.id=a.candidate_id
 WHERE cand.full_name ILIKE '%QA%';

-- Entrega de mensajes (B-08)
SELECT message_key,delivery_status,attempt_count,last_error
  FROM conversation_messages
 WHERE conversation_id=(SELECT c.id FROM conversations c
                          JOIN applications a ON a.id=c.application_id
                          JOIN candidates cand ON cand.id=a.candidate_id
                         WHERE cand.full_name ILIKE '%QA%')
 ORDER BY created_at;
```

---

## 8. Dictamen

El orden 1→9 está garantizado por la invariante de la primera etapa pendiente y no existe otra vía que redacte respuestas del agente con el flujo encendido. Los residuos R-01 (texto del paso 6), R-04 (protocolo psicométrico intercalado) y R-05 (evaluación acoplada) son los únicos que pueden hacer que la QA observe algo distinto del diseño; los cuellos B-05 (espera del CV) y B-09 (prueba psicométrica) pueden detener la prueba. Para la ejecución de hoy se recomienda: plaza sin protocolo psicométrico activo, formulario sin expectativa salarial declarada, un CV real en PDF, una conversación por pasada sin tráfico concurrente y verificación de `delivery_status` después de cada mensaje institucional.

---

## 9. Addendum · Consenso del consejo aplicado en JARVI RH 2.0.230

La entrega **2.0.230** elimina de forma definitiva los cuellos y residuos identificados:

- **B-09 / R-04 resuelto** — la prueba psicométrica dejó de ser un flujo determinista: no se encadena al formulario ni a la solicitud del CV; `scheduleAssessmentCycle` exige el paso 9 concluido y la ficha del candidato la activa y apaga con su interruptor (`applicationCycle` / `toggleForApplication`).
- **R-05 resuelto** — la evaluación automática sale del turno libre y se ejecuta una sola vez, en el cierre (`runProfileEvaluation` en `case "cierre"`).
- **R-01 resuelto** — `renderCvRequestMessage` prefiere la plantilla del paso 6: el mensaje legado de la plaza y la plantilla histórica quedan como último respaldo sin variables.
- **B-05 resuelto** — el paso 7 recuerda el currículum pendiente una sola vez a las 24 horas (`runCvReminderSweep`, plantilla administrable `recordatorio_cv`).
- **Salario único** — la recepción de mensajes ya no captura la pretensión salarial; únicamente el paso 8 «Expectativa salarial» actualiza la ficha.
