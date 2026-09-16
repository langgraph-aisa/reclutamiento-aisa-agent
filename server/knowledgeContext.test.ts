import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import {
  knowledgeContextFingerprint,
  loadPositionKnowledgeContext,
  POSITION_KNOWLEDGE_DEGRADED,
  POSITION_KNOWLEDGE_FALLBACK,
  renderPositionKnowledgeContext,
} from "./knowledgeContext";

function poolReturning(rows: unknown[], error?: Error) {
  return {
    query: async () => {
      if (error) throw error;
      return { rows };
    },
  } as unknown as Pool;
}

const rows = [
  {
    project_id: 7,
    project_name: "Solar Guatemala",
    project_summary: "Proyecto fotovoltaico",
    file_id: 1,
    original_name: "SIERA.pdf",
    deep_analysis: "Análisis A",
  },
  {
    project_id: 7,
    project_name: "Solar Guatemala",
    project_summary: "Proyecto fotovoltaico",
    file_id: 2,
    original_name: "MST-EIR.pdf",
    deep_analysis: "Análisis B",
  },
  {
    project_id: 9,
    project_name: "Otro proyecto",
    project_summary: "Resumen",
    file_id: null,
    original_name: null,
    deep_analysis: null,
  },
];

describe("proyección única del RAG de proyectos", () => {
  it("conserva exactamente el texto que ya consumía el evaluador", async () => {
    const context = await loadPositionKnowledgeContext(
      poolReturning(rows),
      27
    );
    expect(context.rendered).toBe(
      [
        "Proyecto: Solar Guatemala",
        "Resumen: Proyecto fotovoltaico",
        "Documento: SIERA.pdf",
        "Análisis: Análisis A",
        "",
        "Documento: MST-EIR.pdf",
        "Análisis: Análisis B",
        "",
        "---",
        "",
        "Proyecto: Otro proyecto",
        "Resumen: Resumen",
        "Sin documentos analizados.",
      ].join("\n")
    );
    expect(context.available).toBe(true);
    expect(context.degraded).toBe(false);
    expect(context.fileCount).toBe(2);
    expect(context.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("devuelve el marcador institucional cuando la plaza no tiene proyecto", async () => {
    const sinPlaza = await loadPositionKnowledgeContext(poolReturning(rows), null);
    expect(sinPlaza.rendered).toBe(POSITION_KNOWLEDGE_FALLBACK);
    expect(sinPlaza.available).toBe(false);

    const sinFilas = await loadPositionKnowledgeContext(poolReturning([]), 27);
    expect(sinFilas.rendered).toBe(POSITION_KNOWLEDGE_FALLBACK);
    expect(sinFilas.available).toBe(false);
  });

  it("degrada sin romper cuando la consulta falla", async () => {
    const context = await loadPositionKnowledgeContext(
      poolReturning([], new Error("42P01")),
      27
    );
    expect(context.degraded).toBe(true);
    expect(context.rendered).toBe(POSITION_KNOWLEDGE_DEGRADED);
  });

  it("produce una huella estable frente al mismo conocimiento", () => {
    const project = {
      id: 7,
      name: "Solar Guatemala",
      summary: "Proyecto fotovoltaico",
      files: [
        {
          id: 1,
          originalName: "SIERA.pdf",
          analysis: "Análisis A",
          analysisCharacters: 9,
        },
      ],
    };
    expect(knowledgeContextFingerprint([project])).toBe(
      knowledgeContextFingerprint([{ ...project }])
    );
    expect(
      knowledgeContextFingerprint([
        { ...project, files: [{ ...project.files[0]!, analysis: "Otro" }] },
      ])
    ).not.toBe(knowledgeContextFingerprint([project]));
  });

  it("limita el render a diez documentos por proyecto", () => {
    const project = {
      id: 1,
      name: "Proyecto extenso",
      summary: "Resumen",
      files: Array.from({ length: 14 }, (_, index) => ({
        id: index + 1,
        originalName: `documento-${index + 1}.pdf`,
        analysis: "Análisis",
        analysisCharacters: 7,
      })),
    };
    const rendered = renderPositionKnowledgeContext([project]);
    expect(rendered).toContain("documento-10.pdf");
    expect(rendered).not.toContain("documento-11.pdf");
  });
});
