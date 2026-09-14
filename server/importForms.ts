import type { Pool } from "pg";
import * as XLSX from "xlsx";
import { isValidInternationalPhone, normalizePhone } from "./phone";

/**
 * Importación de formularios desde hoja de cálculo (Excel o CSV).
 *
 * Ontología: la primera fila no vacía define las preguntas (columnas) y la
 * columna de teléfono/WhatsApp es la única clave de identidad del candidato.
 * Cada fila es una postulación (respuestas) y se conserva en PostgreSQL con
 * deduplicación idempotente por (postulación, pregunta).
 *
 * Epistemología: solo se persiste lo presente en la hoja; una celda vacía no
 * es evidencia negativa. El número de WhatsApp no es un atributo de
 * rendimiento: es la fuente de relación autorizada para reconciliar al
 * candidato, nunca una variable de puntuación.
 */

export type ImportSpreadsheetResult = {
  formId: number;
  formVersion: number;
  questionCount: number;
  rowsImported: number;
  rowsSkippedNoPhone: number;
  candidatesCreated: number;
  candidatesExisting: number;
  applicationsCreated: number;
  applicationsUpdated: number;
  answersInserted: number;
  affectedApplicationIds: number[];
};

export type SpreadsheetGrid = {
  headers: string[];
  rows: string[][];
};

function cleanCell(value: unknown) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function readWorkbook(buffer: Buffer) {
  try {
    return XLSX.read(buffer, {
      type: "buffer",
      raw: false,
      codepage: 65001,
    });
  } catch {
    return XLSX.read(buffer.toString("utf8"), {
      type: "string",
      raw: false,
      codepage: 65001,
    });
  }
}

export function parseSpreadsheetGrid(buffer: Buffer): SpreadsheetGrid {
  const workbook = readWorkbook(buffer);
  const firstSheet = workbook.SheetNames[0];
  if (!firstSheet)
    throw new Error(
      "El archivo no contiene hojas. Verifique el Excel o CSV e intente de nuevo."
    );
  const sheet = workbook.Sheets[firstSheet];
  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: false,
    defval: "",
  });
  const cleaned = grid
    .map(row => (row ?? []).map(cleanCell))
    .filter(row => row.some(cell => cell.length > 0));
  if (cleaned.length < 2)
    throw new Error(
      "La hoja debe incluir una fila de encabezados y al menos una fila de respuestas."
    );
  const headers = cleaned[0].map(header =>
    header.replace(/^\uFEFF/, "").trim()
  );
  const rows = cleaned.slice(1);
  return { headers, rows };
}

function findHeaderIndex(headers: string[], pattern: RegExp) {
  return headers.findIndex(header => pattern.test(header));
}

export function derivePhoneColumn(headers: string[]) {
  return findHeaderIndex(
    headers,
    /tel[ée]fono|whatsapp|celular|m[oó]vil|phone|mobile/i
  );
}

export function deriveNameColumn(headers: string[]) {
  return findHeaderIndex(headers, /nombre|name/i);
}

function slugifyHeader(value: string) {
  const base = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
  return base || "pregunta";
}

function asJson(value: unknown) {
  return JSON.stringify(value ?? null);
}

