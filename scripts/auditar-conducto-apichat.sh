#!/usr/bin/env bash
#
# Auditoría sistemática del conducto de archivos de ApiChat.
#
# Responde una sola pregunta con evidencia: **¿en qué eslabón se pierde el
# archivo del candidato?** El receptor declara ocho salidas distintas y solo dos
# dejan rastro, de modo que sin este instrumento el diagnóstico se convierte en
# conjetura. El script extrae lo que la base ya registra, interroga al proveedor
# y —sobre todo— somete al receptor a una **tabla de formas de carga útil** para
# descubrir cuál acepta y cuál descarta en silencio.
#
# Uso:
#   bash scripts/auditar-conducto-apichat.sh [opciones]
#
# Opciones:
#   --horas N           Ventana de la consulta, en horas (por omisión 72).
#   --base URL          Base pública del servicio. Si se omite, se deduce.
#   --db-url URL        Cadena de conexión. Si se omite, usa DATABASE_URL.
#   --contenedor NAME   Contenedor del que se extraen los logs del receptor.
#   --log-lineas N      Líneas de log a revisar (por omisión 4000).
#   --telefono DIGITS   Habilita la prueba de adjunto real sobre esa conversación.
#                       ATENCIÓN: escribe un mensaje entrante de prueba.
#   --salida DIR        Directorio del informe (por omisión ./auditoria-apichat).
#   --sin-http          Omite las pruebas HTTP contra el servicio público.
#
# El script es de SOLO LECTURA salvo que se pase --telefono, que es explícito y
# avisa antes de escribir. Ninguna credencial se imprime: se enmascara.

set -uo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT" || exit 1

VENTANA_HORAS=72
BASE_PUBLICA="${APICHAT_PUBLIC_BASE_URL:-}"
DB_URL="${DATABASE_URL:-}"
CONTENEDOR=""
LOG_LINEAS=4000
TELEFONO=""
SALIDA=""
SIN_HTTP=0
TELEFONO_SONDA="50200000099"

while [ $# -gt 0 ]; do
  case "$1" in
    --horas) VENTANA_HORAS="${2:-72}"; shift 2 ;;
    --base) BASE_PUBLICA="${2:-}"; shift 2 ;;
    --db-url) DB_URL="${2:-}"; shift 2 ;;
    --contenedor) CONTENEDOR="${2:-}"; shift 2 ;;
    --log-lineas) LOG_LINEAS="${2:-4000}"; shift 2 ;;
    --telefono) TELEFONO="${2:-}"; shift 2 ;;
    --salida) SALIDA="${2:-}"; shift 2 ;;
    --sin-http) SIN_HTTP=1; shift ;;
    -h|--help) sed -n '2,32p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Opción no reconocida: $1" >&2; exit 2 ;;
  esac
done

SALIDA="${SALIDA:-$PROJECT_ROOT/auditoria-apichat}"
mkdir -p "$SALIDA" || exit 1
INFORME="$SALIDA/informe-$(date +%Y%m%d-%H%M%S).txt"
SQL_ARCHIVO="$SALIDA/consultas.sql"

# Las marcas del informe se acumulan para el veredicto final.
declare -a HALLAZGOS=()

registrar() { HALLAZGOS+=("$1"); }

seccion() {
  printf '\n%s\n%s\n' "════════════════════════════════════════════════════════════════════" "$1" | tee -a "$INFORME"
}

nota() { printf '  %s\n' "$1" | tee -a "$INFORME"; }
dato() { printf '    %s\n' "$1" | tee -a "$INFORME"; }

# ─────────────────────────────────────────────────────────────────────────────
# 0. Contexto
# ─────────────────────────────────────────────────────────────────────────────
{
  echo "Auditoría del conducto de archivos de ApiChat"
  echo "Ejecutada: $(date '+%Y-%m-%d %H:%M:%S %Z')"
  echo "Ventana:   $VENTANA_HORAS horas"
  echo "Raíz:      $PROJECT_ROOT"
} | tee -a "$INFORME"

