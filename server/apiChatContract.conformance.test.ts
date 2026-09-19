import { describe, expect, it } from "vitest";
import {
  ATTACHMENT_MESSAGE_TYPES,
  normalizeApiChatBatch,
  normalizeApiChatMessage,
  normalizeApiChatWebhookPayload,
} from "./apiChatContract";
import { decodeRemoteAttachment } from "./base64Transport";

/**
 * Conformidad del adaptador con el contrato publicado por el proveedor.
 *
 * Los ejemplos de este archivo se transcriben del OpenAPI oficial
 * (`https://panel.apichat.io/openapi.yaml?version=1.7` · 51 022 bytes ·
 * SHA-256 `eb487f5bb20300298fbfe53e39b9d36589e1bf3a76335534c7efb5729c33c68d`),
 * no del propio adaptador. Una prueba derivada del código que prueba certifica
 * su coherencia interna y **no puede descubrir** una divergencia de vocabulario
 * con el proveedor; por eso cada caso cita el esquema del que proviene.
 *
 * Localizadores del contrato (líneas del archivo autenticado):
 * `Messages` 1079–1087 · `Message` 1088–1098 · `ReceiveBase` 1104–1138 ·
 * `ReceiveText` 1139–1151 · `ReceiveFile` 1173–1187 · `ReceiveImage` 1188–1202 ·
 * `ReceiveAudio` 1164–1172 · `ReceiveVideo` 1203–1211 · `MediaBase` 828–835 ·
 * `MessageBase` 814–820 · `MessageBaseReq` 803–813 · `MessageMetadata` 1250–1305 ·
 * `MessageDB` 973–1003 · `Events` 1016–1024 · `Author` 1455–1458 ·
 * `ConversationName` 1391–1394 · `AccountUpdate.notify_format` 1311–1356.
 */

const CLIENT = "1001";
const MEDIA = (name: string) => `https://api.apichat.io/v1/media/${CLIENT}/${name}`;
const PDF_BYTES = Buffer.from("%PDF-1.7 conteo sintetico ".repeat(8), "utf8");

describe("conformidad del contrato: identidad y vocabulario", () => {
  it("reconoce ReceiveText dentro del sobre Messages", () => {
    const message = normalizeApiChatWebhookPayload({
      messages: [
        {
          id: "3EB0C767D097B7C7C03011",
          number: "50230939134",
          type: "text",
          text: "Adjunto mi CV",
          time: 1789730700,
          from_me: false,
        },
      ],
    });
    expect(message).toMatchObject({
      id: "3EB0C767D097B7C7C03011",
      number: "50230939134",
      type: "text",
      text: "Adjunto mi CV",
      from_me: false,
    });
  });

  it("toma el destinatario del número y jamás lo sustituye por Author", () => {
    const conNumero = normalizeApiChatMessage({
      id: "uno",
      number: "50230939134",
      author: "50255550001",
      type: "text",
      text: "Hola",
      time: 1789730700,
    });
    expect(conNumero?.number).toBe("50230939134");
    expect(conNumero?.author).toBe("50255550001");
  });

  it("usa Author como respaldo cuando el contrato no trae número utilizable", () => {
    const message = normalizeApiChatMessage({
      id: "dos",
      author: "50230939134",
      type: "text",
      text: "Hola",
      time: 1789730700,
    });
    expect(message?.number).toBe("50230939134");
  });

  it("no confunde ConversationName con el nombre del archivo", () => {
    const message = normalizeApiChatMessage({
      id: "tres",
      number: "50230939134",
      name: "Juan",
      type: "text",
      text: "Hola",
      time: 1789730700,
    });
    expect(message?.name).toBe("Juan");
    expect(message?.filename).toBeUndefined();
    // El nombre del contacto nunca se resuelve como contenido del mensaje.
    expect(message?.contentValue).toBeUndefined();
  });

  it("rechaza el chat de grupo aunque traiga Author", () => {
    expect(
      normalizeApiChatMessage({
        id: "grupo",
        number: "50230939134",
        author: "50255550001",
        type: "text",
        text: "Hola",
        chat_type: "group",
      })
    ).toBeNull();
    expect(
      normalizeApiChatMessage({
        id: "grupo-2",
        number: "50255550001-50255550002@g.us",
        type: "text",
        text: "Hola",
      })
    ).toBeNull();
  });
});

