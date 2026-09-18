import { afterEach, describe, expect, it } from "vitest";
import { extractDocumentText } from "./documentExtraction";

/** PDF válido completo: el parser real debe interpretar su xref y su stream. */
function pdf(text: string) {
  const stream = text ? `BT /F1 12 Tf 72 700 Td (${text}) Tj ET` : "";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let content = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(content));
    content += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(content);
  content += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map(offset => String(offset).padStart(10, "0") + " 00000 n \n")
    .join(
      ""
    )}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(content);
}

const originalOcr = process.env.DOCUMENT_OCR_ENABLED;
afterEach(() => {
  if (originalOcr === undefined) delete process.env.DOCUMENT_OCR_ENABLED;
  else process.env.DOCUMENT_OCR_ENABLED = originalOcr;
});

describe("extracción real de documentos", () => {
  it("extrae texto de un PDF real y libera su parser", async () => {
    const result = await extractDocumentText(
      pdf("Curriculum vitae. Software engineer, five years."),
      "pdf"
    );
    expect(result.text).toContain("Software engineer, five years.");
    expect(result.method).toBe("pdf-text");
    expect(result.truncated).toBe(false);
  });
  it("no confunde los marcadores de página del parser con texto de un PDF vacío", async () => {
    process.env.DOCUMENT_OCR_ENABLED = "false";
    await expect(extractDocumentText(pdf(""), "pdf")).rejects.toMatchObject({
      code: "ocr_disabled",
    });
  });
  it("distingue PDF corrupto de PDF sin texto", async () => {
    await expect(
      extractDocumentText(Buffer.from("%PDF-1.7\ncorrupt"), "pdf")
    ).rejects.toMatchObject({ code: "extraction_failed" });
  });
  it("declara formatos sin extracción en lugar de retornar texto vacío", async () => {
    await expect(
      extractDocumentText(Buffer.from("data"), "xyz")
    ).rejects.toMatchObject({ code: "unsupported_format" });
  });
});
