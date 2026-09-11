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


def workflow(name, nodes, connections, tags, settings=None):
    return {
        "name": name,
        "nodes": nodes,
        "pinData": {},
        "connections": connections,
        "active": False,
        "settings": settings or {"executionOrder": "v1"},
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

agent_nodes = [{'parameters': {'httpMethod': 'POST', 'path': 'reclutamiento/evaluate', 'responseMode': 'responseNode'},
  'id': 'entrada-de-evaluación',
  'name': 'Entrada de evaluación',
  'type': 'n8n-nodes-base.webhook',
  'typeVersion': 2.1,
  'position': [0, 0]},
 {'parameters': {'operation': 'executeQuery',
                 'query': "SELECT a.id AS application_id, jsonb_build_object('application', to_jsonb(a), 'questions', "
                          "COALESCE(jsonb_agg(jsonb_build_object('question', q, 'answer', aa.value_json, 'normalized', "
                          "aa.normalized_value)), '[]'::jsonb), 'profile', COALESCE(to_jsonb(profile), '{}'::jsonb)) "
                          'AS evaluation_input FROM applications a JOIN job_positions p ON p.id=a.job_position_id JOIN '
                          'form_questions q ON q.form_id=a.form_id LEFT JOIN application_answers aa ON '
                          'aa.application_id=a.id AND aa.question_id=q.id LEFT JOIN job_profile_positions link ON '
                          'link.job_position_id=p.id LEFT JOIN job_profiles profile ON profile.id=link.profile_id AND '
                          'profile.active=true WHERE a.id={{ $json.applicationId }} GROUP BY a.id, p.id, profile.id;',
                 'options': {}},
  'id': 'cargar-reglas-de-la-plaza',
  'name': 'Cargar reglas de la plaza',
  'type': 'n8n-nodes-base.postgres',
  'typeVersion': 2.6,
  'position': [240, 0],
  'credentials': {'postgres': {'id': 'PENDIENTE', 'name': 'PostgreSQL reclutamiento'}}},
 {'parameters': {'jsCode': 'const input = $json.evaluation_input ?? $json;\n'
                           'const profile = input.profile ?? {};\n'
                           'const normalizeText = value => String(value ?? '
                           "'').trim().toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '');\n"
                           "const asNumber = value => { const match = String(value ?? '').replace(',', "
                           "'.').match(/-?\\d+(?:\\.\\d+)?/); return match ? Number(match[0]) : NaN; };\n"
                           'const asMonths = value => { const number = asNumber(value); return Number.isFinite(number) '
                           '&& /\\b(ano|anos)\\b/.test(normalizeText(value)) ? number * 12 : number; };\n'
                           'const ruleResults = (input.questions ?? []).map(item => { const question = item.question '
                           "?? {}; const value = item.normalized ?? item.answer ?? ''; const config = "
                           'question.answer_config ?? {}; const accepted = (question.accepted_answers ?? '
                           "[]).map(normalizeText); let passed = true; let reason = 'Respuesta recibida'; if "
                           '(question.hard_fail && accepted.length) { passed = '
                           "accepted.includes(normalizeText(value)); reason = passed ? 'Coincide con una respuesta "
                           "aceptada' : `No coincide con las respuestas aceptadas: ${(question.accepted_answers ?? "
                           "[]).join(', ')}`; } const numeric = asNumber(value); const months = asMonths(value); if "
                           '(passed && Number.isFinite(numeric) && config.min != null && numeric < Number(config.min)) '
                           '{ passed = false; reason = `Valor menor que el mínimo ${config.min}`; } if (passed && '
                           'Number.isFinite(numeric) && config.max != null && numeric > Number(config.max)) { passed = '
                           'false; reason = `Valor mayor que el máximo ${config.max}`; } if (passed && '
                           'Number.isFinite(months) && config.minMonths != null && months < Number(config.minMonths)) '
                           '{ passed = false; reason = `Experiencia menor que ${config.minMonths} meses`; } if (passed '
                           '&& Number.isFinite(months) && config.maxMonths != null && months > '
                           'Number(config.maxMonths)) { passed = false; reason = `Experiencia mayor que '
                           '${config.maxMonths} meses`; } return { question_id: question.id, field_key: '
                           'question.field_key, label: question.label, passed, hardFail: Boolean(question.hard_fail), '
                           "result: passed ? 'passed' : 'failed', reason }; });\n"
                           'const hardFails = ruleResults.filter(item => item.hardFail && !item.passed);\n'
                           'const experienceQuestion = (input.questions ?? []).find(item => '
                           '/experiencia|años|meses/i.test(String(item.question?.field_key ?? item.question?.label ?? '
                           "'')));\n"
                           'const experienceMonths = experienceQuestion ? asMonths(experienceQuestion.normalized ?? '
                           "experienceQuestion.answer ?? '') : NaN;\n"
                           'const profileExperienceFail = Number.isFinite(experienceMonths) && '
                           'profile.experience_years_min != null && experienceMonths < '
                           'Number(profile.experience_years_min) * 12;\n'
                           'const answers = (input.questions ?? []).map(item => ({ key: '
                           "String(item.question?.field_key ?? item.question?.label ?? ''), text: "
                           "String(item.normalized ?? item.answer ?? '') }));\n"
                           "const answerText = answers.map(item => `${item.key}: ${item.text}`).join(' | "
                           "').toLowerCase();\n"
                           'const profileChecks = [];\n'
                           'if (profileExperienceFail) profileChecks.push(`Experiencia inferior al mínimo del perfil: '
                           '${profile.experience_years_min} años`);\n'
                           'for (const requirement of Array.isArray(profile.required_requirements) ? '
                           'profile.required_requirements : []) if (requirement && '
                           '!answerText.includes(String(requirement).toLowerCase())) profileChecks.push(`Requisito no '
                           'evidenciado: ${requirement}`);\n'
                           'for (const license of Array.isArray(profile.licenses) ? profile.licenses : []) if (license '
                           '&& !answerText.includes(String(license).toLowerCase())) profileChecks.push(`Licencia no '
                           'evidenciada: ${license}`);\n'
                           'for (const language of Array.isArray(profile.languages) ? profile.languages : []) if '
                           '(language && !answerText.includes(String(language).toLowerCase())) '
                           'profileChecks.push(`Idioma no evidenciado: ${language}`);\n'
                           'if (profile.academic_level && '
                           '!answerText.includes(String(profile.academic_level).toLowerCase())) '
                           'profileChecks.push(`Nivel académico no evidenciado: ${profile.academic_level}`);\n'
                           'if (profile.location && !answerText.includes(String(profile.location).toLowerCase())) '
                           'profileChecks.push(`Ubicación requerida no evidenciada: ${profile.location}`);\n'
                           'return [{ json: { ...input, deterministic: { passed: hardFails.length === 0 && '
                           'profileChecks.length === 0, hardFails: [...hardFails.map(item => item.label), '
                           '...profileChecks], ruleResults, profileChecks, profileCriteria: { required_requirements: '
                           'profile.required_requirements ?? [], academic_level: profile.academic_level ?? null, '
                           'ai_criteria: profile.ai_criteria ?? null, licenses: profile.licenses ?? [], languages: '
                           'profile.languages ?? [], location: profile.location ?? null } } } }];'},
  'id': 'evaluar-reglas-deterministas',
  'name': 'Evaluar reglas deterministas',
  'type': 'n8n-nodes-base.code',
  'typeVersion': 2,
  'position': [520, 0]},
 {'parameters': {'model': "={{ $env.OPENAI_MODEL || 'gpt-5-mini' }}", 'options': {'responseFormat': 'json_object'}},
  'id': 'openai-chat-model',
  'name': 'OpenAI Chat Model',
  'type': '@n8n/n8n-nodes-langchain.lmChatOpenAi',
  'typeVersion': 1.2,
  'position': [760, 220],
  'credentials': {'openAiApi': {'id': 'PENDIENTE', 'name': 'OpenAI / ChatGPT'}}},
 {'parameters': {'promptType': 'define',
                 'text': '=Evalúe a la persona candidata para la plaza {{ '
                         '$json.evaluation_input?.application?.job_position_id }} usando también el perfil laboral '
                         'asociado en evaluation_input.profile y las reglas operativas de profileCriteria. Aplique '
                         'obligatoriamente ai_criteria como criterio de razonamiento para respuestas abiertas y '
                         'explique su efecto en reason, profileSummary y ruleResults. Respete las reglas deterministas '
                         'y razone las respuestas abiertas según evaluation_criteria y ai_prompt. Entregue un puntaje '
                         'de 0 a 100 y asigne el estado exactamente así: 90–100 pre_calificado_prioritario; 80–89 '
                         'pre_calificado; 70–79 pre_calificado_condicionado; 60–69 pendiente_revision_humana; 0–59 '
                         'no_calificado. Si deterministic.passed es false, el estado final debe ser no_calificado sin '
                         'importar el score. Devuelva un JSON con score, status, reason, profileSummary, keyPoints, '
                         'confidence y ruleResults. ruleResults debe ser una lista de objetos con question_id y result '
                         '(`passed`, `failed` o `not_applicable`).\n'
                         '\n'
                         'Datos: {{ JSON.stringify($json) }}',
                 'hasOutputParser': True},
  'id': 'evaluar-respuestas-abiertas',
  'name': 'Evaluar respuestas abiertas',
  'type': '@n8n/n8n-nodes-langchain.chainLlm',
  'typeVersion': 1.7,
  'position': [1020, 0]},
 {'parameters': {'jsonSchemaExample': '{"score":85,"status":"pre_calificado","reason":"Cumple las condiciones '
                                      'configuradas","profileSummary":"Resumen del '
                                      'perfil","keyPoints":["experiencia","ubicacion"],"confidence":0.92,"ruleResults":[{"question_id":12,"result":"passed"}]}'},
  'id': 'salida-estructurada',
  'name': 'Salida estructurada',
  'type': '@n8n/n8n-nodes-langchain.outputParserStructured',
  'typeVersion': 1.3,
  'position': [1020, 260]},
 {'parameters': {'operation': 'executeQuery',
                 'query': 'SELECT finalize_application_evaluation($1::integer, $2::jsonb) AS result;',
                 'options': {'queryReplacement': '={{ [$json.application_id, JSON.stringify({ ...$json, '
                                                 '...($json.evaluation_input ?? {}) })] }}'}},
  'id': 'guardar-evaluación',
  'name': 'Guardar evaluación',
  'type': 'n8n-nodes-base.postgres',
  'typeVersion': 2.6,
  'position': [1280, 0],
  'credentials': {'postgres': {'id': 'PENDIENTE', 'name': 'PostgreSQL reclutamiento'}}},
 {'parameters': {'respondWith': 'json',
                 'responseBody': '={{ $json.result ?? $json }}',
                 'options': {'responseCode': 200}},
  'id': 'responder-evaluación',
  'name': 'Responder evaluación',
  'type': 'n8n-nodes-base.respondToWebhook',
  'typeVersion': 1.1,
  'position': [1530, 0]}]
agent_connections = {'Entrada de evaluación': {'main': [[{'node': 'Cargar reglas de la plaza', 'type': 'main', 'index': 0}]]},
 'Cargar reglas de la plaza': {'main': [[{'node': 'Evaluar reglas deterministas', 'type': 'main', 'index': 0}]]},
 'Evaluar reglas deterministas': {'main': [[{'node': 'Evaluar respuestas abiertas', 'type': 'main', 'index': 0}]]},
 'OpenAI Chat Model': {'ai_languageModel': [[{'node': 'Evaluar respuestas abiertas',
                                              'type': 'ai_languageModel',
                                              'index': 0}]]},
 'Salida estructurada': {'ai_outputParser': [[{'node': 'Evaluar respuestas abiertas',
                                               'type': 'ai_outputParser',
                                               'index': 0}]]},
 'Evaluar respuestas abiertas': {'main': [[{'node': 'Guardar evaluación', 'type': 'main', 'index': 0}]]},
 'Guardar evaluación': {'main': [[{'node': 'Responder evaluación', 'type': 'main', 'index': 0}]]}}

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
    node("Webhook ApiChat", "n8n-nodes-base.webhook", 2.1, [0, 0], {"httpMethod": "POST", "path": "apichat/incoming", "responseMode": "lastNode", "options": {}}),
    node("Normalizar mensajes ApiChat", "n8n-nodes-base.code", 2, [240, 0], {"jsCode": "const payload = $json.body ?? {};\nconst messages = Array.isArray(payload.messages) ? payload.messages : [];\nconst events = [];\nfor (const message of messages) {\n  if (!message || message.type !== 'text' || message.from_me !== false || message.is_group === true || message.chat_type === 'group') continue;\n  const providerMessageId = String(message.id ?? '').trim();\n  const rawNumber = String(message.number ?? '').trim();\n  if (rawNumber.includes('-')) continue;\n  const digits = rawNumber.replace(/\\D/g, '');\n  const phoneInternational = digits ? `+${digits}` : '';\n  const text = String(message.text ?? '').trim();\n  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,179}$/.test(providerMessageId) || !/^\\+[1-9]\\d{7,14}$/.test(phoneInternational) || !text || text.length > 10000) continue;\n  events.push({ providerMessageId, phoneInternational, messageType: 'text', text });\n}\nreturn [{ json: { events } }];"}),
    node("¿Hay mensajes de texto?", "n8n-nodes-base.if", 2.2, [500, 0], {"conditions": {"options": {"caseSensitive": True, "leftValue": "", "typeValidation": "strict"}, "conditions": [{"leftValue": "={{ Array.isArray($json.events) && $json.events.length > 0 }}", "rightValue": True, "operator": {"type": "boolean", "operation": "true", "singleValue": True}}], "combinator": "and"}}),
    node("Separar eventos de texto", "n8n-nodes-base.splitOut", 1, [760, -100], {"fieldToSplitOut": "events", "options": {}}),
    node("Sin mensajes de texto", "n8n-nodes-base.noOp", 1, [760, 140]),
    node("Entregar a Talento AISA", "n8n-nodes-base.httpRequest", 4.2, [1020, -100], {"method": "POST", "url": "https://hiring-testing-reclutamiento-aisa-agent.4ugrim.easypanel.host/api/webhooks/apichat/incoming", "authentication": "genericCredentialType", "genericAuthType": "httpHeaderAuth", "sendHeaders": True, "headerParameters": {"parameters": [{"name": "Content-Type", "value": "application/json"}]}, "sendBody": True, "specifyBody": "json", "jsonBody": "={{ $json }}", "options": {"timeout": 15000}}, {"httpHeaderAuth": {"id": "PENDIENTE_WEBHOOK_HEADER", "name": "Cabecera interna Talento AISA"}}),
]
whatsapp_connections = {
    "Webhook ApiChat": {"main": [[{"node": "Normalizar mensajes ApiChat", "type": "main", "index": 0}]]},
    "Normalizar mensajes ApiChat": {"main": [[{"node": "¿Hay mensajes de texto?", "type": "main", "index": 0}]]},
    "¿Hay mensajes de texto?": {"main": [[{"node": "Separar eventos de texto", "type": "main", "index": 0}], [{"node": "Sin mensajes de texto", "type": "main", "index": 0}]]},
    "Separar eventos de texto": {"main": [[{"node": "Entregar a Talento AISA", "type": "main", "index": 0}]]},
}

