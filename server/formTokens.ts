import { randomBytes } from "node:crypto";

/**
 * Enlace público por formulario.
 *
 * Ontología: el enlace no identifica a la plaza sino a un formulario concreto
 * dentro de esa plaza. Así una plaza puede ofrecer varias variantes —A, B, C,
 * D— y cada una conserva su propio enlace, su propio interruptor y su propia
 * trazabilidad de respuestas.
 *
 * Epistemología: el token es una capacidad de 128 bits generada con la fuente
 * criptográfica del sistema operativo; no deriva de datos del candidato, de la
 * plaza ni de la versión, por lo que no revela información y no es predecible.
 * La base de datos conserva un índice único que impide reutilizarlo.
 */
export const FORM_PUBLIC_TOKEN_PATTERN = /^[a-f0-9]{32}$/;

export function createFormPublicToken() {
  return randomBytes(16).toString("hex");
}

export function isFormPublicToken(value: string) {
  return FORM_PUBLIC_TOKEN_PATTERN.test(value.trim().toLowerCase());
}
