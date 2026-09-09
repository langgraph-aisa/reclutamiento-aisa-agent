from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "n8n-workflows"
ROOT.mkdir(exist_ok=True)


def node(name, node_type, type_version, position, parameters=None, credentials=None):
    value = {
        "parameters": parameters or {},
        "id": name.lower().replace(" ", "-")[:40],
        "name": name,
        "type": node_type,
        "typeVersion": type_version,
        "position": position,
    }
    if credentials:
        value["credentials"] = credentials
    return value


def workflow(name, nodes, connections, tags):
    return {
        "name": name,
        "nodes": nodes,
        "pinData": {},
        "connections": connections,
        "active": False,
        "settings": {"executionOrder": "v1"},
        "versionId": "reclutamiento-automatizado-v1",
        "meta": {"templateCredsSetupCompleted": False},
        "tags": [{"name": tag} for tag in tags],
    }

maestro_nodes = [
    node("Entrada de postulación", "n8n-nodes-base.webhook", 2.1, [0, 0], {"httpMethod": "POST", "path": "reclutamiento/application", "responseMode": "responseNode", "options": {"rawBody": False}}),
    node("Validar solicitud", "n8n-nodes-base.code", 2, [240, 0], {"jsCode": "const body = $json.body ?? $json;\nif (!body.token || !body.phone || !body.fullName || !body.answers) throw new Error('Faltan token, teléfono, nombre o respuestas');\nreturn [{ json: { ...body, receivedAt: new Date().toISOString(), source: 'public_form' } }];"}),
    node("Guardar postulación", "n8n-nodes-base.postgres", 2.6, [500, 0], {"operation": "executeQuery", "query": "SELECT process_public_application($1::jsonb) AS result;", "options": {"queryReplacement": "={{ JSON.stringify($json) }}"}}, {"postgres": {"id": "PENDIENTE", "name": "PostgreSQL reclutamiento"}}),
    node("¿Ya aplicada?", "n8n-nodes-base.if", 2.2, [760, 0], {"conditions": {"options": {"caseSensitive": True, "leftValue": "", "typeValidation": "strict"}, "conditions": [{"leftValue": "={{ $json.result?.alreadyApplied ?? false }}", "rightValue": True, "operator": {"type": "boolean", "operation": "true", "singleValue": True}}], "combinator": "and"}}),
    node("Aviso de duplicado", "n8n-nodes-base.respondToWebhook", 1.1, [1020, -120], {"respondWith": "json", "responseBody": "={{ { alreadyApplied: true, message: 'Esta solicitud ya fue enviada previamente para esta plaza.' } }}", "options": {"responseCode": 409}}),
    node("Disparar agente de plaza", "n8n-nodes-base.httpRequest", 4.2, [1020, 120], {"method": "POST", "url": "={{ $env.N8N_AGENT_EVALUATION_URL }}", "sendBody": True, "specifyBody": "json", "jsonBody": "={{ $json.result }}", "options": {"timeout": 30000}}),
    node("Respuesta recibida", "n8n-nodes-base.respondToWebhook", 1.1, [1280, 120], {"respondWith": "json", "responseBody": "={{ { ok: true, applicationId: $json.applicationId ?? $json.result?.applicationId, status: 'en_revision' } }}", "options": {"responseCode": 202}}),
]
maestro_connections = {
    "Entrada de postulación": {"main": [[{"node": "Validar solicitud", "type": "main", "index": 0}]]},
    "Validar solicitud": {"main": [[{"node": "Guardar postulación", "type": "main", "index": 0}]]},
    "Guardar postulación": {"main": [[{"node": "¿Ya aplicada?", "type": "main", "index": 0}]]},
    "¿Ya aplicada?": {"main": [[{"node": "Aviso de duplicado", "type": "main", "index": 0}], [{"node": "Disparar agente de plaza", "type": "main", "index": 0}]]},
    "Disparar agente de plaza": {"main": [[{"node": "Respuesta recibida", "type": "main", "index": 0}]]},
}