export async function importSpreadsheetForm(
  pool: Pool,
  input: {
    positionId: number;
    fileName: string;
    buffer: Buffer;
    actorUserId: number;
  }
): Promise<ImportSpreadsheetResult> {
  const grid = parseSpreadsheetGrid(input.buffer);
  const phoneColumn = derivePhoneColumn(grid.headers);
  if (phoneColumn < 0)
    throw new Error(
      "La hoja debe incluir una columna de teléfono o WhatsApp (teléfono, celular, móvil o phone)."
    );
  const nameColumn = deriveNameColumn(grid.headers);
  const questionColumns = grid.headers
    .map((header, index) => ({ header, index }))
    .filter(
      ({ header, index }) =>
        header.length > 0 && index !== phoneColumn && index !== nameColumn
    );
  if (questionColumns.length === 0)
    throw new Error(
      "La hoja no define preguntas: se requieren columnas adicionales al teléfono."
    );

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const position = await client.query(
      `SELECT id FROM job_positions WHERE id=$1 LIMIT 1`,
      [input.positionId]
    );
    if (!position.rows[0])
      throw new Error("La plaza seleccionada no existe.");
    const versionRow = await client.query(
      `SELECT COALESCE(MAX(version),0)+1 AS version FROM application_forms WHERE job_position_id=$1`,
      [input.positionId]
    );
    const version = Number(versionRow.rows[0].version);
    const form = await client.query(
      `INSERT INTO application_forms
         (job_position_id,version,title,intro,published,source,import_meta,created_by_user_id)
       VALUES ($1,$2,$3,$4,false,'importado',$5::jsonb,$6)
       RETURNING id`,
      [
        input.positionId,
        version,
        `Formulario importado · ${input.fileName}`.slice(0, 240),
        "Formulario cargado desde hoja de cálculo con respuestas de candidatos.",
        asJson({
          fileName: input.fileName,
          columns: grid.headers.filter(Boolean).length,
          rows: grid.rows.length,
          questionColumns: questionColumns.length,
        }),
        input.actorUserId,
      ]
    );
    const formId = Number(form.rows[0].id);

    const questionIds: number[] = [];
    for (let index = 0; index < questionColumns.length; index++) {
      const { header } = questionColumns[index];
      const fieldKey = `${slugifyHeader(header)}_${index + 1}`.slice(0, 100);
      const question = await client.query(
        `INSERT INTO form_questions
           (form_id,field_key,label,type,required,order_index)
         VALUES ($1,$2,$3,'text',false,$4)
         RETURNING id`,
        [formId, fieldKey, header.slice(0, 2000), index]
      );
      questionIds.push(Number(question.rows[0].id));
    }

    let rowsImported = 0;
    let rowsSkippedNoPhone = 0;
    let candidatesCreated = 0;
    let candidatesExisting = 0;
    let applicationsCreated = 0;
    let applicationsUpdated = 0;
    let answersInserted = 0;
    const affectedApplicationIds: number[] = [];

    for (const row of grid.rows) {
      const rawPhone = (row[phoneColumn] ?? "").trim();
      if (!rawPhone || !isValidInternationalPhone(rawPhone, "GT")) {
        rowsSkippedNoPhone++;
        continue;
      }
      const phone = normalizePhone(rawPhone, "GT");
      const rawName = nameColumn >= 0 ? (row[nameColumn] ?? "").trim() : "";
      const fullName = rawName.slice(0, 240) || null;
      const existing = await client.query(
        `SELECT 1 FROM candidates WHERE phone_international=$1 LIMIT 1`,
        [phone.e164]
      );
      if (existing.rows[0]) candidatesExisting++;
      else candidatesCreated++;
      const candidate = await client.query(
        `INSERT INTO candidates (phone_international,phone_country,full_name)
         VALUES ($1,$2,$3)
         ON CONFLICT (phone_international) DO UPDATE
            SET full_name=COALESCE(candidates.full_name,EXCLUDED.full_name),
                updated_at=now()
         RETURNING id`,
        [phone.e164, phone.country, fullName]
      );
      const candidateId = Number(candidate.rows[0].id);

      let application = await client.query(
        `SELECT id FROM applications WHERE candidate_id=$1 AND job_position_id=$2 LIMIT 1`,
        [candidateId, input.positionId]
      );
      let applicationId: number;
      if (application.rows[0]) {
        applicationId = Number(application.rows[0].id);
      } else {
        const created = await client.query(
          `INSERT INTO applications (candidate_id,job_position_id,form_id,status)
           VALUES ($1,$2,$3,'en_revision') RETURNING id`,
          [candidateId, input.positionId, formId]
        );
        applicationId = Number(created.rows[0].id);
        applicationsCreated++;
        affectedApplicationIds.push(applicationId);
      }

      await client.query(
        `INSERT INTO application_form_submissions
           (application_id,form_id,source,created_by_user_id)
         VALUES ($1,$2,'importado',$3)
         ON CONFLICT (application_id,form_id) DO NOTHING`,
        [applicationId, formId, input.actorUserId]
      );

      let rowInserted = false;
      for (let index = 0; index < questionColumns.length; index++) {
        const value = (row[questionColumns[index].index] ?? "").trim();
        if (!value) continue;
        const inserted = await client.query(
          `INSERT INTO application_answers
             (application_id,question_id,value_json,normalized_value)
           VALUES ($1,$2,$3::jsonb,$4)
           ON CONFLICT (application_id,question_id) DO NOTHING
           RETURNING id`,
          [applicationId, questionIds[index], asJson(value), value]
        );
        if (inserted.rows[0]) {
          answersInserted++;
          rowInserted = true;
        }
      }
      if (rowInserted && application.rows[0]) {
        applicationsUpdated++;
        if (!affectedApplicationIds.includes(applicationId))
          affectedApplicationIds.push(applicationId);
      }
      rowsImported++;
    }

    await client.query(
      `INSERT INTO audit_log (actor_user_id,entity_type,entity_id,action,after_json)
       VALUES ($1,'application_form',$2,'form_imported',$3::jsonb)`,
      [
        input.actorUserId,
        formId,
        asJson({
          positionId: input.positionId,
          fileName: input.fileName,
          questions: questionColumns.length,
          rowsImported,
          rowsSkippedNoPhone,
          candidatesCreated,
          answersInserted,
        }),
      ]
    );
    await client.query("COMMIT");
    return {
      formId,
      formVersion: version,
      questionCount: questionColumns.length,
      rowsImported,
      rowsSkippedNoPhone,
      candidatesCreated,
      candidatesExisting,
      applicationsCreated,
      applicationsUpdated,
      answersInserted,
      affectedApplicationIds,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
