import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createMediaTestDatabase } from "./testSupport/mediaDatabase";
import {
  declaredAttachmentUrl,
  listConservedAttachments,
  listUnresolvedAttachments,
  recoverConservedAttachments,
} from "./candidateConservedRecovery";
import { recordNormalizedInboundFile } from "./inbox";
import { buildInboxFileKey, writeInboxFile } from "./inboxFiles";

/**
 * Alcance del adjunto conservado.
 *
 * Fundamento
 * ----------
 * La ficha del candidato ofrecía «Incorporar al expediente y reevaluar» sobre
 * una lista rotulada «Adjuntos conservados fuera del expediente». La lista se
 * componía con una condición que admitía la clave de almacenamiento **vacía**,
 * y el conducto escribe exactamente eso cuando la carga no llegó
 * (`storageKey: ""` en la rama de rechazo de `apiChatWebhook.ts`). El resultado
 * observado en producción el 19 de septiembre de 2026: cuatro adjuntos
 * declarados «conservados» cuyos motivos —`payload_missing` y
 * `content_unresolved`— significan, por la lectura institucional del propio
 * artefacto, que **no hay binario conservado**. Dos superficies autorizadas
 * afirmaban cosas contrarias sobre el mismo hecho, y el botón no incorporaba
 * nada porque no había nada que incorporar.
 *
 * La prueba fija el contrato que la operación necesita: **conservado** es una
 * afirmación sobre el volumen, no sobre el mensaje. Un registro sólo entra en
 * la lista si su binario existe, y la operación distingue el rechazo que la
 * política puede levantar de la ausencia que exige una entrega nueva.
 *
 * Se escribe con el **redactor real** (`recordNormalizedInboundFile`), no con
 * un INSERT de conveniencia: el defecto vive en la frontera entre lo que el
 * conducto asienta y lo que la consulta considera conservado, de modo que
 * sustituir el redactor por una fixture propia falsificaría justamente el hecho
 * que se quiere observar.
 */

const enabled = Boolean(process.env.MEDIA_TEST_DATABASE_URL);

