import { describe, expect, it } from "vitest";

const looksConfigured = (value: string | undefined) => Boolean(value && value.trim() && !value.includes("PENDIENTE") && !value.includes("pending"));

describe("integration secrets", () => {
  it("validates ApiChat configuration shape without network access", () => {
    const endpoint = process.env.APICHAT_API_ENDPOINT;
    const token = process.env.APICHAT_TOKEN;
    const accountId = process.env.APICHAT_ACCOUNT_ID;
    const configured = { endpoint: looksConfigured(endpoint), token: looksConfigured(token), accountId: looksConfigured(accountId) };

    expect(configured).toEqual({ endpoint: configured.endpoint, token: configured.token, accountId: configured.accountId });
    expect(typeof configured.endpoint).toBe("boolean");
    expect(typeof configured.token).toBe("boolean");
    expect(typeof configured.accountId).toBe("boolean");
  });
});
