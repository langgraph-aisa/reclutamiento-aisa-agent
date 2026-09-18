import type { Pool } from "pg";

/**
 * Registro de códecs y decodificadores del transporte.
 *
 * El artefacto no es un transporte propio: recibe lo que WhatsApp admite. Por
 * eso el catálogo separa **contenedor** (lo que el webhook declara) de
 * **códec** (lo que hay que decodificar de verdad), y declara para cada entrada
 * qué hace el artefacto con ella hoy. Esa última columna es la que impide
 * prometer una capacidad que no existe: `uso` distingue el conducto que ya
 * procesa del formato que solo se admite y se guarda.
 *
 * Los interruptores gobiernan **el mantenimiento declarado**, no una tubería
 * imaginaria: apagar una entrada cuyo conducto está en uso produce una
 * advertencia, porque el efecto sería una pérdida silenciosa de información
 * —exactamente la forma que este proyecto decidió no volver a tolerar—.
 */

export const CODEC_PROVIDER = "codecs";

export type CodecFamily = "audio" | "video" | "imagen" | "documentos";

/** Qué hace el artefacto con el formato. `sin-conducto` es una declaración honesta. */
export type CodecUse = "rag" | "transcripcion" | "visor" | "sin-conducto";

export type CodecEntry = {
  id: string;
  family: CodecFamily;
  /** Contenedor declarado por el webhook. */
  container: string;
  /** Códecs que pueden viajar dentro. */
  codec: string;
  /** Decodificador o analizador que lo abre. */
  decoder: string;
  /** Dependencia que debe existir en la imagen del servicio. */
  requirement: string;
  use: CodecUse;
  note: string;
};

export const CODEC_FAMILY_LABELS: Record<CodecFamily, string> = {
  audio: "Audio · compresión psicoacústica",
  video: "Video · compresión psicovisual",
  imagen: "Imagen · sin códec de señal",
  documentos: "Documentos · estructuras empaquetadas",
};

export const CODEC_USE_LABELS: Record<CodecUse, string> = {
  rag: "RAG del expediente",
  transcripcion: "Transcripción del agente",
  visor: "Visor universal",
  "sin-conducto": "Sin conducto todavía",
};

/**
 * Catálogo exhaustivo, agrupado por familia. Se declara completo a propósito:
 * una entrada ausente no se distingue de una entrada olvidada, y el objetivo es
 * que el operador vea **todo** lo que puede llegar por el webhook.
 */