seccion "0. HERRAMIENTAS DISPONIBLES"
for herramienta in curl jq node docker psql; do
  if command -v "$herramienta" >/dev/null 2>&1; then
    dato "disponible: $herramienta"
  else
    dato "AUSENTE:    $herramienta"
  fi
done

# ─────────────────────────────────────────────────────────────────────────────
# 1. Base de datos
# ─────────────────────────────────────────────────────────────────────────────
# Se resuelve una sola vez si la base responde, porque todas las secciones
# siguientes dependen de ella. Se prefiere `node` con el cliente `pg` del propio
# proyecto: es el único camino que funciona dentro del contenedor del artefacto,
# donde DATABASE_URL existe y psql no está instalado.
CONSULTA_DISPONIBLE=0
if [ -n "$DB_URL" ] && command -v node >/dev/null 2>&1 && [ -d "$PROJECT_ROOT/node_modules/pg" ]; then
  CONSULTA_DISPONIBLE=1
fi

consulta() {
  # consulta "<etiqueta>" "<sql>"
  local etiqueta="$1" sql="$2"
  [ "$CONSULTA_DISPONIBLE" = "1" ] || return 1
  DATABASE_URL="$DB_URL" node -e '
    const { Client } = require("pg");
    const sql = process.argv[1];
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    client.connect()
      .then(() => client.query(sql))
      .then(result => {
        if (!result.rows.length) { console.log("(sin filas)"); return; }
        const columnas = Object.keys(result.rows[0]);
        console.log(columnas.join(" | "));
        for (const fila of result.rows) {
          console.log(columnas.map(c => {
            const v = fila[c];
            return v === null || v === undefined ? "—" : String(v).replace(/\s+/g, " ");
          }).join(" | "));
        }
        console.log(`\n(${result.rows.length} fila(s))`);
      })
      .catch(error => { console.log(`ERROR DE CONSULTA: ${error.message}`); process.exitCode = 3; })
      .finally(() => client.end().catch(() => {}));
  ' "$sql" 2>&1
}

# Las consultas quedan escritas para poder pegarlas en DBeaver sin ejecutar el
# script: la auditoría debe ser reproducible fuera de este entorno.
cat > "$SQL_ARCHIVO" <<'SQL'
-- Auditoría del conducto de archivos de ApiChat. Solo lectura.
-- 1) ¿Llegó alguna vez un adjunto?
SELECT message_type, count(*) AS total, max(created_at) AS ultimo
  FROM conversation_messages
 WHERE direction='inbound' AND message_type <> 'text'
 GROUP BY 1 ORDER BY 2 DESC;

-- 2) Pérdidas de recepción declaradas por el receptor, por causa.
SELECT after_json->>'cause' AS causa, count(*) AS total, max(created_at) AS ultima
  FROM audit_log
 WHERE entity_type='apichat_webhook' AND action='apichat_webhook_loss'
 GROUP BY 1 ORDER BY 2 DESC;

-- 3) Fallos de entrega saliente con el detalle que devolvió el proveedor.
SELECT id, message_type, original_file_name, attempt_count, delivery_status,
       left(last_error, 200) AS detalle, created_at
  FROM conversation_messages
 WHERE direction='outbound' AND delivery_status IN ('failed','unknown')
 ORDER BY created_at DESC LIMIT 40;

-- 4) Fallos de salida que ocurrieron ANTES de existir una fila de mensaje.
SELECT created_at, after_json->>'stage' AS etapa,
       left(after_json->>'reason', 180) AS motivo,
       after_json->>'messageType' AS tipo,
       after_json->>'conversationId' AS conversacion
  FROM audit_log
 WHERE entity_type='apichat_send' AND action='apichat_send_failure'
 ORDER BY created_at DESC LIMIT 40;

