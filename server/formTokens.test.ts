import { describe, expect, it } from "vitest";
import {
  FORM_PUBLIC_TOKEN_PATTERN,
  createFormPublicToken,
  isFormPublicToken,
} from "./formTokens";

describe("enlace seguro por formulario", () => {
  it("genera tokens de 128 bits en hexadecimal minúscula", () => {
    const token = createFormPublicToken();
    expect(FORM_PUBLIC_TOKEN_PATTERN.test(token)).toBe(true);
    expect(token).toHaveLength(32);
    expect(isFormPublicToken(token.toUpperCase())).toBe(true);
    expect(isFormPublicToken("demo-vendedor")).toBe(false);
    expect(isFormPublicToken("")).toBe(false);
  });

  it("no repite tokens entre formularios", () => {
    const tokens = new Set(
      Array.from({ length: 300 }, () => createFormPublicToken())
    );
    expect(tokens.size).toBe(300);
  });
});
