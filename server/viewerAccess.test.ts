import { describe, expect, it } from "vitest";
import {
  VIEWER_SECURITY_HEADERS,
  VIEWER_TOKEN_TTL_SECONDS,
  createViewerToken,
  verifyViewerToken,
} from "./viewerAccess";

describe("vale de acceso al visor", () => {
  it("autoriza el recurso exacto para el que fue acuñado", () => {
    const token = createViewerToken("knowledge", 42);
    expect(verifyViewerToken("knowledge", 42, token)).toBe(true);
    expect(verifyViewerToken("knowledge", 43, token)).toBe(false);
  });

  it("separa los alcances: un vale de conocimiento no abre la bandeja", () => {
    const token = createViewerToken("knowledge", 7);
    expect(verifyViewerToken("inbox", 7, token)).toBe(false);
    expect(verifyViewerToken("knowledge", 7, token)).toBe(true);
  });

  it("rechaza un vale vencido", () => {
    const token = createViewerToken("knowledge", 9, -1);
    expect(verifyViewerToken("knowledge", 9, token)).toBe(false);
  });

  it("rechaza una firma manipulada", () => {
    const token = createViewerToken("knowledge", 11);
    const [expiry, signature] = token.split(".");
    const tampered = `${expiry}.${signature!.slice(0, -2)}xy`;
    expect(verifyViewerToken("knowledge", 11, tampered)).toBe(false);
  });

  it("rechaza una caducidad manipulada", () => {
    const token = createViewerToken("knowledge", 13);
    const signature = token.slice(token.indexOf(".") + 1);
    const forged = `${Math.floor(Date.now() / 1_000) + 9_999}.${signature}`;
    expect(verifyViewerToken("knowledge", 13, forged)).toBe(false);
  });

  it("rechaza entradas ausentes o malformadas", () => {
    expect(verifyViewerToken("knowledge", 1, undefined)).toBe(false);
    expect(verifyViewerToken("knowledge", 1, null)).toBe(false);
    expect(verifyViewerToken("knowledge", 1, "")).toBe(false);
    expect(verifyViewerToken("knowledge", 1, "sin-punto")).toBe(false);
    expect(verifyViewerToken("knowledge", 1, "abc.def")).toBe(false);
  });

  it("rechaza valores de consulta que no son cadena sin lanzar excepción", () => {
    // `?t=a&t=b` o `?t[x]=y` llegan como arreglo u objeto: no son vales y la
    // petición debe continuar por la vía de la sesión.
    expect(verifyViewerToken("knowledge", 1, ["a", "b"])).toBe(false);
    expect(verifyViewerToken("knowledge", 1, { x: "y" })).toBe(false);
    expect(verifyViewerToken("knowledge", 1, 42)).toBe(false);
  });

  it("declara una vigencia corta y cabeceras restrictivas", () => {
    expect(VIEWER_TOKEN_TTL_SECONDS).toBeLessThanOrEqual(1_800);
    expect(VIEWER_SECURITY_HEADERS["X-Content-Type-Options"]).toBe("nosniff");
    expect(VIEWER_SECURITY_HEADERS["Cross-Origin-Resource-Policy"]).toBe(
      "same-origin"
    );
  });
});