-- 5) Todo el tráfico del webhook, por acción, sin importar el resultado.
SELECT entity_type, action, count(*) AS total, max(created_at) AS ultimo
  FROM audit_log
 WHERE entity_type IN ('apichat_webhook','apichat_send')
 GROUP BY 1,2 ORDER BY 4 DESC;

-- 6) Eventos de recepción: ¿el puente o el webhook movieron algo?
SELECT event_type, source, status, count(*) AS total, max(created_at) AS ultimo
  FROM conversation_events GROUP BY 1,2,3 ORDER BY 5 DESC;

-- 7) Cola de salida: lo que no avanzó.
SELECT delivery_status, count(*) AS total, min(updated_at) AS mas_antiguo
  FROM conversation_outbox GROUP BY 1 ORDER BY 2 DESC;

-- 8) ¿Qué plantillas con archivo se intentaron enviar?
SELECT id, message_type, original_file_name, delivery_status,
       left(last_error, 160) AS detalle, created_at
  FROM conversation_messages
 WHERE direction='outbound' AND message_type IN ('file','audio','ptt','image','document')
 ORDER BY created_at DESC LIMIT 40;
SQL

seccion "1. EVIDENCIA REGISTRADA EN LA BASE"
if [ "$CONSULTA_DISPONIBLE" != "1" ]; then
  nota "Sin cadena de conexión utilizable (DATABASE_URL o --db-url)."
  nota "Las consultas quedaron escritas en: $SQL_ARCHIVO"
  nota "Péguelas en DBeaver y vuelva a ejecutar con --db-url."
else
  nota "Consulta 1 · ¿Llegó alguna vez un adjunto?"
  consulta "adjuntos" "SELECT message_type, count(*)::text AS total, max(created_at)::text AS ultimo
     FROM conversation_messages WHERE direction='inbound' AND message_type <> 'text'
     GROUP BY 1 ORDER BY 2 DESC" | tee -a "$INFORME"

  nota "Consulta 2 · Pérdidas de recepción declaradas, por causa"
  consulta "pérdidas" "SELECT coalesce(after_json->>'cause','sin causa') AS causa, count(*)::text AS total,
            max(created_at)::text AS ultima FROM audit_log
      WHERE entity_type='apichat_webhook' AND action='apichat_webhook_loss'
      GROUP BY 1 ORDER BY 2 DESC" | tee -a "$INFORME"

  nota "Consulta 3 · Fallos de entrega saliente y lo que dijo el proveedor"
  consulta "fallos" "SELECT id::text, message_type, coalesce(original_file_name,'—') AS archivo,
            attempt_count::text AS intentos, delivery_status,
            left(coalesce(last_error,'—'),180) AS detalle, created_at::text
       FROM conversation_messages
      WHERE direction='outbound' AND delivery_status IN ('failed','unknown')
      ORDER BY created_at DESC LIMIT 20" | tee -a "$INFORME"

  nota "Consulta 4 · Fallos de salida sin fila de mensaje (etapa y motivo)"
  consulta "etapas" "SELECT created_at::text, after_json->>'stage' AS etapa,
            left(coalesce(after_json->>'reason','—'),160) AS motivo,
            coalesce(after_json->>'messageType','—') AS tipo
       FROM audit_log WHERE entity_type='apichat_send' AND action='apichat_send_failure'
       ORDER BY created_at DESC LIMIT 20" | tee -a "$INFORME"

  nota "Consulta 5 · Todo el tráfico del webhook, por acción"
  consulta "tráfico" "SELECT entity_type, action, count(*)::text AS total, max(created_at)::text AS ultimo
       FROM audit_log WHERE entity_type IN ('apichat_webhook','apichat_send')
       GROUP BY 1,2 ORDER BY 4 DESC" | tee -a "$INFORME"

  adjuntos_recibidos="$(consulta "n" "SELECT count(*)::text AS total FROM conversation_messages
     WHERE direction='inbound' AND message_type <> 'text'" | sed -n '2p' | tr -dc '0-9')"
  adjuntos_recibidos="${adjuntos_recibidos:-0}"
  if [ "$adjuntos_recibidos" = "0" ]; then
    registrar "La base NO tiene ningún adjunto entrante en toda su historia. El archivo del candidato nunca se registró."
    dato ">> Ningún adjunto entrante registrado en toda la historia de la base."
  else
    dato ">> Adjuntos entrantes registrados: $adjuntos_recibidos"
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# 2. Endpoint público: ¿el proveedor puede alcanzarnos?
# ─────────────────────────────────────────────────────────────────────────────
seccion "2. ALCANCE PÚBLICO DEL RECEPTOR"
if [ -z "$BASE_PUBLICA" ] && [ -n "${APICHAT_WEBHOOK_URL:-}" ]; then
  BASE_PUBLICA="${APICHAT_WEBHOOK_URL%%/api/apichat/webhook*}"