describe.runIf(enabled)(
  "Alcance del adjunto conservado frente al volumen real",
  () => {
    let database: Awaited<ReturnType<typeof createMediaTestDatabase>>;
    let directory: string;
    let applicationId: number;
    let conversationId: number;
    /** Identidad del anuncio que sí conserva binario, para seguir su rastro. */
    let policyMessageId = 0;
    const phone = "+50255559001";

    const PDF_BYTES = Buffer.concat([
      Buffer.from("%PDF-1.7\n", "utf8"),
      Buffer.from("handout de galasso con experiencia administrativa ".repeat(6), "utf8"),
    ]);

    beforeAll(async () => {
      database = await createMediaTestDatabase();
      directory = await fs.mkdtemp(path.join(os.tmpdir(), "conserved-scope-"));
      process.env.KNOWLEDGE_STORAGE_DIR = directory;
      const pool = database.pool;
      const candidate = (
        await pool.query(
          `INSERT INTO candidates(phone_international,full_name) VALUES($1,'Candidato conservado') RETURNING id`,
          [phone]
        )
      ).rows[0].id;
      const position = (
        await pool.query(
          `INSERT INTO job_positions(public_slug,code,title,agent_key) VALUES('conserved-scope','conserved-scope','Auxiliar Administrativo-Contable','test') RETURNING id`
        )
      ).rows[0].id;
      const form = (
        await pool.query(
          `INSERT INTO application_forms(job_position_id,title) VALUES($1,'Formulario de prueba') RETURNING id`,
          [position]
        )
      ).rows[0].id;
      applicationId = (
        await pool.query(
          `INSERT INTO applications(candidate_id,job_position_id,form_id) VALUES($1,$2,$3) RETURNING id`,
          [candidate, position, form]
        )
      ).rows[0].id;
      conversationId = (
        await pool.query(
          `INSERT INTO conversations(application_id,status,agent_enabled,human_takeover,automation_state) VALUES($1,'activo',true,false,'agent') RETURNING id`,
          [applicationId]
        )
      ).rows[0].id;
    }, 120_000);

    afterAll(async () => {
      await database?.close();
      if (directory) await fs.rm(directory, { recursive: true, force: true });
    });

    /** Asienta el adjunto con el redactor real del conducto. */
    async function announce(input: {
      providerMessageId: string;
      fileName: string;
      storageKey: string;
      sizeBytes: number;
      processingOutcome: string;
      processingReason: string;
    }) {
      await recordNormalizedInboundFile(database.pool, {
        applicationId,
        conversationId,
        providerMessageId: input.providerMessageId,
        phoneInternational: phone,
        fileName: input.fileName,
        mimeType: "application/pdf",
        sizeBytes: input.sizeBytes,
        storageKey: input.storageKey,
        sha256: undefined,
        processingOutcome: input.processingOutcome,
        processingReason: input.processingReason,
      });
    }

    it("no declara conservado el adjunto cuya carga nunca llegó", async () => {
      // Las cuatro formas observadas en la instancia: el proveedor anunció el
      // archivo sin su carga y el conducto conservó el anuncio, no el binario.
      await announce({
        providerMessageId: "conserved-mst-eir",
        fileName: "MST-EIR-SOLAR-GT.pdf",
        storageKey: "",
        sizeBytes: 0,
        processingOutcome: "rejected",
        processingReason: "payload_missing:permanente",
      });
      await announce({
        providerMessageId: "conserved-ia-psicometricas",
        fileName: "IA Psicométricas.pdf",
        storageKey: "",
        sizeBytes: 0,
        processingOutcome: "rejected",
        processingReason: "payload_missing:permanente",
      });
      await announce({
        providerMessageId: "conserved-handout",
        fileName: "PE_HANDOUT_GALASSO20111121224951.PDF",
        storageKey: "",
        sizeBytes: 0,
        processingOutcome: "rejected",
        processingReason: "content_unresolved:permanente",
      });
      await announce({
        providerMessageId: "conserved-siera",
        fileName: "SIERA-GT-SOLAR-GT.pdf",
        storageKey: "",
        sizeBytes: 0,
        processingOutcome: "rejected",
        processingReason: "content_unresolved:permanente",
      });

      const conserved = await listConservedAttachments(
        database.pool,
        applicationId
      );

      // El asiento conserva el motivo —no se pierde evidencia— pero ninguna de
      // las cuatro puede ofrecerse como conservada: su binario no existe.
      expect(conserved).toHaveLength(0);
      // Y no desaparecen: se declaran aparte, con la causa y el remedio que el
      // catálogo compartido con la bandeja ya redactaba para esos códigos.
      const announced = await listUnresolvedAttachments(
        database.pool,
        applicationId
      );
      expect(announced.map(item => item.reason)).toEqual([
        "payload_missing:permanente",
        "payload_missing:permanente",
        "content_unresolved:permanente",
        "content_unresolved:permanente",
      ]);
      expect(announced[0].detail).toContain("sin su carga");
      expect(announced[0].detail).toContain("exige un envío nuevo");
      expect(announced[3].detail).toContain("no pudo resolverse a contenido");
      const reasons = (
        await database.pool.query(
          `SELECT metadata->'media'->>'processingReason' AS reason
             FROM conversation_messages
            WHERE conversation_id=$1
            ORDER BY id`,
          [conversationId]
        )
      ).rows.map(row => row.reason);
      expect(reasons).toEqual([
        "payload_missing:permanente",
        "payload_missing:permanente",
        "content_unresolved:permanente",
        "content_unresolved:permanente",
      ]);
    }, 60_000);

    it("declara conservado sólo el adjunto cuyo binario está en el volumen", async () => {
      const storageKey = buildInboxFileKey("in", conversationId);
      await writeInboxFile(storageKey, PDF_BYTES);
      await announce({
        providerMessageId: "conserved-policy",
        fileName: "SIERA-GT-SOLAR-GT.pdf",
        storageKey,
        sizeBytes: PDF_BYTES.length,
        processingOutcome: "rejected",
        processingReason: "extension_not_allowed",
      });

      const conserved = await listConservedAttachments(
        database.pool,
        applicationId
      );
      expect(conserved).toHaveLength(1);
      expect(conserved[0]).toMatchObject({
        fileName: "SIERA-GT-SOLAR-GT.pdf",
        storageKey,
        reason: "extension_not_allowed",
      });
      policyMessageId = conserved[0].messageId;
    }, 60_000);

    it("incorpora el conservado y declara la ausencia del que no lo está", async () => {
      const settings = await database.pool.query(
        `INSERT INTO integration_settings(provider,setting_key,setting_value)
         VALUES('recruitment','allowed_extensions','jpg,pdf'),('recruitment','max_size_mb','25')
         ON CONFLICT (provider,setting_key) DO UPDATE SET setting_value=EXCLUDED.setting_value
         RETURNING setting_key`
      );
      expect(settings.rowCount).toBe(2);

      const report = await recoverConservedAttachments(database.pool, {
        applicationId,
        actorUserId: null,
        analyze: false,
        reevaluate: false,
        source: "manual",
      });

      // Un solo hecho recuperable: el binario presente. Los cuatro anuncios sin
      // carga no se cuentan como fallo de la operación porque no forman parte
      // de su alcance —declararlos «no incorporados» sería volver a atribuir a
      // la operación una ausencia del proveedor.
      expect(report.scanned).toBe(1);
      expect(report.incorporated).toBe(1);
      expect(report.missing).toBe(0);
      expect(report.items.map(item => item.state)).toEqual(["incorporated"]);

      const documents = await database.pool.query(
        `SELECT original_name FROM candidate_knowledge_files WHERE application_id=$1`,
        [applicationId]
      );
      expect(documents.rows.map(row => row.original_name)).toEqual([
        "SIERA-GT-SOLAR-GT.pdf",
      ]);
      // La incorporación retira al documento del conjunto anunciado: el hecho
      // cambió y las dos superficies lo reflejan a la vez. Se compara por
      // identidad de mensaje porque el nombre del archivo puede repetirse entre
      // anuncios distintos.
      const announced = await listUnresolvedAttachments(
        database.pool,
        applicationId
      );
      expect(announced.map(item => item.messageId)).not.toContain(
        policyMessageId
      );
    }, 120_000);

    it("expone la dirección declarada y nunca una cadena de contenido", async () => {
      // El contrato admite direcciones `http://` que la guarda de descarga no
      // acepta por esquema: la pérdida es del receptor, pero una persona sí puede
      // mirar el archivo. El anuncio sin carga, en cambio, no tiene nada que
      // abrir, y publicar su sobre `data:` como enlace sería ofrecer un archivo
      // vacío con apariencia de documento.
      await announce({
        providerMessageId: "conserved-addressable",
        fileName: "CV-Jose-Miguel-Ardon-Lopez.pdf",
        storageKey: "",
        sizeBytes: 0,
        processingOutcome: "rejected",
        processingReason: "content_unresolved:permanente",
      });
      await announce({
        providerMessageId: "conserved-payloadless",
        fileName: "20240312_SEEWORLD_Introduction-Mandy.pdf",
        storageKey: "",
        sizeBytes: 0,
        processingOutcome: "rejected",
        processingReason: "payload_missing:permanente",
      });
      const receipt = (
        key: string,
        providerMessageId: string,
        payload: Record<string, unknown>
      ) =>
        database.pool.query(
          `INSERT INTO apichat_inbound_receipts
             (receipt_key,provider_message_id,origin,payload,payload_sha256,status,outcome)
           VALUES($1,$2,'webhook',$3::jsonb,$4,'dead','dead')`,
          [key, providerMessageId, JSON.stringify(payload), `digest-${key}`]
        );
      await receipt("receipt-addressable", "conserved-addressable", {
        id: "conserved-addressable",
        url: "http://media.apichat.io/adjunto/cv-jose-miguel.pdf",
      });
      await receipt("receipt-payloadless", "conserved-payloadless", {
        id: "conserved-payloadless",
        url: "data:application/pdf;base64",
      });

      const announced = await listUnresolvedAttachments(
        database.pool,
        applicationId
      );
      const byName = new Map(announced.map(item => [item.fileName, item]));
      expect(byName.get("CV-Jose-Miguel-Ardon-Lopez.pdf")?.declaredUrl).toBe(
        "http://media.apichat.io/adjunto/cv-jose-miguel.pdf"
      );
      expect(
        byName.get("20240312_SEEWORLD_Introduction-Mandy.pdf")?.declaredUrl
      ).toBeNull();
    }, 60_000);

    it("no publica destinos internos ni contenido como enlace", () => {
      // El enlace vive en un panel autenticado y lo pulsa una persona: su
      // destino no puede ser la red privada, y una cadena de contenido no es una
      // dirección. La guarda es la misma que aplica el transporte a la descarga.
      expect(declaredAttachmentUrl("http://media.apichat.io/cv.pdf")).toBe(
        "http://media.apichat.io/cv.pdf"
      );
      expect(
        declaredAttachmentUrl("https://media.apichat.io/cv.pdf")
      ).toBe("https://media.apichat.io/cv.pdf");
      expect(declaredAttachmentUrl("http://127.0.0.1:8080/panel")).toBeNull();
      expect(declaredAttachmentUrl("http://192.168.1.10/cv.pdf")).toBeNull();
      expect(declaredAttachmentUrl("http://10.0.0.5/cv.pdf")).toBeNull();
      expect(declaredAttachmentUrl("http://localhost:3000/cv.pdf")).toBeNull();
      expect(declaredAttachmentUrl("http://interno.local/cv.pdf")).toBeNull();
      expect(declaredAttachmentUrl("http://[::1]/cv.pdf")).toBeNull();
      expect(declaredAttachmentUrl("javascript:alert(1)")).toBeNull();
      expect(declaredAttachmentUrl("data:application/pdf;base64,AAAA")).toBeNull();
      expect(declaredAttachmentUrl("no es una direccion")).toBeNull();
      expect(declaredAttachmentUrl(null)).toBeNull();
    });
  }
);
