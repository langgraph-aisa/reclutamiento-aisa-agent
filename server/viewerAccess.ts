import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Acceso firmado y temporal para la entrega de archivos al visor.
 *
 * Motivo de ingeniería
 * --------------------
 * El visor incrusta el archivo en `<iframe>`, `<img>`, `<video>` o `<audio>`.
 * Esas peticiones las emite el navegador, no la aplicación, y quedan sujetas a
 * tres restricciones que pueden dejar el visor en blanco:
 *
 * 1. la cookie de sesión usa `SameSite=None`, que exige `Secure` y es rechazada
 *    en entornos sin HTTPS terminado;
 * 2. los navegadores bloquean cookies en contextos incrustados o de terceros;
 * 3. una recarga del visor puede ocurrir después de que la sesión expire.
 *
 * La solución no relaja la autorización: un procedimiento autenticado de
 * administración acuña un vale firmado (HMAC-SHA256) con alcance, identificador
 * y caducidad corta. El vale viaja en la cadena de consulta y autoriza
 * únicamente la lectura de ese archivo mientras siga vigente. La sesión sigue
 * siendo la vía primaria; el vale es una capacidad acotada, no una elevación.
 */

/** Vigencia del vale: suficiente para abrir y recorrer el visor. */
export const VIEWER_TOKEN_TTL_SECONDS = 900;

/**
 * Alcances admitidos; cada recurso valida el suyo. Un vale del RAG de proyectos
 * no abre el RAG del candidato ni al revés, aunque compartan el volumen.
 */
export type ViewerScope = "knowledge" | "inbox" | "candidate";

function viewerSecret() {
  const secret = process.env.JWT_SECRET?.trim();
  if (secret) return secret;
  // Fallo cerrado en producción: sin secreto no se acuñan vales.
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "JWT_SECRET es obligatorio para acuñar vales de visor en producción."
    );
  }
  return "talento-aisa-viewer-development";
}

function signatureFor(scope: ViewerScope, id: string, expiresAt: number) {
  return createHmac("sha256", viewerSecret())
    .update(`${scope}:${id}:${expiresAt}`)
    .digest("base64url");
}

/** Acuña un vale para un recurso concreto. */
export function createViewerToken(
  scope: ViewerScope,
  id: string | number,
  ttlSeconds: number = VIEWER_TOKEN_TTL_SECONDS
) {
  const expiresAt = Math.floor(Date.now() / 1_000) + ttlSeconds;
  return `${expiresAt}.${signatureFor(scope, String(id), expiresAt)}`;
}

/** Verifica vigencia y firma en tiempo constante. */
export function verifyViewerToken(
  scope: ViewerScope,
  id: string | number,
  token: unknown
) {
  // El analizador de consulta puede entregar arreglos u objetos para una clave
  // repetida o anidada. Un valor que no sea cadena no es un vale: se rechaza
  // sin lanzar, de modo que la sesión siga siendo la vía primaria.
  if (typeof token !== "string" || !token) return false;
  const separator = token.indexOf(".");
  if (separator <= 0) return false;
  const expiresAt = Number(token.slice(0, separator));
  if (!Number.isInteger(expiresAt)) return false;
  if (expiresAt < Math.floor(Date.now() / 1_000)) return false;
  let expected: string;
  try {
    expected = signatureFor(scope, String(id), expiresAt);
  } catch {
    return false;
  }
  const received = Buffer.from(token.slice(separator + 1));
  const computed = Buffer.from(expected);
  if (received.length !== computed.length) return false;
  return timingSafeEqual(received, computed);
}

/** Cabeceras del visor: tipo explícito y sin adivinación del navegador. */
export const VIEWER_SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Resource-Policy": "same-origin",
} as const;