fi
if [ -n "$BASE_PUBLICA" ]; then
  nota "Base declarada: $BASE_PUBLICA"
  # La ruta del receptor solo admite POST. Un GET cae en el comodín del cliente
  # y devuelve la página del panel: eso NO es un fallo del proxy, es la conducta
  # esperada. La alcance se comprueba con una petición POST real, porque es la
  # única que atraviesa el mismo camino que usará el proveedor.
  codigo_get="$(curl -s -o "$SALIDA/webhook-get.txt" -w '%{http_code}' --max-time 20 "$BASE_PUBLICA/api/apichat/webhook" 2>/dev/null)"
  dato "GET  /api/apichat/webhook → HTTP $codigo_get (esperado: 200 con la página del panel)"

  cuerpo="$(curl -s -o "$SALIDA/webhook-post.txt" -w '%{http_code}' --max-time 25 \
    -H 'Content-Type: application/json' -X POST \
    -d "{\"id\":\"sonda-alcance\",\"number\":\"$TELEFONO_SONDA\",\"type\":\"text\",\"text\":\"sonda\"}" \
    "$BASE_PUBLICA/api/apichat/webhook" 2>/dev/null)"
  respuesta="$(head -c 200 "$SALIDA/webhook-post.txt")"
  dato "POST /api/apichat/webhook → HTTP $cuerpo · $respuesta"
  if [ "$cuerpo" = "000" ]; then
    registrar "El servicio público no responde al POST: el proveedor no puede entregar nada."
  elif grep -qi '<html' "$SALIDA/webhook-post.txt"; then
    registrar "El POST devuelve HTML: el proxy no envía la ruta al artefacto y responde la página del panel."
  elif [ "$cuerpo" != "200" ]; then
    registrar "El receptor responde HTTP $cuerpo en lugar de 200: el proveedor marcará la entrega como fallida."
  elif printf '%s' "$respuesta" | grep -q '"ok":true'; then
    dato ">> El receptor es alcanzable desde Internet y responde el veredicto del artefacto."
  else
    registrar "El POST no devuelve el veredicto esperado del receptor: $respuesta"
  fi
else
  nota "Sin base pública declarada: pase --base https://<host> para comprobarla."
  nota "Sugerencia: tome el valor del panel de ApiChat (campo Webhook)."
fi

# ─────────────────────────────────────────────────────────────────────────────
# 3. Tabla de formas: qué carga útil acepta el receptor
# ─────────────────────────────────────────────────────────────────────────────
# Este es el experimento decisivo y no escribe nada: se usa un teléfono que no
# corresponde a ninguna conversación, de modo que toda carga útil bien formada
# termina en 'sin-conversacion' (la forma se reconoció) y toda carga útil mal
# formada termina en 'forma-no-reconocida' (el receptor la descarta). La
# diferencia entre ambas respuestas revela el punto exacto del descarte sin
# tocar la bandeja de nadie.
seccion "3. TABLA DE FORMAS DE CARGA ÚTIL ACEPTADAS POR EL RECEPTOR"
if [ "$SIN_HTTP" = "1" ] || [ -z "$BASE_PUBLICA" ]; then
  nota "Omitida (--sin-http o sin base pública)."