export const CODEC_CATALOG: readonly CodecEntry[] = [
  {
    id: "audio-ogg-opus",
    family: "audio",
    container: ".ogg",
    codec: "Opus",
    decoder: "libopus",
    requirement: "ffmpeg",
    use: "transcripcion",
    note: "Nota de voz entrante, el caso más frecuente.",
  },
  {
    id: "audio-ogg-vorbis",
    family: "audio",
    container: ".ogg",
    codec: "Vorbis (heredado)",
    decoder: "libvorbis",
    requirement: "ffmpeg",
    use: "transcripcion",
    note: "Audio heredado de clientes antiguos.",
  },
  {
    id: "audio-m4a-aac",
    family: "audio",
    container: ".m4a · .aac",
    codec: "AAC-LC · AAC-HE · AAC-HEv2",
    decoder: "aac · libfdk_aac",
    requirement: "ffmpeg",
    use: "transcripcion",
    note: "Nota de voz enviada desde iOS.",
  },
  {
    id: "audio-mp4-aac",
    family: "audio",
    container: ".mp4",
    codec: "AAC (pista de audio)",
    decoder: "aac",
    requirement: "ffmpeg",
    use: "transcripcion",
    note: "Audio encapsulado en MP4 sin video útil.",
  },
  {
    id: "audio-amr",
    family: "audio",
    container: ".amr",
    codec: "AMR-NB · AMR-WB (G.722.2)",
    decoder: "libopencore_amrnb · libopencore_amrwb",
    requirement: "ffmpeg",
    use: "transcripcion",
    note: "Grabadora heredada de Android.",
  },
  {
    id: "audio-mp3",
    family: "audio",
    container: ".mp3 · .mpeg",
    codec: "MPEG-1 Layer III",
    decoder: "mp3",
    requirement: "ffmpeg",
    use: "transcripcion",
    note: "Audio enviado como archivo adjunto.",
  },
  {
    id: "audio-webm-opus",
    family: "audio",
    container: ".webm",
    codec: "Opus + VP8/VP9",
    decoder: "libopus",
    requirement: "ffmpeg",
    use: "transcripcion",
    note: "Nota de voz grabada desde WhatsApp Web.",
  },
  {
    id: "video-mp4-h264",
    family: "video",
    container: ".mp4",
    codec: "H.264/AVC (Baseline · Main · High)",
    decoder: "libx264",
    requirement: "ffmpeg",
    use: "sin-conducto",
    note: "Video estándar; se guarda y se reproduce en el visor.",
  },
  {
    id: "video-mp4-hevc",
    family: "video",
    container: ".mp4",
    codec: "H.265/HEVC",
    decoder: "hevc",
    requirement: "ffmpeg",
    use: "sin-conducto",
    note: "Video de iPhone moderno.",
  },
  {
    id: "video-mp4-mpeg4",
    family: "video",
    container: ".mp4",
    codec: "MPEG-4 Part 2",
    decoder: "mpeg4",
    requirement: "ffmpeg",
    use: "sin-conducto",
    note: "Video heredado.",
  },
  {
    id: "video-3gp",
    family: "video",
    container: ".3gp",
    codec: "H.263 · H.264 Baseline · MPEG-4 Part 2",
    decoder: "h263",
    requirement: "ffmpeg",
    use: "sin-conducto",
    note: "Video de terminales antiguos; audio AMR-NB.",
  },
  {
    id: "video-mov",
    family: "video",
    container: ".mov",
    codec: "H.264 · HEVC · ProRes",
    decoder: "libx264 · hevc",
    requirement: "ffmpeg",
    use: "sin-conducto",
    note: "Llega como documento cuando supera los límites del canal.",
  },
  {
    id: "imagen-jpeg",
    family: "imagen",
    container: ".jpg · .jpeg",
    codec: "Baseline DCT · Progressive DCT · EXIF",
    decoder: "sharp · libjpeg-turbo",
    requirement: "sharp",
    use: "visor",
    note: "Compresión con pérdida, sin estado.",
  },
  {
    id: "imagen-png",
    family: "imagen",
    container: ".png",
    codec: "DEFLATE (LZ77 + Huffman)",
    decoder: "sharp · libpng",
    requirement: "sharp",
    use: "visor",
    note: "Sin pérdida, con transparencia alfa.",
  },
  {
    id: "imagen-webp",
    family: "imagen",
    container: ".webp",
    codec: "VP8 · VP8L · VP8-EXIF alpha",
    decoder: "libwebp",
    requirement: "sharp",
    use: "visor",
    note: "Stickers y capturas de WhatsApp Web.",
  },
  {
    id: "doc-pdf",
    family: "documentos",
    container: ".pdf",
    codec:
      "FlateDecode · LZW · CCITT Fax · DCTDecode · JPXDecode · JBIG2",
    decoder: "poppler-utils",
    requirement: "poppler-utils",
    use: "rag",
    note: "CV y documentos escaneados; alimenta el expediente.",
  },
  {
    id: "doc-docx",
    family: "documentos",
    container: ".docx",
    codec: "ZIP (DEFLATE) + XML",
    decoder: "mammoth",
    requirement: "mammoth",
    use: "rag",
    note: "CV en Word moderno.",
  },
  {
    id: "doc-doc",
    family: "documentos",
    container: ".doc",
    codec: "OLE compuesto",
    decoder: "antiword · libreoffice",
    requirement: "antiword",
    use: "visor",
    note: "Word heredado: sin vista previa integrada, se ofrece en descarga.",
  },
  {
    id: "doc-xlsx",
    family: "documentos",
    container: ".xlsx",
    codec: "ZIP + XML de celdas",
    decoder: "xlsx",
    requirement: "xlsx",
    use: "rag",
    note: "Hojas de cálculo del candidato.",
  },
  {
    id: "doc-xls",
    family: "documentos",
    container: ".xls",
    codec: "OLE compuesto (BIFF)",
    decoder: "xlsx",
    requirement: "xlsx",
    use: "rag",
    note: "Excel heredado; comparte firma OLE con .doc.",
  },
  {
    id: "doc-pptx",
    family: "documentos",
    container: ".pptx",
    codec: "ZIP + XML de diapositivas",
    decoder: "pptx2json",
    requirement: "pptx2json",
    use: "sin-conducto",
    note: "Presentaciones; se admiten y se guardan.",
  },
  {
    id: "doc-txt",
    family: "documentos",
    container: ".txt",
    codec: "Plano: UTF-8 · UTF-16 · Latin-1",
    decoder: "Streams nativos",
    requirement: "—",
    use: "rag",
    note: "Sin firma propia: la detección recurre a la extensión.",
  },
  {
    id: "doc-csv",
    family: "documentos",
    container: ".csv",
    codec: "Plano delimitado",
    decoder: "Streams nativos",
    requirement: "—",
    use: "rag",
    note: "Sin firma propia: la detección recurre a la extensión.",
  },
  {
    id: "doc-odt",
    family: "documentos",
    container: ".odt",
    codec: "ZIP + XML ODF",
    decoder: "odfpy",
    requirement: "odfpy",
    use: "sin-conducto",
    note: "OpenDocument de texto.",
  },
  {
    id: "doc-ods",
    family: "documentos",
    container: ".ods",
    codec: "ZIP + XML ODF",
    decoder: "odfpy",
    requirement: "odfpy",
    use: "sin-conducto",
    note: "OpenDocument de hoja de cálculo.",
  },
] as const;

