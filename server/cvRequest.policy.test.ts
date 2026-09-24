import { describe, expect, it, vi } from "vitest";
import {
  dispatchWelcomeMessage,
  ensureCvRequestMessage,
  requestCvForApplication,
  welcomeMessageKey,
} from "./cvRequest";

const application = {
  id: 17,
  status: "calificado",
  full_name: "Persona de prueba",
  phone_international: "+50255555555",
  position_title: "Ejecutivo comercial",
};

const stepTemplate =
  "{{nombre}}, gracias por participar en el proceso de {{plaza}}, ¿puede enviarnos por esta vía su CV?";

describe("política salarial en mensajería automática", () => {
  it("rechaza una plantilla de solicitud de CV que ofrezca remuneración", async () => {
    const query = vi.fn();

    await expect(
      ensureCvRequestMessage(
        { query } as never,
        {
          ...application,
          whatsapp_message:
            "Hola {{nombre}}. Para {{plaza}} le ofrecemos un salario de Q 9,000. Envíe su currículum.",
        },
        stepTemplate
      )
    ).rejects.toThrow(/oferta o propuesta económica/);

    expect(query).not.toHaveBeenCalled();
  });

  it("permite una solicitud institucional sin propuesta económica", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 9 }] })
      .mockResolvedValueOnce({
        rows: [{ id: 31, delivery_status: "pending" }],
      });

    const result = await ensureCvRequestMessage(
      { query } as never,
      {
        ...application,
        whatsapp_message:
          "Hola {{nombre}}. Gracias por su interés en {{plaza}}. Envíe su currículum para continuar.",
      },
      stepTemplate
    );

    expect(result).toMatchObject({ id: 31, created: true });
    expect(String(query.mock.calls[0]?.[0])).toContain(
      "pg_advisory_xact_lock(130, hashtext($1))"
    );
    expect(query.mock.calls[0]?.[1]).toEqual([
      application.phone_international,
    ]);
    expect(String(query.mock.calls[2]?.[0])).toContain(
      "INSERT INTO conversation_messages"
    );
  });
});

describe("solicitud automática de CV", () => {
  it("se prepara y despacha sin exigir el estado calificado", async () => {
    const query = vi.fn(async (sql: string) => {
      const text = String(sql);
      if (text.includes("JOIN candidates c ON c.id=a.candidate_id"))
        return { rows: [{ ...application, status: "en_revision" }] };
      if (text.includes("INSERT INTO conversations"))
        return { rows: [{ id: 4 }] };
      if (text.includes("INSERT INTO conversation_messages"))
        return { rows: [{ id: 31, delivery_status: "pending" }] };
      return { rows: [] };
    });
    const client = { query, release: vi.fn() };
    const pool = { query, connect: vi.fn().mockResolvedValue(client) };

    const result = await requestCvForApplication(pool as never, 17);

    const contactCall = query.mock.calls.find(call =>
      String(call[0]).includes("JOIN candidates c ON c.id=a.candidate_id")
    );
    expect(contactCall).toBeDefined();
    expect(contactCall?.[1]).toEqual([17]);
    expect(
      query.mock.calls.some(call =>
        String(call[0]).includes(
          "UPDATE applications SET whatsapp_status='pendiente'"
        )
      )
    ).toBe(true);
    expect(result).toEqual({ status: "in_progress" });
  });
});

describe("bienvenida del paso de recepción", () => {
  it("abre la conversación con la plantilla editable una sola vez", async () => {
    const query = vi.fn(async (sql: string) => {
      const text = String(sql);
      if (text.includes("FROM integration_settings")) return { rows: [] };
      if (text.includes("FROM conversations WHERE application_id"))
        return { rows: [{ id: 9 }] };
      if (text.includes("JOIN candidates c ON c.id=a.candidate_id"))
        return {
          rows: [
            {
              full_name: "Persona de prueba",
              position_title: "Ejecutivo comercial",
            },
          ],
        };
      if (text.includes("INSERT INTO conversation_messages"))
        return { rows: [{ id: 31, delivery_status: "pending" }] };
      if (
        text.includes("UPDATE conversation_messages") &&
        text.includes("RETURNING cm.id")
      )
        return { rows: [] };
      if (
        text.includes("SELECT delivery_status,last_error FROM conversation_messages")
      )
        return { rows: [{ delivery_status: "pending", last_error: null }] };
      return { rows: [] };
    });
    const client = { query, release: vi.fn() };
    const pool = { query, connect: vi.fn().mockResolvedValue(client) };

    const result = await dispatchWelcomeMessage(pool as never, 17);

    const insertCall = query.mock.calls.find(call =>
      String(call[0]).includes("INSERT INTO conversation_messages")
    );
    expect(insertCall).toBeDefined();
    // La bienvenida usa su propia clave de idempotencia y sustituye las
    // variables de la plantilla del paso 1.
    expect(insertCall?.[1]).toEqual([
      9,
      expect.stringContaining("Persona de prueba"),
      welcomeMessageKey(17),
    ]);
    expect(String(insertCall?.[1]?.[1])).toContain("Ejecutivo comercial");
    expect(result).toEqual({ status: "in_progress" });
  });

  it("no emite bienvenida cuando el paso de recepción está desactivado", async () => {
    const query = vi.fn(async (sql: string) => {
      const text = String(sql);
      if (text.includes("FROM integration_settings"))
        return {
          rows: [
            {
              setting_key: "enabled",
              setting_value: JSON.stringify({
                recepcion_formulario: false,
              }),
            },
          ],
        };
      if (text.includes("FROM conversations WHERE application_id"))
        return { rows: [{ id: 9 }] };
      return { rows: [] };
    });
    const client = { query, release: vi.fn() };
    const pool = { query, connect: vi.fn().mockResolvedValue(client) };

    const result = await dispatchWelcomeMessage(pool as never, 17);

    expect(result).toBeNull();
    expect(
      query.mock.calls.some(call =>
        String(call[0]).includes("INSERT INTO conversation_messages")
      )
    ).toBe(false);
  });
});