else
  # Guardia: el teléfono de sondeo no puede pertenecer a un candidato real, o la
  # prueba escribiría un mensaje en una conversación verdadera.
  ocupa="0"
  if [ "$CONSULTA_DISPONIBLE" = "1" ]; then
    ocupa="$(consulta "n" "SELECT count(*)::text AS total FROM candidates
       WHERE regexp_replace(phone_international,'\\D','','g') LIKE '%${TELEFONO_SONDA}'" | sed -n '2p' | tr -dc '0-9')"
    ocupa="${ocupa:-0}"
  fi
  if [ "$ocupa" != "0" ]; then
    registrar "El teléfono de sondeo $TELEFONO_SONDA pertenece a un candidato real: la prueba de formas se omite para no escribir datos."
    nota "Teléfono de sondeo ocupado: prueba omitida."
  else
    nota "Teléfono de sondeo: $TELEFONO_SONDA (sin conversación: toda forma aceptada responde 'sin-conversacion')."

    sonda() {
      # sonda "<nombre>" "<json>"
      local nombre="$1" json="$2"
      local respuesta
      respuesta="$(curl -s --max-time 25 -H 'Content-Type: application/json' \
        -X POST -d "$json" "$BASE_PUBLICA/api/apichat/webhook" 2>/dev/null)"
      local desenlace
      desenlace="$(printf '%s' "$respuesta" | jq -r '.skipped // (.registered|tostring) // "sin diagnóstico"' 2>/dev/null)"
      printf '    %-34s → %s\n' "$nombre" "$desenlace" | tee -a "$INFORME"
      case "$desenlace" in
        sin-conversacion) : ;;
        forma-no-reconocida)
          registrar "Forma RECHAZADA por el receptor: $nombre. Si el proveedor usa esta forma, ninguna recepción se registra ni deja rastro." ;;
        *) : ;;
      esac
    }

    sonda "directa · texto" \
      "{\"id\":\"son-1\",\"number\":\"$TELEFONO_SONDA\",\"type\":\"text\",\"text\":\"sonda\"}"
    sonda "directa · documento + url base64" \
      "{\"id\":\"son-2\",\"number\":\"$TELEFONO_SONDA\",\"type\":\"document\",\"filename\":\"s.pdf\",\"url\":\"$(printf 'JVBERi0xLjQK' | head -c 8)$(printf 'A%.0s' $(seq 1 80))\"}"
    sonda "directa · imagen + campo base64" \
      "{\"id\":\"son-3\",\"number\":\"$TELEFONO_SONDA\",\"type\":\"image\",\"base64\":\"$(printf 'A%.0s' $(seq 1 96))\"}"
    sonda "jsonrpc · params objeto" \
      "{\"method\":\"message\",\"params\":{\"id\":\"son-4\",\"number\":\"$TELEFONO_SONDA\",\"type\":\"text\",\"text\":\"sonda\"}}"
    sonda "jsonrpc · params cadena" \
      "{\"method\":\"message\",\"params\":\"{\\\"id\\\":\\\"son-5\\\",\\\"number\\\":\\\"$TELEFONO_SONDA\\\",\\\"type\\\":\\\"text\\\",\\\"text\\\":\\\"sonda\\\"}\"}"
    sonda "envoltura · data{}" \
      "{\"data\":{\"id\":\"son-6\",\"number\":\"$TELEFONO_SONDA\",\"type\":\"text\",\"text\":\"sonda\"}}"
    sonda "envoltura · message{}" \
      "{\"message\":{\"id\":\"son-7\",\"number\":\"$TELEFONO_SONDA\",\"type\":\"text\",\"text\":\"sonda\"}}"
    sonda "lista · messages[]" \
      "{\"messages\":[{\"id\":\"son-8\",\"number\":\"$TELEFONO_SONDA\",\"type\":\"text\",\"text\":\"sonda\"}]}"
    sonda "sin identificador" \
      "{\"number\":\"$TELEFONO_SONDA\",\"type\":\"text\",\"text\":\"sonda\"}"
    sonda "sin teléfono" \
      "{\"id\":\"son-9\",\"type\":\"text\",\"text\":\"sonda\"}"
    sonda "tipo desconocido · media" \
      "{\"id\":\"son-10\",\"number\":\"$TELEFONO_SONDA\",\"type\":\"media\",\"url\":\"https://example.org/a.pdf\"}"

    nota "Lectura: 'sin-conversacion' significa que el receptor RECONOCIÓ la forma."
    nota "Cualquier 'forma-no-reconocida' es una forma que el proveedor podría estar usando y que se descarta en silencio."
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# 4. Prueba de adjunto real (escribe: solo con --telefono)
# ─────────────────────────────────────────────────────────────────────────────
seccion "4. PRUEBA DE ADJUNTO REAL SOBRE UNA CONVERSACIÓN"
if [ -z "$TELEFONO" ] || [ -z "$BASE_PUBLICA" ]; then
  nota "Omitida. Para ejecutarla, pase --telefono <digits> con el teléfono del candidato."
  nota "ATENCIÓN: esa prueba escribe un mensaje entrante de prueba en su bandeja."
  nota "La limpieza posterior se imprime al final del informe."