whatsapp_settings = {
    "executionOrder": "v1",
    "saveDataErrorExecution": "none",
    "saveDataSuccessExecution": "none",
    "saveManualExecutions": False,
    "saveExecutionProgress": False,
    "executionTimeout": 30,
}

files = {
    "01_flujo_maestro_postulaciones.json": workflow("RA · 01 · Flujo maestro de postulaciones", maestro_nodes, maestro_connections, ["reclutamiento", "maestro"]),
    "02_agente_plaza_template.json": workflow("RA · 02 · Agente evaluador por plaza", agent_nodes, agent_connections, ["reclutamiento", "agente", "plantilla"]),
    "03_revision_humana_30s.json": workflow("RA · 03 · Revisión humana y espera de 30 segundos", human_nodes, human_connections, ["reclutamiento", "revision-humana"]),
    "04_whatsapp_apichat.json": workflow("RA · 04 · Webhook entrante ApiChat para Talento AISA", whatsapp_nodes, whatsapp_connections, ["reclutamiento", "whatsapp", "adaptador-normalizado"], whatsapp_settings),
}

for filename, data in files.items():
    target = ROOT / filename
    if target.exists():
        try:
            if json.loads(target.read_text(encoding="utf-8")) == data:
                continue
        except (json.JSONDecodeError, OSError):
            pass
    target.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

print(f"Generated {len(files)} workflows in {ROOT}")