agent_nodes = [
    node("Entrada de evaluación", "n8n-nodes-base.webhook", 2.1, [0, 0], {"httpMethod": "POST", "path": "reclutamiento/evaluate", "responseMode": "responseNode"}),
    node("Cargar reglas de la plaza", "n8n-nodes-base.postgres", 2.6, [240, 0], {"operation": "executeQuery", "query": "SELECT jsonb_build_object('application', a, 'questions', COALESCE(jsonb_agg(jsonb_build_object('question', q, 'answer', aa.value_json, 'normalized', aa.normalized_value)), '[]'::jsonb)) AS evaluation_input FROM applications a JOIN form_questions q ON q.form_id=a.form_id LEFT JOIN application_answers aa ON aa.application_id=a.id AND aa.question_id=q.id WHERE a.id={{ $json.applicationId }} GROUP BY a.id;", "options": {}}, {"postgres": {"id": "PENDIENTE", "name": "PostgreSQL reclutamiento"}}),
    node("Evaluar reglas deterministas", "n8n-nodes-base.code", 2, [520, 0], {"jsCode": "const input = $json.evaluation_input ?? $json;\nconst hardFails = (input.questions ?? []).filter(item => item.question?.hard_fail && item.question?.accepted_answers?.length && !item.question.accepted_answers.map(String).includes(String(item.normalized ?? item.answer ?? '')));\nreturn [{ json: { ...input, deterministic: { passed: hardFails.length === 0, hardFails: hardFails.map(item => item.question.label) } } }];"}),
    node("OpenAI Chat Model", "@n8n/n8n-nodes-langchain.lmChatOpenAi", 1.2, [760, 220], {"model": "={{ $env.OPENAI_MODEL || 'gpt-5-mini' }}", "options": {"responseFormat": "json_object"}}, {"openAiApi": {"id": "PENDIENTE", "name": "OpenAI / ChatGPT"}}),
    node("Evaluar respuestas abiertas", "@n8n/n8n-nodes-langchain.chainLlm", 1.7, [1020, 0], {"promptType": "define", "text": "=Evalúa el candidato para la plaza {{ $json.application?.job_position_id }}. Respeta las reglas deterministas y razona las respuestas abiertas según evaluation_criteria y ai_prompt. Entrega score de 0 a 100 y asigna status exactamente así: 90–100 pre_calificado_prioritario; 80–89 pre_calificado; 70–79 pre_calificado_condicionado; 60–69 pendiente_revision_humana; 0–59 no_calificado. Si deterministic.passed es false, el estado final debe ser no_calificado sin importar el score. Devuelve un JSON con score, status, reason, profileSummary, keyPoints y confidence.\n\nDatos: {{ JSON.stringify($json) }}", "hasOutputParser": True}, None),
    node("Salida estructurada", "@n8n/n8n-nodes-langchain.outputParserStructured", 1.3, [1020, 260], {"jsonSchemaExample": "{\"score\":85,\"status\":\"pre_calificado\",\"reason\":\"Cumple las condiciones configuradas\",\"profileSummary\":\"Resumen del perfil\",\"keyPoints\":[\"experiencia\",\"ubicacion\"],\"confidence\":0.92}"}),
    node("Guardar evaluación", "n8n-nodes-base.postgres", 2.6, [1280, 0], {"operation": "executeQuery", "query": "SELECT finalize_application_evaluation($1::integer, $2::jsonb) AS result;", "options": {"queryReplacement": "={{ [$json.applicationId, JSON.stringify($json)] }}"}}, {"postgres": {"id": "PENDIENTE", "name": "PostgreSQL reclutamiento"}}),
    node("Responder evaluación", "n8n-nodes-base.respondToWebhook", 1.1, [1530, 0], {"respondWith": "json", "responseBody": "={{ $json.result ?? $json }}", "options": {"responseCode": 200}}),
]
agent_connections = {
    "Entrada de evaluación": {"main": [[{"node": "Cargar reglas de la plaza", "type": "main", "index": 0}]]},
    "Cargar reglas de la plaza": {"main": [[{"node": "Evaluar reglas deterministas", "type": "main", "index": 0}]]},
    "Evaluar reglas deterministas": {"main": [[{"node": "Evaluar respuestas abiertas", "type": "main", "index": 0}]]},
    "OpenAI Chat Model": {"ai_languageModel": [[{"node": "Evaluar respuestas abiertas", "type": "ai_languageModel", "index": 0}]]},
    "Salida estructurada": {"ai_outputParser": [[{"node": "Evaluar respuestas abiertas", "type": "ai_outputParser", "index": 0}]]},
    "Evaluar respuestas abiertas": {"main": [[{"node": "Guardar evaluación", "type": "main", "index": 0}]]},
    "Guardar evaluación": {"main": [[{"node": "Responder evaluación", "type": "main", "index": 0}]]},
}

