/** PDF sintético completo; no contiene información de personas reales. */
export function syntheticPdf(text = "Curriculum vitae. Software engineer with five years of experience.") {
  const stream = "BT /F1 12 Tf 30 700 Td (" + text.replace(/[()\\]/g, "\\$&") + ") Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Length " + Buffer.byteLength(stream) + " >>\nstream\n" + stream + "\nendstream",
  ];
  let content = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(content));
    content += (index + 1) + " 0 obj\n" + object + "\nendobj\n";
  });
  const xref = Buffer.byteLength(content);
  content += "xref\n0 6\n0000000000 65535 f \n" + offsets.map(offset => String(offset).padStart(10, "0") + " 00000 n \n").join("") + "trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n" + xref + "\n%%EOF\n";
  return Buffer.from(content);
}

