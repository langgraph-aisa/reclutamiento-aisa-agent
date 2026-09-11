import { describe, expect, it, vi } from "vitest";
import { ensureCvRequestMessage } from "./cvRequest";

const application = {
  id: 17,
  status: "calificado",
  full_name: "Persona de prueba",
  phone_international: "+50255555555",
  position_title: "Ejecutivo comercial",
  global_whatsapp_message: null,
};

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
        }
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
      }
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