human_nodes = [
    node("Cambio humano de estado", "n8n-nodes-base.webhook", 2.1, [0, 0], {"httpMethod": "POST", "path": "reclutamiento/manual-status", "responseMode": "responseNode"}),
    node("Validar cambio", "n8n-nodes-base.code", 2, [240, 0], {"jsCode": "const body = $json.body ?? $json;\nif (!body.applicationId || body.status !== 'calificado' || body.actorType !== 'human') return [{ json: { ...body, skipped: true } }];\nreturn [{ json: { ...body, holdUntil: new Date(Date.now() + 30 * 1000).toISOString() } }];"}),
    node("¿Debe esperar?", "n8n-nodes-base.if", 2.2, [500, 0], {"conditions": {"options": {"caseSensitive": True, "leftValue": "", "typeValidation": "strict"}, "conditions": [{"leftValue": "={{ $json.skipped ?? false }}", "rightValue": False, "operator": {"type": "boolean", "operation": "false", "singleValue": True}}], "combinator": "and"}}),
    node("Guardar ventana de revisión", "n8n-nodes-base.postgres", 2.6, [760, 0], {"operation": "executeQuery", "query": "UPDATE applications SET review_hold_until = now() + interval '30 seconds', updated_at=now() WHERE id={{ $json.applicationId }} AND status='calificado' RETURNING id AS \"applicationId\",status,review_hold_until;", "options": {}}, {"postgres": {"id": "PENDIENTE", "name": "PostgreSQL reclutamiento"}}),
    node("Esperar 30 segundos", "n8n-nodes-base.wait", 1.1, [1020, 0], {"resume": "timeInterval", "amount": 30, "unit": "seconds"}),
    node("Verificar estado actual", "n8n-nodes-base.postgres", 2.6, [1280, 0], {"operation": "executeQuery", "query": "SELECT a.id AS \"applicationId\",a.status,a.review_hold_until,c.phone_international AS \"phoneInternational\",p.title AS \"positionTitle\",COALESCE((SELECT jsonb_agg(r.phone_international ORDER BY r.id) FROM internal_alert_recipients r WHERE r.active=true),'[]'::jsonb) AS \"internalRecipients\" FROM applications a JOIN candidates c ON c.id=a.candidate_id JOIN job_positions p ON p.id=a.job_position_id WHERE a.id={{ $json.applicationId }} LIMIT 1;", "options": {}}, {"postgres": {"id": "PENDIENTE", "name": "PostgreSQL reclutamiento"}}),
    node("¿Sigue calificado?", "n8n-nodes-base.if", 2.2, [1530, 0], {"conditions": {"options": {"caseSensitive": True, "leftValue": "", "typeValidation": "strict"}, "conditions": [{"leftValue": "={{ $json.status }}", "rightValue": "calificado", "operator": {"type": "string", "operation": "equals"}}], "combinator": "and"}}),
    node("Continuar entrevista", "n8n-nodes-base.executeWorkflow", 1.2, [1780, -80], {"workflowId": "PENDIENTE_WORKFLOW_WHATSAPP", "mode": "once"}),
    node("Cancelar continuación", "n8n-nodes-base.respondToWebhook", 1.1, [1780, 120], {"respondWith": "json", "responseBody": "={{ { ok: true, skipped: true, reason: 'El estado cambió durante la ventana de revisión.' } }}", "options": {"responseCode": 200}}),
    node("Confirmar programación", "n8n-nodes-base.respondToWebhook", 1.1, [2040, -80], {"respondWith": "json", "responseBody": "={{ { ok: true, scheduled: true, holdSeconds: 30 } }}", "options": {"responseCode": 202}}),
]
human_connections = {
    "Cambio humano de estado": {"main": [[{"node": "Validar cambio", "type": "main", "index": 0}]]},
    "Validar cambio": {"main": [[{"node": "¿Debe esperar?", "type": "main", "index": 0}]]},
    "¿Debe esperar?": {"main": [[{"node": "Guardar ventana de revisión", "type": "main", "index": 0}], [{"node": "Cancelar continuación", "type": "main", "index": 0}]]},
    "Guardar ventana de revisión": {"main": [[{"node": "Esperar 30 segundos", "type": "main", "index": 0}]]},
    "Esperar 30 segundos": {"main": [[{"node": "Verificar estado actual", "type": "main", "index": 0}]]},
    "Verificar estado actual": {"main": [[{"node": "¿Sigue calificado?", "type": "main", "index": 0}]]},
    "¿Sigue calificado?": {"main": [[{"node": "Continuar entrevista", "type": "main", "index": 0}], [{"node": "Cancelar continuación", "type": "main", "index": 0}]]},
    "Continuar entrevista": {"main": [[{"node": "Confirmar programación", "type": "main", "index": 0}]]},
}

