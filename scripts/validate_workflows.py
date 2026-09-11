import json
from pathlib import Path

root = Path(__file__).resolve().parent.parent / 'n8n-workflows'
files = sorted(root.glob('*.json'))
if len(files) < 4:
    raise SystemExit(f'Expected at least 4 workflow JSON files, found {len(files)}')

for path in files:
    data = json.loads(path.read_text())
    if not data.get('name') or not isinstance(data.get('nodes'), list):
        raise SystemExit(f'{path.name}: missing name/nodes')
    names = {node.get('name') for node in data['nodes']}
    if None in names or len(names) != len(data['nodes']):
        raise SystemExit(f'{path.name}: node names must be unique and present')
    for node in data['nodes']:
        for key in ('id', 'name', 'type', 'typeVersion', 'position'):
            if key not in node:
                raise SystemExit(f'{path.name}: node {node.get("name")} missing {key}')
        credentials = json.dumps(node.get('credentials', {}), ensure_ascii=False)
        if any(secret in credentials.lower() for secret in ('api_key', 'bearer ', 'sk-', 'token_value')):
            raise SystemExit(f'{path.name}: possible secret in credentials for {node["name"]}')
    for source, targets in data.get('connections', {}).items():
        if source not in names:
            raise SystemExit(f'{path.name}: connection source {source} not found')
        for branches in targets.values():
            for branch in branches:
                for target in branch:
                    if target.get('node') not in names:
                        raise SystemExit(f'{path.name}: connection target {target.get("node")} not found')
    text = path.read_text()
    if 'PENDIENTE' not in text and path.name != '01_flujo_maestro_postulaciones.json':
        raise SystemExit(f'{path.name}: expected explicit pending credential markers')
    required = {
        '01_flujo_maestro_postulaciones.json': ['process_public_application', 'alreadyApplied', 'N8N_AGENT_EVALUATION_URL'],
        '02_agente_plaza_template.json': ['lmChatOpenAi', 'outputParserStructured', 'jsonSchemaExample', 'application_id', 'finalize_application_evaluation'],
        '03_revision_humana_30s.json': ['30 seconds', 'holdSeconds: 30', 'timeInterval', 'Verificar estado actual', 'Cancelar continuación', 'Sigue calificado'],
        '04_whatsapp_apichat.json': ['n8n-nodes-base.webhook', 'n8n-nodes-base.if', 'n8n-nodes-base.splitOut', 'n8n-nodes-base.noOp', 'apichat/incoming', 'payload.messages', 'events', 'providerMessageId', 'phoneInternational', 'messageType', 'lastNode', 'PENDIENTE_WEBHOOK_HEADER', '/api/webhooks/apichat/incoming'],
    }
    for marker in required.get(path.name, []):
        if marker not in text:
            raise SystemExit(f'{path.name}: missing semantic marker {marker}')
    if path.name == '04_whatsapp_apichat.json' and 'APICHAT_' in text:
        raise SystemExit(f'{path.name}: ApiChat credentials must not be read from environment variables')
    if path.name == '04_whatsapp_apichat.json':
        nodes_by_name = {node['name']: node for node in data['nodes']}
        webhook = nodes_by_name.get('Webhook ApiChat', {})
        if webhook.get('parameters', {}).get('responseMode') != 'lastNode':
            raise SystemExit(f'{path.name}: webhook must acknowledge only after the last node')
        expected_types = {
            '¿Hay mensajes de texto?': 'n8n-nodes-base.if',
            'Separar eventos de texto': 'n8n-nodes-base.splitOut',
            'Sin mensajes de texto': 'n8n-nodes-base.noOp',
        }
        for node_name, node_type in expected_types.items():
            if nodes_by_name.get(node_name, {}).get('type') != node_type:
                raise SystemExit(f'{path.name}: missing hardened node {node_name}')
        expected_settings = {
            'saveDataErrorExecution': 'none',
            'saveDataSuccessExecution': 'none',
            'saveManualExecutions': False,
            'saveExecutionProgress': False,
            'executionTimeout': 30,
        }
        for key, expected in expected_settings.items():
            if data.get('settings', {}).get(key) != expected:
                raise SystemExit(f'{path.name}: unsafe or missing setting {key}')
        branches = data.get('connections', {}).get('¿Hay mensajes de texto?', {}).get('main', [])
        branch_targets = [branch[0].get('node') if branch else None for branch in branches]
        if branch_targets != ['Separar eventos de texto', 'Sin mensajes de texto']:
            raise SystemExit(f'{path.name}: text and no-op branches are not explicit')
    print(f'OK {path.name}: {len(data["nodes"])} nodes; semantic markers present')
print(f'Validated {len(files)} n8n workflow files')
