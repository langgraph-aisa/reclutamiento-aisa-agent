import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type WorkflowNode = {
  name: string;
  type?: string;
  parameters: Record<string, unknown>;
};

type WorkflowConnection = {
  node: string;
  type: string;
  index: number;
};

const workflow = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "n8n-workflows/03_revision_humana_30s.json"),
    "utf8"
  )
) as { name: string; nodes: WorkflowNode[] };

const whatsappWorkflow = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "n8n-workflows/04_whatsapp_apichat.json"),
    "utf8"
  )
) as {
  nodes: Array<WorkflowNode & { type: string }>;
  connections: Record<string, { main: Array<Array<WorkflowConnection>> }>;
  settings: Record<string, unknown>;
};

function node(name: string) {
  const result = workflow.nodes.find(candidate => candidate.name === name);
  expect(result, `No se encontró el nodo ${name}`).toBeDefined();
  return result!;
}

function whatsappNode(name: string) {
  const result = whatsappWorkflow.nodes.find(
    candidate => candidate.name === name
  );
  expect(result, `No se encontró el nodo ${name}`).toBeDefined();
  return result!;
}

function executeNormalizer(envelope: unknown) {
  const source = String(
    whatsappNode("Normalizar mensajes ApiChat").parameters.jsCode
  );
  const execute = new Function("$json", source) as (
    input: unknown
  ) => Array<{ json: { events: Array<Record<string, unknown>> } }>;
  return execute(envelope);
}

describe("workflow de revisión humana", () => {
  it("recibe el body del webhook y conserva applicationId durante el flujo", () => {
    expect(node("Validar cambio").parameters.jsCode).toContain(
      "$json.body ?? $json"
    );
    expect(node("Guardar ventana de revisión").parameters.query).toContain(
      'RETURNING id AS "applicationId"'
    );
    expect(node("Verificar estado actual").parameters.query).toEqual(
      expect.stringContaining('phone_international AS "phoneInternational"')
    );
    expect(node("Verificar estado actual").parameters.query).toEqual(
      expect.stringContaining('title AS "positionTitle"')
    );
  });

  it("usa 30 segundos en todas las etapas de la ventana", () => {
    expect(workflow.name).toContain("30 segundos");
    expect(node("Validar cambio").parameters.jsCode).toContain("30 * 1000");
    expect(node("Guardar ventana de revisión").parameters.query).toContain(
      "interval '30 seconds'"
    );
    expect(node("Esperar 30 segundos").parameters).toMatchObject({
      resume: "timeInterval",
      amount: 30,
      unit: "seconds",
    });
    expect(node("Confirmar programación").parameters.responseBody).toContain(
      "holdSeconds: 30"
    );
    expect(JSON.stringify(workflow)).not.toMatch(
      /10 minutes|10 minutos|holdMinutes/
    );
  });

  it("acusa el webhook únicamente después de terminar una rama sin retener ejecuciones", () => {
    expect(whatsappNode("Webhook ApiChat").type).toBe("n8n-nodes-base.webhook");
    expect(whatsappNode("Webhook ApiChat").parameters).toMatchObject({
      httpMethod: "POST",
      path: "apichat/incoming",
      responseMode: "lastNode",
    });
    expect(whatsappNode("¿Hay mensajes de texto?").type).toBe(
      "n8n-nodes-base.if"
    );
    expect(whatsappNode("Separar eventos de texto")).toMatchObject({
      type: "n8n-nodes-base.splitOut",
      parameters: { fieldToSplitOut: "events" },
    });
    expect(whatsappNode("Sin mensajes de texto").type).toBe(
      "n8n-nodes-base.noOp"
    );
    expect(
      whatsappWorkflow.connections["¿Hay mensajes de texto?"].main.map(
        branch => branch[0]?.node
      )
    ).toEqual(["Separar eventos de texto", "Sin mensajes de texto"]);
    expect(
      whatsappWorkflow.connections["Entregar a Talento AISA"]
    ).toBeUndefined();
    expect(
      whatsappWorkflow.connections["Sin mensajes de texto"]
    ).toBeUndefined();
    expect(whatsappWorkflow.settings).toMatchObject({
      saveDataErrorExecution: "none",
      saveDataSuccessExecution: "none",
      saveManualExecutions: false,
      saveExecutionProgress: false,
      executionTimeout: 30,
    });
  });

  it("normaliza dinámicamente el envelope oficial y separa únicamente texto entrante", () => {
    const result = executeNormalizer({
      body: {
        messages: [
          {
            id: "msg.official-100",
            number: "50255555555",
            type: "text",
            from_me: false,
            is_group: false,
            chat_type: "private",
            text: "  Mensaje de prueba  ",
          },
          {
            id: "msg.audio-101",
            number: "50255555555",
            type: "audio",
            from_me: false,
          },
          {
            id: "msg.outbound-102",
            number: "50255555555",
            type: "text",
            from_me: true,
            text: "No debe duplicarse",
          },
          {
            id: "msg.group-103",
            number: "50255555555",
            type: "text",
            from_me: false,
            is_group: true,
            text: "No debe ingresar",
          },
        ],
      },
    });

    expect(result).toEqual([
      {
        json: {
          events: [
            {
              providerMessageId: "msg.official-100",
              phoneInternational: "+50255555555",
              messageType: "text",
              text: "Mensaje de prueba",
            },
          ],
        },
      },
    ]);

    const normalizer = whatsappNode("Normalizar mensajes ApiChat").parameters
      .jsCode;
    expect(normalizer).toContain("payload.messages");
    expect(normalizer).toContain("const events = []");
    expect(normalizer).toContain("message.from_me !== false");
    expect(normalizer).toContain("message.chat_type === 'group'");
    expect(normalizer).toContain("messageType: 'text'");
    expect(whatsappNode("Entregar a Talento AISA").parameters.url).toContain(
      "/api/webhooks/apichat/incoming"
    );
    expect(
      whatsappNode("Entregar a Talento AISA").parameters.authentication
    ).toBe("genericCredentialType");
    expect(JSON.stringify(whatsappWorkflow)).not.toContain("APICHAT_");
  });

  it("normaliza también enlaces y ubicaciones sin admitir medios sin pipeline", () => {
    const result = executeNormalizer({
      body: {
        messages: [
          {
            id: "msg.link-200",
            number: "50255555555",
            type: "link",
            from_me: false,
            chat_type: "private",
            link: "https://aisa.com.gt/plaza",
            text: "Mire la plaza",
          },
          {
            id: "msg.loc-201",
            number: "50255555555",
            type: "location",
            from_me: false,
            latitude: "14.6",
            longitude: "-90.5",
            address: "Zona 10",
          },
          {
            id: "msg.file-202",
            number: "50255555555",
            type: "file",
            from_me: false,
          },
        ],
      },
    });

    expect(result).toEqual([
      {
        json: {
          events: [
            {
              providerMessageId: "msg.link-200",
              phoneInternational: "+50255555555",
              messageType: "link",
              link: "https://aisa.com.gt/plaza",
              caption: "Mire la plaza",
            },
            {
              providerMessageId: "msg.loc-201",
              phoneInternational: "+50255555555",
              messageType: "location",
              latitude: 14.6,
              longitude: -90.5,
              address: "Zona 10",
            },
          ],
        },
      },
    ]);
    const normalizer = whatsappNode("Normalizar mensajes ApiChat").parameters
      .jsCode;
    expect(normalizer).toContain("messageType: 'link'");
    expect(normalizer).toContain("messageType: 'location'");
    expect(normalizer).toContain("latitude");
  });
});