whatsapp_nodes = [
    node("Continuación por WhatsApp", "n8n-nodes-base.executeWorkflowTrigger", 1.1, [0, 0], {"inputSource": "passthrough"}),
    node("Preparar mensajes", "n8n-nodes-base.code", 2, [260, 0], {"jsCode": "const input = $json.body ?? $json;\nconst position = input.positionTitle ?? 'la plaza';\nconst recipientList = input.internalRecipients ?? [];\nreturn [{ json: { ...input, candidateMessage: `Gracias por aplicar a la plaza de ${position}, agradeceremos nos pueda brindar su Curriculum Vitae para continuar con su proceso de evaluación.`, internalMessages: recipientList.map(phone => ({ phone, message: `Nuevo candidato calificado para entrevista: ${position}. Teléfono: ${input.phoneInternational}` })) } }];"}),
    node("Enviar mensaje al candidato", "n8n-nodes-base.httpRequest", 4.2, [560, -100], {"method": "POST", "url": "={{ $env.APICHAT_API_ENDPOINT }}", "sendHeaders": True, "headerParameters": {"parameters": [{"name": "Authorization", "value": "=Bearer {{ $env.APICHAT_TOKEN }}"}, {"name": "Content-Type", "value": "application/json"}]}, "sendBody": True, "specifyBody": "json", "jsonBody": "={{ { accountId: $env.APICHAT_ACCOUNT_ID, connectTo: $env.APICHAT_CONNECT_TO, to: $json.phoneInternational, message: $json.candidateMessage } }}", "options": {"timeout": 30000}}),
    node("Enviar alertas internas", "n8n-nodes-base.splitOut", 1, [560, 160], {"fieldToSplitOut": "internalMessages"}),
    node("HTTP ApiChat alertas", "n8n-nodes-base.httpRequest", 4.2, [820, 160], {"method": "POST", "url": "={{ $env.APICHAT_API_ENDPOINT }}", "sendHeaders": True, "headerParameters": {"parameters": [{"name": "Authorization", "value": "=Bearer {{ $env.APICHAT_TOKEN }}"}, {"name": "Content-Type", "value": "application/json"}]}, "sendBody": True, "specifyBody": "json", "jsonBody": "={{ { accountId: $env.APICHAT_ACCOUNT_ID, connectTo: $env.APICHAT_CONNECT_TO, to: $json.internalMessages.phone, message: $json.internalMessages.message } }}", "options": {"timeout": 30000}}),
    node("Actualizar conversación", "n8n-nodes-base.postgres", 2.6, [1080, -100], {"operation": "executeQuery", "query": "UPDATE applications SET whatsapp_status='enviado', updated_at=now() WHERE id={{ $('Preparar mensajes').first().json.applicationId }} RETURNING id AS \"applicationId\",whatsapp_status;", "options": {}}, {"postgres": {"id": "PENDIENTE", "name": "PostgreSQL reclutamiento"}}),
    node("Finalizar WhatsApp", "n8n-nodes-base.noOp", 1, [1340, -100], {}),
]
whatsapp_connections = {
    "Continuación por WhatsApp": {"main": [[{"node": "Preparar mensajes", "type": "main", "index": 0}]]},
    "Preparar mensajes": {"main": [[{"node": "Enviar mensaje al candidato", "type": "main", "index": 0}, {"node": "Enviar alertas internas", "type": "main", "index": 0}]]},
    "Enviar mensaje al candidato": {"main": [[{"node": "Actualizar conversación", "type": "main", "index": 0}]]},
    "Actualizar conversación": {"main": [[{"node": "Finalizar WhatsApp", "type": "main", "index": 0}]]},
    "Enviar alertas internas": {"main": [[{"node": "HTTP ApiChat alertas", "type": "main", "index": 0}]]},
}

files = {
    "01_flujo_maestro_postulaciones.json": workflow("RA · 01 · Flujo maestro de postulaciones", maestro_nodes, maestro_connections, ["reclutamiento", "maestro"]),
    "02_agente_plaza_template.json": workflow("RA · 02 · Agente evaluador por plaza", agent_nodes, agent_connections, ["reclutamiento", "agente", "plantilla"]),
    "03_revision_humana_30s.json": workflow("RA · 03 · Revisión humana y espera de 30 segundos", human_nodes, human_connections, ["reclutamiento", "revision-humana"]),
    "04_whatsapp_apichat.json": workflow("RA · 04 · Continuación y alertas por ApiChat WhatsApp", whatsapp_nodes, whatsapp_connections, ["reclutamiento", "whatsapp", "apichat"]),
}

for filename, data in files.items():
    (ROOT / filename).write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")

print(f"Generated {len(files)} workflows in {ROOT}")
