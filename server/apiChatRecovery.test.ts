import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

/**
 * Recuperación del adjunto conservado.
 *
 * La operación declara **qué puede recuperar cada vía**, y esa declaración es lo
 * que estas pruebas fijan. Una recuperación que se anuncia exitosa sin haber
 * resuelto el contenido repetiría el error que la auditoría corrigió: concluir
 * desde la intención y no desde el hecho.
 */

let mediaBase: string | null = null;

vi.mock("./apiChatMediaProbe", () => ({
  resolveApiChatMediaBase: async () => mediaBase,
}));

const {
  APICHAT_RECOVERY_RECEIPT_LIMIT,
  APICHAT_RECOVERY_WINDOW_HOURS,
  apiChatAccountScope,
  recoverApiChatAttachments,
  requeueDeadReceipts,
  rewindHistoryCursor,
} = await import("./apiChatRecovery");

type Call = { sql: string; params?: unknown[] };
type Answer = { rows?: unknown[]; rowCount?: number | null };

function fakePool(answers: Answer[]) {
  const calls: Call[] = [];
  let index = 0;
  const pool = {
    query: async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params });
      const answer = answers[index] ?? {};
      index += 1;
      const rows = answer.rows ?? [];
      return {
        rows,
        rowCount: answer.rowCount === undefined ? rows.length : answer.rowCount,
      };
    },
  } as unknown as Pool;
  return { pool, calls };
}

describe("rebobinado del cursor del historial", () => {
  it("conserva la página anterior y vuelve al origen de los tiempos", async () => {
    const { pool, calls } = fakePool([
      { rows: [{ page: 7 }] },
      { rows: [], rowCount: 1 },
    ]);
    await expect(rewindHistoryCursor(pool, "aisa")).resolves.toBe(7);
    expect(calls[0].sql).toContain("SELECT page FROM apichat_history_cursors");
    expect(calls[1].sql).toContain("page=0");
    // La marca se retrasa al origen: el sondeo exige un intervalo mínimo entre
    // lecturas del feed, y un cursor «recién actualizado» haría esperar quince
    // segundos una operación que el operador acaba de pedir.
    expect(calls[1].sql).toContain("'epoch'");
    expect(calls[1].params).toEqual(["aisa"]);
  });

  it("declara la primera página cuando el cursor todavía no existe", async () => {
    const { pool } = fakePool([{ rows: [] }, { rows: [], rowCount: 1 }]);
    await expect(rewindHistoryCursor(pool, "default")).resolves.toBe(0);
  });
});

describe("reproceso de los recibos agotados", () => {
  it("sólo devuelve a la cola lo agotado, dentro de la ventana y con tope", async () => {
    const { pool, calls } = fakePool([{ rows: [], rowCount: 3 }]);
    await expect(requeueDeadReceipts(pool)).resolves.toBe(3);
    expect(calls[0].sql).toContain("status='dead'");
    expect(calls[0].sql).toContain("LIMIT $2");
    expect(calls[0].params).toEqual([
      String(APICHAT_RECOVERY_WINDOW_HOURS),
      APICHAT_RECOVERY_RECEIPT_LIMIT,
    ]);
    // El desenlace anterior no se borra: describe la última tentativa hasta que
    // una nueva lo sustituya, y perderlo mientras el reproceso está en curso
    // dejaría la causa sin asiento.
    expect(calls[0].sql).not.toContain("outcome=NULL");
    expect(calls[0].sql).toContain("attempts=0");
    expect(calls[0].sql).toContain("lease_token=NULL");
  });
});

describe("alcance de cuenta del historial", () => {
  it("usa el alcance declarado y cae a uno por omisión", () => {
    const previous = process.env.APICHAT_ACCOUNT_SCOPE;
    try {
      delete process.env.APICHAT_ACCOUNT_SCOPE;
      expect(apiChatAccountScope()).toBe("default");
      process.env.APICHAT_ACCOUNT_SCOPE = "aisa";
      expect(apiChatAccountScope()).toBe("aisa");
    } finally {
      if (previous === undefined) delete process.env.APICHAT_ACCOUNT_SCOPE;
      else process.env.APICHAT_ACCOUNT_SCOPE = previous;
    }
  });
});

describe("veredicto de la recuperación", () => {
  it("declara que sin base de medios el reproceso vuelve a encontrar la ausencia", async () => {
    mediaBase = null;
    const { pool, calls } = fakePool([
      { rows: [], rowCount: 2 }, // requeue
      { rows: [{ page: 4 }] }, // lectura del cursor
      { rows: [], rowCount: 1 }, // rebobinado
      { rows: [], rowCount: 1 }, // asiento de la operación
    ]);
    const outcome = await recoverApiChatAttachments(pool, 91);
    expect(outcome).toMatchObject({
      requeued: 2,
      historyPreviousPage: 4,
      payloadResolvableByProbe: false,
    });
    expect(outcome.verdict).toContain("Sin una base de medios declarada");
    expect(outcome.verdict).toContain("relectura del historial");
    // El asiento conserva el actor y los conteos, y ningún contenido del candidato.
    const audit = calls.at(-1)!;
    expect(audit.sql).toContain("INSERT INTO audit_log");
    expect(audit.params?.[0]).toBe(91);
    expect(String(audit.params?.[1])).toContain("requeued");
    expect(String(audit.params?.[1])).not.toMatch(/https?:|\d{8,}/);
  });

  it("declara la sonda como única vía de reproceso cuando la base está declarada", async () => {
    mediaBase = "https://api.apichat.io/v1";
    const { pool } = fakePool([
      { rows: [], rowCount: 0 },
      { rows: [{ page: 0 }] },
      { rows: [], rowCount: 1 },
      { rows: [], rowCount: 1 },
    ]);
    const outcome = await recoverApiChatAttachments(pool, 91);
    expect(outcome.payloadResolvableByProbe).toBe(true);
    expect(outcome.verdict).toContain("sonda acotada");
    // La confirmación no declara resuelto el archivo: el desenlace se lee en el
    // asiento de la sonda y en el estado de la cola.
    expect(outcome.verdict).toContain("no en esta confirmación");
    mediaBase = null;
  });
});
