import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMediaTestDatabase } from "./testSupport/mediaDatabase";

/**
 * La clave local del asiento es inmutable.
 *
 * Fundamento
 * ----------
 * La solicitud de CV se enviaba dos veces al candidato. El asiento se crea con
 * `INSERT ... ON CONFLICT (message_key) DO NOTHING` y su clave local es
 * determinista —`cv_request:<postulación>`—, de modo que un segundo intento
 * encuentra el asiento en lugar de crear otro. Confirmar el envío sobrescribía
 * esa clave con el identificador del proveedor: a partir de ahí el `ON CONFLICT`
 * no podía encontrar nada, cada intento insertaba un asiento nuevo y el mensaje
 * salía de nuevo. El efecto era visible —dos mensajes idénticos— pero la causa
 * era invisible, porque la protección se desactivaba en silencio.
 *
 * La corrección alcanzó los tres caminos de envío. Esta prueba fija lo que la
 * hace estructural: el motor **rechaza** el `UPDATE` que cambiaría la clave, de
 * modo que ningún código futuro puede volver a degradar la idempotencia sin que
 * la operación falle con su causa.
 */

const enabled = Boolean(process.env.MEDIA_TEST_DATABASE_URL);

describe.runIf(enabled)(
  "Inmutabilidad de la clave local del asiento",
  () => {
    let database: Awaited<ReturnType<typeof createMediaTestDatabase>>;
    let conversationId: number;

    beforeAll(async () => {
      database = await createMediaTestDatabase();
      const pool = database.pool;
      const candidate = (
        await pool.query(
          `INSERT INTO candidates(phone_international,full_name) VALUES('+50255559077','Candidato de clave') RETURNING id`
        )
      ).rows[0].id;
      const position = (
        await pool.query(
          `INSERT INTO job_positions(public_slug,code,title,agent_key) VALUES('message-key-test','message-key-test','Auxiliar','test') RETURNING id`
        )
      ).rows[0].id;
      const form = (
        await pool.query(
          `INSERT INTO application_forms(job_position_id,title) VALUES($1,'Formulario') RETURNING id`,
          [position]
        )
      ).rows[0].id;
      const application = (
        await pool.query(
          `INSERT INTO applications(candidate_id,job_position_id,form_id) VALUES($1,$2,$3) RETURNING id`,
          [candidate, position, form]
        )
      ).rows[0].id;
      conversationId = (
        await pool.query(
          `INSERT INTO conversations(application_id,status) VALUES($1,'activo') RETURNING id`,
          [application]
        )
      ).rows[0].id;
    }, 120_000);

    afterAll(async () => {
      await database?.close();
    });

    it("rechaza la escritura que cambiaría la clave, con su causa", async () => {
      const inserted = await database.pool.query(
        `INSERT INTO conversation_messages
           (conversation_id,direction,message_type,body,message_key,delivery_status)
         VALUES($1,'outbound','text','Solicitud de CV','cv_request:77','pending')
         RETURNING id`,
        [conversationId]
      );
      const messageId = Number(inserted.rows[0].id);
      await expect(
        database.pool.query(
          `UPDATE conversation_messages SET message_key=$1 WHERE id=$2`,
          ["apichat-remote-key", messageId]
        )
      ).rejects.toMatchObject({ code: "23514" });
      // La clave sigue siendo la local.
      const current = await database.pool.query(
        `SELECT message_key FROM conversation_messages WHERE id=$1`,
        [messageId]
      );
      expect(current.rows[0].message_key).toBe("cv_request:77");
    }, 60_000);

    it("no estorba la confirmación del envío ni las escrituras legítimas", async () => {
      // El defecto original se producía **al confirmar el envío**: la columna
      // que debe escribirse es `provider_message_id`, y esa escritura —junto
      // con el estado, la marca de tiempo y los metadatos— sigue funcionando.
      const inserted = await database.pool.query(
        `INSERT INTO conversation_messages
           (conversation_id,direction,message_type,body,message_key,delivery_status)
         VALUES($1,'outbound','text','Solicitud de CV 2','cv_request:78','pending')
         RETURNING id`,
        [conversationId]
      );
      const messageId = Number(inserted.rows[0].id);
      await database.pool.query(
        `UPDATE conversation_messages
            SET delivery_status='sent',provider_message_id=$1,last_error=NULL,
                sent_at=now(),updated_at=now(),
                metadata=jsonb_build_object('provider','apichat','statusCode',200)
          WHERE id=$2`,
        ["remote-78", messageId]
      );
      const confirmed = await database.pool.query(
        `SELECT message_key,delivery_status,provider_message_id FROM conversation_messages WHERE id=$1`,
        [messageId]
      );
      expect(confirmed.rows[0]).toMatchObject({
        message_key: "cv_request:78",
        delivery_status: "sent",
        provider_message_id: "remote-78",
      });
    }, 60_000);

    it("el mismo envío no vuelve a crear un asiento aunque se confirme", async () => {
      // La secuencia exacta del defecto: crear, confirmar y volver a intentar.
      // Antes, la confirmación destruía la clave y el segundo intento insertaba
      // un asiento nuevo —el segundo mensaje que recibía el candidato—.
      const key = "cv_request:79";
      const create = () =>
        database.pool.query(
          `INSERT INTO conversation_messages
             (conversation_id,direction,message_type,body,message_key,delivery_status)
           VALUES($1,'outbound','text','Solicitud de CV 3',$2,'pending')
           ON CONFLICT (message_key) DO NOTHING
           RETURNING id`,
          [conversationId, key]
        );
      const first = await create();
      expect(first.rows).toHaveLength(1);
      await database.pool.query(
        `UPDATE conversation_messages
            SET delivery_status='sent',provider_message_id=$1,sent_at=now(),updated_at=now()
          WHERE id=$2`,
        ["remote-79", Number(first.rows[0].id)]
      );
      // El segundo intento no crea nada: encuentra el asiento por su clave.
      const second = await create();
      expect(second.rows).toHaveLength(0);
      const rows = await database.pool.query(
        `SELECT count(*)::int AS n FROM conversation_messages WHERE message_key=$1`,
        [key]
      );
      expect(rows.rows[0].n).toBe(1);
    }, 60_000);
  }
);