else
  nota "Teléfono: $TELEFONO · esta prueba SÍ escribe un mensaje entrante."
  png_minimo="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/wD/pQ0AAAAASUVORK5CYII="
  respuesta="$(curl -s --max-time 30 -H 'Content-Type: application/json' -X POST \
    -d "{\"id\":\"sonda-adjunto-$(date +%s)\",\"number\":\"$TELEFONO\",\"type\":\"image\",\"filename\":\"sonda.png\",\"mime_type\":\"image/png\",\"base64\":\"$png_minimo\"}" \
    "$BASE_PUBLICA/api/apichat/webhook" 2>/dev/null)"
  dato "Respuesta: $(printf '%s' "$respuesta" | head -c 300)"
  desenlace="$(printf '%s' "$respuesta" | jq -r '.skipped // (.registered|tostring) // "sin diagnóstico"' 2>/dev/null)"
  case "$desenlace" in
    true) registrar "El receptor SÍ registra un adjunto base64 cuando la carga útil trae el campo 'base64': el fallo está en el proveedor, no en el receptor." ;;
    archivo-sin-contenido) registrar "El receptor recibe el adjunto pero NO resuelve su contenido: falta el campo de contenido o el transporte no lo trae." ;;
    archivo-ilegible) registrar "El receptor recibe contenido pero no puede decodificarlo: transporte o nombre de archivo incoherentes." ;;
    sin-conversacion) registrar "No hay conversación apichat activa para ese teléfono: la recepción no tiene destino." ;;
    tipo-sin-pipeline) registrar "El tipo declarado no tiene tubería declarada: el mensaje se descarta SIN dejar rastro." ;;
    forma-no-reconocida) registrar "La carga útil de prueba no fue reconocida por el receptor." ;;
    *) dato "Desenlace no clasificado: $desenlace" ;;
  esac
fi

# ─────────────────────────────────────────────────────────────────────────────
# 5. Proveedor: estado del canal y del webhook
# ─────────────────────────────────────────────────────────────────────────────
seccion "5. ESTADO DECLARADO POR EL PROVEEDOR"
nota "Compruebe en el panel de ApiChat, cuenta del servicio:"
dato "· Webhook apuntando a $BASE_PUBLICA/api/apichat/webhook (sin barra final, https)"
dato "· Interruptor «Notify attachments in base64 format» encendido"
dato "· Campo «Notify Format» VACÍO: si está vacío el proveedor elige la forma por su cuenta"
dato "· Interruptor «Notify from me messages»: si está encendido, nuestros propios envíos vuelven como entrantes"
dato "· Estado de conexión del teléfono: «Your phone is connected»"
nota "Si el panel ofrece historial de entregas del webhook, busque el código que devolvió el servicio."
nota "El receptor responde SIEMPRE 200: un 4xx/5xx en el panel del proveedor significa que la petición no llegó a nuestro código."

