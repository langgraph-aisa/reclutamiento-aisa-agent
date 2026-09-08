import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type WorkflowNode = {
  name: string;
  parameters: Record<string, unknown>;
};

const workflow = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "n8n-workflows/03_revision_humana_30s.json"),
    "utf8",
  ),
) as { name: string; nodes: WorkflowNode[] };

const whatsappWorkflow = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "n8n-workflows/04_whatsapp_apichat.json"),
    "utf8",
  ),
) as { nodes: Array<WorkflowNode & { type: string }> };

function node(name: string) {
  const result = workflow.nodes.find(candidate => candidate.name === name);
  expect(result, `No se encontró el nodo ${name}`).toBeDefined();
  return result!;
}

describe("workflow de revisión humana", () => {
  it("recibe el body del webhook y conserva applicationId durante el flujo", () => {
    expect(node("Validar cambio").parameters.jsCode).toContain(
      "$json.body ?? $json",
    );
    expect(node("Guardar ventana de revisión").parameters.query).toContain(
      'RETURNING id AS "applicationId"',
    );
    expect(node("Verificar estado actual").parameters.query).toEqual(
      expect.stringContaining('phone_international AS "phoneInternational"'),
    );
    expect(node("Verificar estado actual").parameters.query).toEqual(
      expect.stringContaining('title AS "positionTitle"'),
    );
  });

  it("usa 30 segundos en todas las etapas de la ventana", () => {
    expect(workflow.name).toContain("30 segundos");
    expect(node("Validar cambio").parameters.jsCode).toContain("30 * 1000");
    expect(node("Guardar ventana de revisión").parameters.query).toContain(
      "interval '30 seconds'",
    );
    expect(node("Esperar 30 segundos").parameters).toMatchObject({
      resume: "timeInterval",
      amount: 30,
      unit: "seconds",
    });
    expect(node("Confirmar programación").parameters.responseBody).toContain(
      "holdSeconds: 30",
    );
    expect(JSON.stringify(workflow)).not.toMatch(/10 minutes|10 minutos|holdMinutes/);
  });

  it("entrega la continuación al subworkflow de WhatsApp", () => {
    expect(
      whatsappWorkflow.nodes.find(
        candidate => candidate.name === "Continuación por WhatsApp",
      )?.type,
    ).toBe("n8n-nodes-base.executeWorkflowTrigger");
    expect(
      whatsappWorkflow.nodes.find(
        candidate => candidate.name === "Continuación por WhatsApp",
      )?.parameters.inputSource,
    ).toBe("passthrough");
    expect(
      whatsappWorkflow.nodes.find(
        candidate => candidate.name === "Actualizar conversación",
      )?.parameters.query,
    ).toContain("$('Preparar mensajes').first().json.applicationId");
  });
});