export const CODEC_FAMILY_ORDER: readonly CodecFamily[] = [
  "audio",
  "video",
  "imagen",
  "documentos",
];

export function codecSettingKey(id: string) {
  return `codec_enabled:${id}`;
}

/** Detalle de una entrada con su estado declarado. */
export type CodecState = CodecEntry & { enabled: boolean };

export type CodecFamilySummary = {
  family: CodecFamily;
  label: string;
  total: number;
  enabled: number;
  /** Entradas apagadas que tienen conducto en uso: apagarlas pierde información. */
  breaking: string[];
};

/**
 * Resumen por familia. `breaking` es lo que evita una colisión silenciosa: una
 * entrada apagada **con conducto en uso** no es mantenimiento, es una pérdida.
 */
export function codecFamilySummary(
  enabled: Record<string, boolean>
): CodecFamilySummary[] {
  return CODEC_FAMILY_ORDER.map(family => {
    const entries = CODEC_CATALOG.filter(entry => entry.family === family);
    const off = entries.filter(entry => !enabled[entry.id]);
    return {
      family,
      label: CODEC_FAMILY_LABELS[family],
      total: entries.length,
      enabled: entries.length - off.length,
      breaking: off
        .filter(entry => entry.use !== "sin-conducto")
        .map(entry => entry.id),
    };
  });
}

/** Verdadero cuando **todas** las entradas del catálogo están encendidas. */
export function codecCatalogComplete(enabled: Record<string, boolean>) {
  return CODEC_CATALOG.every(entry => enabled[entry.id]);
}

/**
 * Advertencias del registro. Habla solo cuando apagar una entrada afecta un
 * conducto en uso, y nombra la consecuencia concreta en lugar de enumerar
 * identificadores.
 */
export function codecAdvisories(enabled: Record<string, boolean>): string[] {
  const advisories: string[] = [];
  for (const summary of codecFamilySummary(enabled)) {
    if (!summary.breaking.length) continue;
    const names = summary.breaking
      .map(id => CODEC_CATALOG.find(entry => entry.id === id))
      .filter((entry): entry is CodecEntry => Boolean(entry))
      .map(entry => `${entry.container} (${entry.codec})`);
    advisories.push(
      `La familia ${CODEC_FAMILY_LABELS[summary.family]} tiene ${names.length} formato(s) apagado(s) con conducto en uso: ${names.join(", ")}. Mientras permanezcan apagados, ese contenido no podrá procesarse y la pérdida no producirá error.`
    );
  }
  return advisories;
}