# ─────────────────────────────────────────────────────────────────────────────
# 6. Logs del contenedor
# ─────────────────────────────────────────────────────────────────────────────
seccion "6. LOGS DEL RECEPTOR"
if [ -z "$CONTENEDOR" ]; then
  if command -v docker >/dev/null 2>&1; then
    nota "Contenedores visibles:"
    docker ps --format '    {{.Names}}  ({{.Image}})' 2>&1 | tee -a "$INFORME"
    nota "Repita con --contenedor <nombre> para extraer y filtrar sus logs."
  else
    nota "Sin docker disponible."
  fi
else
  if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$CONTENEDOR"; then
    nota "El contenedor $CONTENEDOR no está en ejecución."
  else
    docker logs --tail "$LOG_LINEAS" "$CONTENEDOR" > "$SALIDA/logs-crudos.txt" 2>&1
    dato "Líneas recuperadas: $(wc -l < "$SALIDA/logs-crudos.txt")"

    # Filtro selectivo: solo las familias de traza que el conducto produce.
    grep -Ei 'apichat|webhook|inbox|adjunto|base64|attachment|conversation|outbox|sendFile|sendPTT|404|400|413|500|ECONN|timeout|PayloadTooLarge' \
      "$SALIDA/logs-crudos.txt" > "$SALIDA/logs-conducto.txt" 2>/dev/null
    dato "Líneas del conducto: $(wc -l < "$SALIDA/logs-conducto.txt")"

    for patron in "ApiChatWebhook" "PayloadTooLarge" "413" "400" "sin-conversacion" "forma-no-reconocida" "ECONNREFUSED" "timeout"; do
      cuenta="$(grep -Fic "$patron" "$SALIDA/logs-conducto.txt" 2>/dev/null || echo 0)"
      printf '    %-22s %s coincidencia(s)\n' "$patron" "$cuenta" | tee -a "$INFORME"
      if [ "$cuenta" != "0" ] && [ "$patron" = "PayloadTooLarge" ]; then
        registrar "El analizador de cuerpo rechazó una carga útil por tamaño: el proveedor envió más de lo admitido y el receptor nunca la vio."
      fi
    done

    nota "Últimas trazas del conducto:"
    tail -n 40 "$SALIDA/logs-conducto.txt" | tee -a "$INFORME"
    nota "Archivos completos: logs-conducto.txt (filtrado) y logs-crudos.txt (íntegro) en $SALIDA"
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# 7. Punto ciego declarado
# ─────────────────────────────────────────────────────────────────────────────
seccion "7. ASIMETRÍA ENTRE LOS DOS RECEPTORES"
nota "El artefacto tiene DOS caminos de entrada y no declaran el mismo vocabulario."
nota "Un tipo que uno admite y el otro descarta produce una pérdida invisible: el"
nota "mensaje entra por el camino que no lo entiende y el otro camino nunca lo ve."
dato "tipo        · webhook (push) · sondeo (historial)"
dato "text        · admitido   · admitido"
dato "link        · admitido   · admitido"
dato "location    · admitido   · admitido"
dato "file        · admitido   · admitido"
dato "document    · admitido   · DESCARTADO EN SILENCIO"
dato "image       · admitido   · DESCARTADO EN SILENCIO"
dato "audio       · admitido   · DESCARTADO EN SILENCIO"
dato "ptt / voice · admitido   · DESCARTADO EN SILENCIO"
dato "video       · admitido   · DESCARTADO EN SILENCIO"
nota "El sondeo solo reconoce 'file' como adjunto (server/inboxSync.ts). Las"
nota "imágenes, los audios y los PDF que el proveedor clasifique como 'document' no"
nota "se registran y no dejan rastro: el puente devuelve «no procesado» sin asiento."
if command -v grep >/dev/null 2>&1 && [ -f "$PROJECT_ROOT/server/inboxSync.ts" ]; then
  tipos_webhook="$(grep -c '"' "$PROJECT_ROOT/server/apiChatWebhook.ts" 2>/dev/null || echo 0)"
  if grep -q 'kind === "file"' "$PROJECT_ROOT/server/inboxSync.ts" 2>/dev/null; then
    registrar "El sondeo del historial descarta imágenes, audios y documentos sin asentar la pérdida: es un punto de pérdida invisible."
  fi
  if grep -q 'ATTACHMENT_MESSAGE_TYPES' "$PROJECT_ROOT/server/apiChatWebhook.ts" 2>/dev/null; then
    registrar "Los dos receptores no declaran el mismo vocabulario de tipos: el webhook admite siete y el sondeo solo uno."
  fi
