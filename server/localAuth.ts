import { randomBytes, randomInt, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { SignJWT, jwtVerify } from "jose";
import nodemailer from "nodemailer";
import type { Request, Response } from "express";
import { getSessionCookieOptions } from "./_core/cookies";

const scrypt = promisify(scryptCallback);
export const LOCAL_SESSION_COOKIE = "talento-claro-session";
export const LOCAL_SESSION_TTL_SECONDS = 60 * 60 * 12;
export const LOGIN_CODE_TTL_MINUTES = 10;
export const LOGIN_CODE_MAX_ATTEMPTS = 5;
export const LOGIN_CODE_RESEND_SECONDS = 60;

function secretKey() {
  return new TextEncoder().encode(process.env.JWT_SECRET || "development-only-change-me");
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt}:${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, encoded: string | null | undefined) {
  if (!encoded?.startsWith("scrypt:")) return false;
  const [, salt, expectedHex] = encoded.split(":");
  if (!salt || !expectedHex) return false;
  const actual = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(expectedHex, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function createLoginCode() {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export async function hashLoginCode(code: string) {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(code, salt, 32)) as Buffer;
  return `otp-scrypt:${salt}:${derived.toString("hex")}`;
}

export async function verifyLoginCode(code: string, encoded: string | null | undefined) {
  if (!encoded?.startsWith("otp-scrypt:")) return false;
  const [, salt, expectedHex] = encoded.split(":");
  if (!salt || !expectedHex) return false;
  const actual = (await scrypt(code, salt, 32)) as Buffer;
  const expected = Buffer.from(expectedHex, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function maskEmail(email: string) {
  const [localPart, domain] = email.split("@");
  if (!localPart || !domain) return email;
  const visible = localPart.slice(0, Math.min(2, localPart.length));
  return `${visible}${"*".repeat(Math.max(3, localPart.length - visible.length))}@${domain}`;
}

export async function issueLocalSession(userId: number) {
  return new SignJWT({ userId, kind: "local" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(userId))
    .setIssuedAt()
    .setExpirationTime(`${LOCAL_SESSION_TTL_SECONDS}s`)
    .sign(secretKey());
}

export async function readLocalSession(req: Request) {
  const cookieHeader = req.headers.cookie ?? "";
  const token = cookieHeader
    .split(";")
    .map(value => value.trim().split("="))
    .find(([name]) => name === LOCAL_SESSION_COOKIE)?.[1];
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (payload.kind !== "local" || typeof payload.userId !== "number") return null;
    return payload.userId;
  } catch {
    return null;
  }
}

export function setLocalSession(res: Response, req: Request, token: string) {
  res.cookie(LOCAL_SESSION_COOKIE, token, {
    ...getSessionCookieOptions(req),
    maxAge: LOCAL_SESSION_TTL_SECONDS * 1000,
  });
}

export function clearLocalSession(res: Response, req: Request) {
  res.clearCookie(LOCAL_SESSION_COOKIE, getSessionCookieOptions(req));
}

export function createResetToken() {
  return randomBytes(32).toString("base64url");
}

export async function hashResetToken(token: string) {
  const derived = (await scrypt(token, "talento-claro-reset", 32)) as Buffer;
  return derived.toString("hex");
}

export async function notifyPasswordReset(webhook: string | undefined, payload: { email: string; token: string; expiresInMinutes: number }) {
  if (!webhook) return { configured: false, delivered: false } as const;
  try {
    const response = await fetch(webhook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    return { configured: true, delivered: response.ok, status: response.status } as const;
  } catch (error) {
    console.warn("[Auth] Password reset delivery failed", error instanceof Error ? error.message : "unknown error");
    return { configured: true, delivered: false } as const;
  }
}

export async function sendLoginCode(payload: { email: string; code: string; expiresInMinutes?: number }) {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const password = process.env.SMTP_PASSWORD;
  const from = process.env.SMTP_FROM;
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = process.env.SMTP_SECURE === "true" || port === 465;
  if (!host || !user || !password || !from) throw new Error("SMTP no está configurado en EasyPanel.");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("SMTP_PORT no es válido.");

  const expiresInMinutes = payload.expiresInMinutes ?? LOGIN_CODE_TTL_MINUTES;
  const transporter = nodemailer.createTransport({ host, port, secure, auth: { user, pass: password } });
  await transporter.sendMail({
    from,
    to: payload.email,
    subject: "Código de acceso · Talento Claro",
    text: `Tu código de acceso es ${payload.code}. Expira en ${expiresInMinutes} minutos. Si no solicitaste este acceso, ignora este mensaje.`,
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:24px;color:#0b2f53"><h1 style="font-size:22px">Talento Claro</h1><p>Utiliza el siguiente código para ingresar a la plataforma:</p><p style="font-size:34px;letter-spacing:8px;font-weight:700;margin:28px 0">${payload.code}</p><p>El código expira en <strong>${expiresInMinutes} minutos</strong> y solo puede utilizarse una vez.</p><p style="color:#64748b;font-size:13px">Si no solicitaste este acceso, ignora este mensaje.</p></div>`,
  });
}