/**
 * Traduce el estado guardado a un mapa por entrada. Ausente equivale a
 * **encendido**: el catálogo se entrega activado y una entrada sin fila es una
 * entrada que la migración aún no sembró, no una decisión del operador.
 */
export function codecStatesFromRows(
  rows: ReadonlyArray<{ setting_key: string; setting_value: string }>
): Record<string, boolean> {
  const states: Record<string, boolean> = {};
  for (const entry of CODEC_CATALOG) {
    const row = rows.find(
      candidate => candidate.setting_key === codecSettingKey(entry.id)
    );
    states[entry.id] =
      row === undefined ? true : row.setting_value.trim() !== "false";
  }
  return states;
}

export function codecCatalogWithStates(enabled: Record<string, boolean>) {
  return CODEC_CATALOG.map(entry => ({
    ...entry,
    useLabel: CODEC_USE_LABELS[entry.use],
    enabled: enabled[entry.id] ?? true,
  }));
}

type Queryable = Pick<Pool, "query">;

/**
 * Estado declarado de cada entrada. Una entrada sin fila se declara encendida:
 * el catálogo nace activado y la ausencia de fila significa que la migración
 * aún no sembró esa clave, no que alguien la haya apagado.
 */
export async function getCodecSettings(
  pool: Queryable | null
): Promise<Record<string, boolean>> {
  if (!pool) return codecStatesFromRows([]);
  const result = await pool.query<{
    setting_key: string;
    setting_value: string;
  }>(
    `SELECT setting_key,setting_value FROM integration_settings
      WHERE provider=$1`,
    [CODEC_PROVIDER]
  );
  return codecStatesFromRows(result.rows);
}

/**
 * Guarda el estado declarado. Escribe una fila por entrada —de modo que el
 * catálogo y la configuración no puedan desincronizarse— y asienta la decisión
 * con el identificador convencional de los ajustes y el detalle en el cuerpo,
 * que es la forma que el proyecto usa para no romper el tipo del asiento.
 */
export async function saveCodecSettings(
  pool: Pool,
  input: { enabled: Record<string, boolean>; actorUserId: number | null }
): Promise<Record<string, boolean>> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const entry of CODEC_CATALOG) {
      const value = input.enabled[entry.id] === false ? "false" : "true";
      await client.query(
        `INSERT INTO integration_settings (provider,setting_key,setting_value,is_secret,updated_at)
         VALUES ($1,$2,$3,false,now())
         ON CONFLICT (provider,setting_key)
         DO UPDATE SET setting_value=EXCLUDED.setting_value,updated_at=now()`,
        [CODEC_PROVIDER, codecSettingKey(entry.id), value]
      );
    }
    const enabled = codecStatesFromRows(
      CODEC_CATALOG.map(entry => ({
        setting_key: codecSettingKey(entry.id),
        setting_value: input.enabled[entry.id] === false ? "false" : "true",
      }))
    );
    await client.query(
      `INSERT INTO audit_log (actor_user_id,entity_type,entity_id,action,after_json)
       VALUES ($1,'integration_setting',0,'codec_registry_updated',$2::jsonb)`,
      [
        input.actorUserId,
        JSON.stringify({
          provider: CODEC_PROVIDER,
          disabled: CODEC_CATALOG.filter(entry => !enabled[entry.id]).map(
            entry => entry.id
          ),
        }),
      ]
    );
    await client.query("COMMIT");
    return enabled;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** Carga útil completa del registro, tal como la consume la interfaz. */
export async function codecRegistry(pool: Queryable | null) {
  const enabled = await getCodecSettings(pool);
  return {
    provider: CODEC_PROVIDER,
    complete: codecCatalogComplete(enabled),
    families: codecFamilySummary(enabled),
    entries: codecCatalogWithStates(enabled),
    advisories: codecAdvisories(enabled),
  };
}