describe("conformidad del contrato: el adjunto y su descriptor", () => {
  it("reconoce ReceiveFile con la dirección de medios contractual", () => {
    const message = normalizeApiChatMessage({
      id: "cv-1",
      number: "50230939134",
      name: "Juan",
      author: "50230939134",
      type: "file",
      filename: "curriculum.pdf",
      url: MEDIA("file.pdf"),
      time: 1789730700,
      from_me: false,
    });
    expect(message).toMatchObject({
      type: "file",
      filename: "curriculum.pdf",
      contentField: "url",
      contentValue: MEDIA("file.pdf"),
    });
    expect(ATTACHMENT_MESSAGE_TYPES.has(message!.type)).toBe(true);
  });

  it("resuelve el base64 con datos, que es la otra forma que MediaBase declara", async () => {
    const dataUri = `data:application/pdf;base64,${PDF_BYTES.toString("base64")}`;
    const message = normalizeApiChatMessage({
      id: "cv-2",
      number: "50230939134",
      type: "file",
      filename: "curriculum.pdf",
      url: dataUri,
      time: 1789730700,
    });
    expect(message?.contentValue).toBe(dataUri);
    const decoded = await decodeRemoteAttachment(message!.contentValue!, {
      fileName: "curriculum.pdf",
    });
    expect(decoded?.mimeType).toBe("application/pdf");
    expect(decoded?.sizeBytes).toBe(PDF_BYTES.byteLength);
  });

  it("declara la ausencia de carga cuando el descriptor llega sin datos", async () => {
    // Forma observada en la instancia el 19/09/2026: el panel del proveedor la
    // exhibe literalmente en su columna «Message», y el cuerpo notificado pesa
    // 344 bytes, de modo que la carga no viaja en ningún campo.
    const message = normalizeApiChatMessage({
      id: "cv-3",
      number: "50230939134",
      type: "file",
      url: "data:application/pdf;base64",
      time: 1789730700,
    });
    expect(message?.contentValue).toBe("data:application/pdf;base64");
    await expect(
      decodeRemoteAttachment(message!.contentValue!, { fileName: "cv.pdf" })
    ).rejects.toMatchObject({ code: "payload_missing", retryable: false });
  });

  it("reconoce ReceiveImage, cuyo caption es obligatorio en el contrato", () => {
    const message = normalizeApiChatMessage({
      id: "img-1",
      number: "50230939134",
      type: "image",
      caption: "Imágenes",
      url: MEDIA("image.png"),
      time: 1789730700,
    });
    expect(message).toMatchObject({
      type: "image",
      text: "Imágenes",
      contentValue: MEDIA("image.png"),
    });
  });

  it("reconoce ReceiveAudio y ReceiveVideo con su dirección contractual", () => {
    for (const [type, name] of [
      ["audio", "audio.ogg"],
      ["video", "video.mp4"],
    ] as const) {
      const message = normalizeApiChatMessage({
        id: `medio-${type}`,
        number: "50230939134",
        type,
        url: MEDIA(name),
        time: 1789730700,
      });
      expect(message?.type).toBe(type);
      expect(message?.contentValue).toBe(MEDIA(name));
      expect(ATTACHMENT_MESSAGE_TYPES.has(type)).toBe(true);
    }
  });

  it("resuelve el medio de MessageMetadata y nunca su miniatura", () => {
    const message = normalizeApiChatMessage({
      id: "post-1",
      number: "50230939134",
      type: "file",
      metadata: {
        type: "post",
        media: {
          type: "file",
          url: MEDIA("file.pdf"),
          mimetype: "application/pdf",
          thumbnail: "data:image/jpeg;base64,asdf41",
        },
      },
      time: 1789730700,
    });
    expect(message).toMatchObject({
      contentField: "metadata.media.url",
      contentValue: MEDIA("file.pdf"),
      mime_type: "application/pdf",
    });
    expect(message?.contentFieldsPresent).toContain("metadata.media.url");
    expect(message?.contentValue).not.toContain("asdf41");
  });

  it("prefiere el url nativo del adjunto sobre el medio de la metadata", () => {
    const message = normalizeApiChatMessage({
      id: "post-2",
      number: "50230939134",
      type: "file",
      url: MEDIA("file.pdf"),
      metadata: { type: "post", media: { type: "file", url: MEDIA("otro.pdf") } },
      time: 1789730700,
    });
    expect(message?.contentValue).toBe(MEDIA("file.pdf"));
    expect(message?.contentField).toBe("url");
  });
});

