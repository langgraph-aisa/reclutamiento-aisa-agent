/**
 * Lectura institucional del desenlace de un adjunto.
 *
 * Fundamento
 * ----------
 * La bandeja declaraba un solo enunciado para todos los rechazos —«no
 * incorporado al expediente por su formato o tamaño»—, de modo que el operador
 * no podía distinguir una decisión administrativa (la extensión no está
 * habilitada) de un límite de peso, de una ausencia de contenido en el
 * proveedor o de una lectura fallida del formato. Cuatro causas distintas con
 * cuatro remedios distintos quedaban indistinguibles, y la única acción posible
 * era suponer.
 *
 * Este módulo traduce el código tipado que ya escribe el conducto
 * (`processingReason`) a una sentencia que declara la causa y el remedio. El
 * código es el hecho; la sentencia es su lectura, y se comparte entre la
 * bandeja, la ficha del candidato y el expediente para que las tres superficies
 * afirmen lo mismo.
 *
 * Distinción que el texto conserva de forma deliberada: **recibido** no es
 * **incorporado**, y **incorporable** no es **interpretado**. Un rechazo de
 * política deja el binario conservado en la bandeja y es recuperable; una
 * ausencia de contenido en el proveedor no lo es.
 */

/** Códigos del conducto que ya no admiten reinserción sin un envío nuevo. */
export const ATTACHMENT_REASONS_WITHOUT_CONSERVED_BINARY = [
  "contenido_no_disponible",
  "payload_missing",
  "payload_invalid",
  "empty_content",
  "content_unresolved",
] as const;

/** Códigos cuya recuperación depende de la política vigente, no del proveedor. */
export const ATTACHMENT_REASONS_RECOVERABLE = [
  "extension_not_allowed",
  "size_limit",
] as const;

const REASON_SENTENCES: Record<string, string> = {
  extension_not_allowed:
    "El formato del archivo no está habilitado en la política de conocimiento. El binario permanece conservado en la bandeja y se incorpora al expediente cuando la extensión se habilita.",
  size_limit:
    "El peso del archivo supera el máximo admitido por la política de conocimiento. El binario permanece conservado en la bandeja y se incorpora al expediente cuando el límite admite ese peso.",
  contenido_no_disponible:
    "El proveedor anunció el archivo sin su contenido. No hay binario conservado, de modo que la recuperación exige un envío nuevo.",
  payload_missing:
    "El proveedor anunció el archivo con su tipo declarado pero sin su carga. No hay binario conservado y la recuperación exige un envío nuevo.",
  payload_invalid:
    "La carga recibida no es una codificación válida. El mensaje consta con su causa y no se incorporó al expediente.",
  empty_content:
    "El origen entregó un adjunto vacío. El mensaje consta con su causa y no hay contenido que incorporar.",
  content_unresolved:
    "El adjunto declarado no pudo resolverse a contenido. El mensaje consta con su causa.",
  http_error:
    "La descarga del adjunto respondió con un error del servidor de origen. El mensaje consta con su causa y admite reintento.",
  network_error:
    "La descarga del adjunto no pudo completarse. El mensaje consta con su causa y admite reintento.",
  unsafe_destination:
    "La dirección del adjunto no superó la guarda de destino. El mensaje consta con su causa y no se descargó.",
  redirect_limit:
    "La descarga del adjunto excedió las redirecciones permitidas. El mensaje consta con su causa.",
  storage_missing:
    "El binario no se conserva en el volumen de almacenamiento. El registro existe y el archivo debe volver a cargarse o restituirse desde el volumen persistente.",
  decoder_unavailable:
    "El formato no dispone de extractor en esta instalación. El archivo está conservado y su interpretación requiere reconocimiento óptico.",
  extraction_failed:
    "La lectura del archivo conservado falló. El motivo consta en el código de la última tentativa y admite reintento.",
  processing_busy:
    "El documento se está procesando en este momento. El estado se resolverá sin intervención.",
  worker_failed:
    "El procesamiento del documento conservado no pudo completarse. Admite reintento desde la ficha del candidato.",
};

/** Motivo declarado por el conducto, sin guion bajo ni naturalidad perdida. */
export function normalizeAttachmentReason(
  reason: string | null | undefined
) {
  const normalized = String(reason ?? "")
    .trim()
    .toLowerCase();
  if (!normalized) return "";
  // El conducto escribe `<código>:<naturaleza>`; la naturaleza se declara aparte.
  return normalized.split(":")[0] ?? "";
}

export function attachmentReasonNature(reason: string | null | undefined) {
  const parts = String(reason ?? "")
    .trim()
    .toLowerCase()
    .split(":");
  return parts.length > 1 ? parts[1] : "";
}

/** Naturaleza del fallo: un enunciado distinto del código, y con remedio distinto. */
export function describeAttachmentNature(reason: string | null | undefined) {
  const nature = attachmentReasonNature(reason);
  if (nature === "reintentable")
    return "El fallo se declaró transitorio: admite reintento sin intervención del candidato.";
  if (nature === "permanente")
    return "El fallo se declaró permanente: reintentarlo no cambia su causa.";
  return "";
}

/**
 * Sentencia completa del desenlace. Un motivo desconocido se declara como tal
 * en lugar de equipararse a una ausencia: la ignorancia no autoriza a concluir.
 */
export function describeAttachmentOutcome(reason: string | null | undefined) {
  const code = normalizeAttachmentReason(reason);
  if (!code)
    return "El archivo consta en la bandeja sin motivo declarado. El expediente y la bandeja se leen por separado.";
  const sentence = REASON_SENTENCES[code];
  const nature = describeAttachmentNature(reason);
  if (!sentence)
    return `El archivo consta en la bandeja con el motivo «${code}», que no figura en el catálogo de causas conocidas. La bandeja conserva el código, no una conclusión.${
      nature ? ` ${nature}` : ""
    }`;
  return nature ? `${sentence} ${nature}` : sentence;
}

/**
 * ¿La recuperación puede intentarse sin exigir al candidato un envío nuevo?
 * Sólo cuando la causa depende de la política y el binario quedó conservado.
 */
export function attachmentIsRecoverable(reason: string | null | undefined) {
  const code = normalizeAttachmentReason(reason);
  if (!code) return true;
  return (ATTACHMENT_REASONS_RECOVERABLE as readonly string[]).includes(code);
}

/** Etiqueta breve para listas y encabezados de columna. */
export function attachmentReasonLabel(reason: string | null | undefined) {
  const code = normalizeAttachmentReason(reason);
  if (!code) return "Sin motivo declarado";
  const labels: Record<string, string> = {
    extension_not_allowed: "Extensión no habilitada",
    size_limit: "Peso sobre el límite",
    contenido_no_disponible: "Contenido no disponible",
    payload_missing: "Archivo anunciado sin contenido",
    payload_invalid: "Codificación no interpretable",
    empty_content: "Contenido vacío",
    content_unresolved: "Contenido no resuelto",
    http_error: "Error del origen",
    network_error: "Red",
    unsafe_destination: "Destino no seguro",
    redirect_limit: "Redirecciones excedidas",
    storage_missing: "Binario ausente del volumen",
    decoder_unavailable: "Sin extractor para el formato",
    extraction_failed: "Lectura fallida",
    processing_busy: "Procesamiento en curso",
    worker_failed: "Trabajo no completado",
  };
  return labels[code] ?? code;
}
