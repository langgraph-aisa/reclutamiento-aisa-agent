import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import {
  applicationAttachmentCounters,
  AttachmentPipelineCounters,
  summarizeAttachmentPipeline,
} from "./attachmentPipeline";

const base: Partial<AttachmentPipelineCounters> = {
  receiptsReceived: 4,
  receiptsCompleted: 4,
  documentsReceived: 2,
  documentsAnalyzed: 2,
};

describe("clasificación del conducto del adjunto", () => {
  it("declara la observación no disponible antes que cualquier contador", () => {
    const summary = summarizeAttachmentPipeline({
      ...base,
      receiptsDead: 3,
      documentsFailed: 2,
      available: false,
    });
    expect(summary.state).toBe("observabilidad_no_disponible");
    expect(summary.verdict).toContain("no permiten afirmar");
    // La cifra sigue visible: la incógnita se declara, no se oculta.
    expect(summary.receiptsDead).toBe(3);
  });

  it("informa el eslabón más temprano de la cadena causal", () => {
    // Una notificación sin convertir en mensaje explica cualquier carencia
    // posterior: informar primero el documento sería una atribución falsa.
    const summary = summarizeAttachmentPipeline({
      receiptsReceived: 1,
      receiptsDead: 1,
      documentsPending: 2,
      jobsOpen: 2,
    });
    expect(summary.state).toBe("recepcion_no_confirmada");
    expect(summary.verdict).toContain("no alcanzó la bandeja");
  });

  it("distingue el trabajo en cola de la derivación fallida", () => {
    const enCola = summarizeAttachmentPipeline({
      ...base,
      documentsPending: 1,
      jobsOpen: 1,
    });
    expect(enCola.state).toBe("procesamiento_detenido");
    const fallida = summarizeAttachmentPipeline({ ...base, documentsFailed: 1 });
    expect(fallida.state).toBe("derivacion_fallida");
  });

  it("separa el formato sin extractor del fallo técnico", () => {
    const summary = summarizeAttachmentPipeline({
      ...base,
      documentsWithoutText: 3,
    });
    expect(summary.state).toBe("derivacion_requerida");
    // Recibido sin interpretar no es lo mismo que ausencia de archivo.
    expect(summary.verdict).toContain("recepción es un hecho distinto");
  });

  it("no convierte la ausencia de filas en una afirmación sobre el candidato", () => {
    const summary = summarizeAttachmentPipeline({});
    expect(summary.state).toBe("sin_actividad");
    expect(summary.verdict).toContain("no demuestra que el candidato no envió");
    expect(summary.receiptsReceived).toBe(0);
  });

  it("declara cierre sólo cuando hubo actividad y nada quedó pendiente", () => {
    const summary = summarizeAttachmentPipeline(base);
    expect(summary.state).toBe("sin_pendientes");
  });

  it("coloca el rechazo de ingreso después de los fallos técnicos", () => {
    const summary = summarizeAttachmentPipeline({
      receiptsReceived: 2,
      receiptsRejected: 1,
      documentsReceived: 1,
      documentsFailed: 1,
    });
    expect(summary.state).toBe("derivacion_fallida");
  });

  it("normaliza contadores ausentes a cero sin perder el tipo numérico", () => {
    const summary = summarizeAttachmentPipeline({
      receiptsReceived: null as unknown as number,
    });
    expect(summary.receiptsReceived).toBe(0);
    expect(typeof summary.receiptsOpen).toBe("number");
  });
});

describe("contadores de la ficha del candidato", () => {
  it("declara la incógnita en lugar de un cero cuando la consulta falla", async () => {
    const pool = {
      query: vi.fn(async () => {
        throw new Error("synthetic-failure");
      }),
    } as unknown as Pool;
    expect(await applicationAttachmentCounters(pool, 7)).toBeNull();
  });

  it("cuenta lo recibido y separa lo pendiente de lo que carece de texto", async () => {
    const pool = {
      query: vi.fn(async () => ({
        rows: [
          { original_name: "cv.pdf", category: "cv", status: "analizado", transcription: null, error_code: null, truncated: false },
          { original_name: "escaneo.pdf", category: "unclassified", status: "no_aplica", transcription: null, error_code: "ocr_disabled", truncated: false },
          { original_name: "nota.ogg", category: "audio", status: "pendiente", transcription: null, error_code: null, truncated: false },
          { original_name: "faltante.pdf", category: "unclassified", status: "rejected", transcription: null, error_code: "contenido_no_disponible", truncated: false },
        ],
      })),
    } as unknown as Pool;
    expect(await applicationAttachmentCounters(pool, 7)).toEqual({
      received: 4,
      pending: 1,
      withoutText: 1,
    });
  });
});

describe("el ingreso rechazado no se lee como ausencia de adjunto", () => {
  it("un adjunto recibido y no ingresado impide declarar «sin pendientes»", () => {
    // Antes, el informe sólo leía la cola de recepción y el expediente: un
    // archivo que la bandeja conservaba con su motivo de rechazo dejaba el
    // veredicto en «sin pendientes», que es una conclusión falsa sobre un hecho
    // que sí ocurrió.
    const summary = summarizeAttachmentPipeline({
      ...base,
      attachmentsRefused: 2,
    });
    expect(summary.state).toBe("ingreso_rechazado");
    expect(summary.verdict).toContain("recibieron y quedaron rechazados");
    expect(summary.verdict).toContain("no llegó a ser documento");
  });

  it("una notificación que no es mensaje no cuenta como pérdida", () => {
    // Una notificación de estado o de conversación no es una pérdida de
    // transporte: el contrato la declara distinta de la de mensajes. Sumarla a
    // los rechazos llenaba el diagnóstico de ruido y ocultaba las pérdidas
    // reales entre notificaciones legítimas.
    const summary = summarizeAttachmentPipeline({
      ...base,
      receiptsNotMessage: 5,
    });
    expect(summary.state).toBe("sin_pendientes");
    expect(summary.verdict).toContain("no cuentan como pérdida");
    expect(summary.receiptsNotMessage).toBe(5);
    expect(summary.receiptsRejected).toBe(0);
  });

  it("el rechazo de ingreso precede al rechazo de forma no reconocida", () => {
    const summary = summarizeAttachmentPipeline({
      ...base,
      attachmentsRefused: 1,
      receiptsRejected: 4,
    });
    expect(summary.verdict).toContain("recibieron y quedaron rechazados");
  });
});
