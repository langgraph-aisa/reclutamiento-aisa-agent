import { afterEach, describe, expect, it, vi } from "vitest";

const { sendMail, createTransport } = vi.hoisted(() => {
  const sendMailMock = vi.fn().mockResolvedValue({ messageId: "test-message" });
  return { sendMail: sendMailMock, createTransport: vi.fn(() => ({ sendMail: sendMailMock })) };
});
vi.mock("nodemailer", () => ({ default: { createTransport } }));

import { createLoginCode, hashLoginCode, maskEmail, sendLoginCode, verifyLoginCode } from "./localAuth";

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_PORT;
  delete process.env.SMTP_SECURE;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASSWORD;
  delete process.env.SMTP_FROM;
});

describe("email code authentication", () => {
  it("creates six-digit numeric codes", () => {
    for (let index = 0; index < 20; index += 1) expect(createLoginCode()).toMatch(/^\d{6}$/);
  });

  it("hashes codes with a random salt and verifies without plaintext storage", async () => {
    const firstHash = await hashLoginCode("123456");
    const secondHash = await hashLoginCode("123456");
    expect(firstHash).toMatch(/^otp-scrypt:/);
    expect(firstHash).not.toContain("123456");
    expect(secondHash).not.toBe(firstHash);
    await expect(verifyLoginCode("123456", firstHash)).resolves.toBe(true);
    await expect(verifyLoginCode("654321", firstHash)).resolves.toBe(false);
  });

  it("masks the destination email returned by the request endpoint", () => {
    expect(maskEmail("adminit@aisa.com.gt")).toBe("ad*****@aisa.com.gt");
  });

  it("sends the access code using SMTP configuration without network access in the test", async () => {
    process.env.SMTP_HOST = "smtp.example.test";
    process.env.SMTP_PORT = "587";
    process.env.SMTP_SECURE = "false";
    process.env.SMTP_USER = "mailer@example.test";
    process.env.SMTP_PASSWORD = "test-secret";
    process.env.SMTP_FROM = "Talento Claro <mailer@example.test>";

    await sendLoginCode({ email: "adminit@aisa.com.gt", code: "123456", expiresInMinutes: 10 });

    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ host: "smtp.example.test", port: 587, secure: false }));
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: "adminit@aisa.com.gt", subject: expect.stringContaining("Código de acceso"), text: expect.stringContaining("123456") }));
  });
});