fi

seccion "8. PUNTO CIEGO DECLARADO DEL INSTRUMENTO"
nota "Este script NO puede mostrar la carga útil que el proveedor envía, porque el"
nota "receptor no la registra: escribe en la base el resultado de interpretarla, no"
nota "el cuerpo recibido. Por eso conviven ocho desenlaces y solo dos dejan rastro."
nota ""
nota "Salidas del receptor y su rastro actual:"
dato "forma-no-reconocida       → sin rastro (processApiChatWebhook, retorno temprano)"
dato "sin-conversacion          → sin rastro"
dato "saliente-ya-registrado    → sin rastro"
dato "texto-invalido            → sin rastro"
dato "enlace-invalido           → sin rastro"
dato "tipo-sin-pipeline         → sin rastro"
dato "base-no-disponible        → sin rastro"
dato "error-interno             → solo console.warn del contenedor"
dato "archivo-sin-contenido     → CON rastro (audit_log: apichat_webhook_loss)"
dato "archivo-ilegible          → CON rastro"
dato "expediente-no-registrado  → CON rastro"
nota ""
nota "Conclusión operativa: mientras el cuerpo crudo no se capture, un adjunto que el"
nota "proveedor envíe con una forma no prevista es indistinguible de un adjunto que el"
nota "proveedor nunca envió. Esa es la razón por la que la auditoría dice «sin"
nota "evidencia» y no «sin pérdida»: son cosas distintas y el artefacto las confunde."

# ─────────────────────────────────────────────────────────────────────────────
# 8. Veredicto
# ─────────────────────────────────────────────────────────────────────────────
seccion "9. VEREDICTO"
if [ "${#HALLAZGOS[@]}" = "0" ]; then
  nota "Sin hallazgos automáticos. Revise las secciones 1 y 5 a mano."
else
  for i in "${!HALLAZGOS[@]}"; do
    printf '  %s) %s\n' "$((i + 1))" "${HALLAZGOS[$i]}" | tee -a "$INFORME"
  done
fi

seccion "10. SIGUIENTE ACCIÓN"
nota "1) Active la captura del cuerpo crudo del webhook en el receptor para que el"
nota "   próximo adjunto real deje evidencia, sea cual sea su forma."
nota "2) Envíe desde un teléfono autorizado un PDF, una imagen y una nota de voz."
nota "3) Vuelva a ejecutar este script y compare la forma capturada con la tabla de"
nota "   la sección 3: el punto del descarte quedará a la vista."
nota ""
nota "Informe: $INFORME"
nota "Consultas para DBeaver: $SQL_ARCHIVO"

if [ -n "$TELEFONO" ]; then
  cat >> "$INFORME" <<SQL

-- Limpieza de la prueba de adjunto real (sección 4):
-- DELETE FROM conversation_messages
--  WHERE direction='inbound' AND provider_message_id LIKE 'sonda-adjunto-%';
SQL
  nota "La consulta de limpieza de la prueba quedó al final del informe."
fi

exit 0