describe("conformidad del contrato: el registro del historial", () => {
  it("desciende el sobre MessageDB y conserva la marca del mensaje", () => {
    const batch = normalizeApiChatBatch([
      {
        message: {
          id: "hist-1",
          number: "50230939134",
          type: "file",
          filename: "curriculum.pdf",
          url: MEDIA("file.pdf"),
          time: 1789730700,
        },
        external_id: "ext-1",
        from_me: false,
        sent_date: "2026-09-19T09:00:00.000Z",
        delivered_date: "2026-09-19T09:00:02.000Z",
      },
    ]);
    expect(batch).toHaveLength(1);
    // `ReceiveBase.time` gobierna la marca del mensaje; `sent_date` sólo
    // respalda cuando el mensaje no la trae.
    expect(batch[0]).toMatchObject({
      id: "hist-1",
      type: "file",
      filename: "curriculum.pdf",
      providerTimestamp: new Date(1789730700 * 1000).toISOString(),
    });
  });

  it("respalda la marca con sent_date cuando el mensaje del historial no trae time", () => {
    const message = normalizeApiChatMessage({
      message: { id: "hist-2", number: "50230939134", type: "text", text: "Hola" },
      external_id: "ext-2",
      from_me: false,
      sent_date: "2026-09-19T09:00:00.000Z",
    });
    expect(message?.providerTimestamp).toBe("2026-09-19T09:00:00.000Z");
  });

  it("respalda la identidad con external_id cuando el mensaje no la trae", () => {
    const message = normalizeApiChatMessage({
      message: { number: "50230939134", type: "text", text: "Hola" },
      external_id: "ext-9",
      from_me: false,
      sent_date: "2026-09-19T09:00:00.000Z",
    });
    expect(message?.id).toBe("ext-9");
    expect(message?.number).toBe("50230939134");
  });

  it("desenvuelve la notificación envuelta por notify_format", () => {
    const inner = JSON.stringify({
      messages: [
        {
          id: "env-1",
          number: "50230939134",
          type: "text",
          text: "Hola",
          time: 1789730700,
        },
      ],
    });
    const batch = normalizeApiChatBatch(JSON.parse(`{"my_data":${JSON.stringify(inner)}}`));
    expect(batch).toHaveLength(1);
    expect(batch[0]).toMatchObject({ id: "env-1", text: "Hola" });
  });
});

describe("conformidad del contrato: lo que no es un mensaje", () => {
  it("no toma el sobre de eventos por un mensaje", () => {
    const batch = normalizeApiChatBatch({
      events: [
        {
          id: "3EB0C767D097B7C7C03011",
          number: "50230939134",
          from_me: false,
          type: "delivered",
          chat_type: "individual",
        },
      ],
    });
    expect(batch).toEqual([null]);
  });

  it("no toma la actualización de conversación por un mensaje", () => {
    const batch = normalizeApiChatBatch({
      id: "17368169142@c.us",
      name: "Juan",
      chat_type: "individual",
    });
    expect(batch).toEqual([null]);
  });

  it("no toma un cuerpo vacío ni una identidad sin teléfono por un mensaje", () => {
    expect(normalizeApiChatMessage({ type: "text", text: "Hola" })).toBeNull();
    expect(
      normalizeApiChatMessage({ id: "x", number: "123", type: "text", text: "Hola" })
    ).toBeNull();
    expect(normalizeApiChatMessage({ id: "x", number: "50230939134" })).toBeNull();
  });
});
