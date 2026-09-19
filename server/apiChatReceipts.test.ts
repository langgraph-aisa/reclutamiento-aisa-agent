import { describe, expect, it } from "vitest";
import { AttachmentTransportError, decodeRemoteAttachment } from "./base64Transport";
import { ReceptionError, receiptFailureReason } from "./apiChatReceipts";

/**
 * El asiento de recepción debe nombrar la causa del fallo.
 *
 * Antes conservaba el nombre de la clase de excepción —`Error`—, de modo que la
 * superficie de auditoría mostraba la misma palabra para un destino ausente,
 * una dirección expirada y una base de datos caída. Estas pruebas fijan la
 * clasificación que hace decidible un reproceso.
 */

describe("motivo tipado de un fallo de recepción", () => {
  it("declara el código del transporte con su naturaleza", () => {
    expect(
      receiptFailureReason(
        new AttachmentTransportError("http_error", true, "HTTP 503.")
      )
    ).toBe("http_error:reintentable");
    expect(
      receiptFailureReason(
        new AttachmentTransportError("unsafe_destination", false, "Red local.")
      )
    ).toBe("unsafe_destination:permanente");
    expect(
      receiptFailureReason(
        new AttachmentTransportError("content_unresolved", false, "Sin contenido.")
      )
    ).toBe("content_unresolved:permanente");
  });

  it("declara el destino ausente y su ventana de reintento", () => {
    expect(
      receiptFailureReason(
        new ReceptionError("sin_destinatario", true, "Conversación ausente.")
      )
    ).toBe("sin_destinatario:reintentable");
    expect(
      receiptFailureReason(
        new ReceptionError("sin_destinatario", false, "Conversación ausente.")
      )
    ).toBe("sin_destinatario:permanente");
  });

  it("declara el código de la base cuando el fallo es de PostgreSQL", () => {
    const error = Object.assign(new Error("duplicate key"), { code: "23505" });
    expect(receiptFailureReason(error)).toBe("base_de_datos:23505");
  });

  it("no degrada un error ajeno a la palabra «Error» cuando puede nombrarlo", () => {
    class FalloDeCola extends Error {
      constructor() {
        super("cola");
        this.name = "FalloDeCola";
      }
    }
    expect(receiptFailureReason(new FalloDeCola())).toBe("FalloDeCola");
    expect(receiptFailureReason(undefined)).toBe("ProcessingError");
  });

  it("el motivo cabe en el asiento y no contiene texto del candidato", () => {
    const motivo = receiptFailureReason(
      new AttachmentTransportError("network_error", true, "Descarga.")
    );
    expect(motivo.length).toBeLessThan(80);
    expect(motivo).not.toMatch(/https?:|@|\d{8,}/);
  });
});

describe("clasificación del adjunto anunciado sin carga", () => {
  it("declara la ausencia de contenido cuando el sobre llega sin la codificación", async () => {
    // Es la forma que el contrato describe como «archivo codificado en base64
    // con su tipo» cuando el proveedor entrega únicamente el tipo declarado: sin
    // coma y sin carga. Antes se degradaba al nombre genérico de una excepción.
    await expect(
      decodeRemoteAttachment("data:application/pdf;base64")
    ).rejects.toMatchObject({ code: "payload_missing", retryable: false });
    expect(
      receiptFailureReason(
        await decodeRemoteAttachment("data:application/pdf;base64").catch(
          error => error
        )
      )
    ).toBe("payload_missing:permanente");
  });

  it("declara la carga inválida cuando el sobre trae contenido que no se decodifica", async () => {
    await expect(
      decodeRemoteAttachment("data:application/pdf;base64,no-es-base64!!")
    ).rejects.toMatchObject({ code: "payload_invalid", retryable: false });
  });

  it("conserva la firma por contenido para una carga legítima", async () => {
    const pdf = Buffer.from("%PDF-1.4\n% prueba de conducto\n%%EOF\n");
    const decoded = await decodeRemoteAttachment(
      `data:application/pdf;base64,${pdf.toString("base64")}`
    );
    expect(decoded?.extension).toBe("pdf");
    expect(decoded?.sizeBytes).toBe(pdf.length);
  });
});
