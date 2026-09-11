import { describe, expect, it, vi } from "vitest";
import {
  buildProcedureActivityEvent,
  isConfigurationProcedure,
  procedureActivityPage,
  recordProcedureActivityBestEffort,
  shouldAuditProcedureActivity,
} from "./procedureActivityAudit";

describe("auditoría transversal de mutaciones tRPC", () => {
  it("audita únicamente mutaciones y excluye la escritura propia", () => {
    expect(shouldAuditProcedureActivity("mutation", "users.upsert")).toBe(true);
    expect(shouldAuditProcedureActivity("query", "users.list")).toBe(false);
    expect(shouldAuditProcedureActivity("mutation", "activity.record")).toBe(
      false
    );
  });

  it("proyecta páginas administrativas y clasifica configuración", () => {
    expect(procedureActivityPage("positions.setPublished")).toBe("/admin/jobs");
    expect(procedureActivityPage("inbox.sendText")).toBe("/admin/inbox");
    expect(procedureActivityPage("future.execute")).toBe("/admin/activity");
    expect(isConfigurationProcedure("agent.savePreferences")).toBe(true);
    expect(isConfigurationProcedure("candidates.setStatus")).toBe(false);
  });

  it("conserva actor, ruta, resultado y correlación sin datos privados", () => {
    const startedAt = new Date("2026-09-11T12:34:56.000Z");
    const event = buildProcedureActivityEvent({
      actorUserId: 41,
      procedurePath: "config.saveApiChatSecret",
      terminalResult: "completed",
      startedAt,
      correlationId: "d2b179f2-065b-4a58-a23f-374938450fea",
    });

    expect(event).toEqual({
      actorType: "human",
      actorUserId: 41,
      actorEmail: null,
      pagePath: "/admin/config",
      eventType: "config.saveApiChatSecret",
      outcome: "configuracion",
      expectedAction: "Ejecutar una mutación tRPC autenticada y autorizada",
      actualAction: "config.saveApiChatSecret · completada",
      correlationId: "d2b179f2-065b-4a58-a23f-374938450fea",
      controlStartedAt: startedAt,
    });
    expect(JSON.stringify(event)).not.toContain("sk-proj-private-value");
    expect(event).not.toHaveProperty("input");
    expect(event).not.toHaveProperty("output");
    expect(event).not.toHaveProperty("metadata");
  });

  it("marca como error un resultado terminal fallido", () => {
    const event = buildProcedureActivityEvent({
      actorUserId: 7,
      procedurePath: "candidates.setStatus",
      terminalResult: "failed",
      startedAt: new Date("2026-09-11T12:34:56.000Z"),
    });

    expect(event.outcome).toBe("error");
    expect(event.actualAction).toBe("candidates.setStatus · error controlado");
    expect(event.correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  it("persiste solo parámetros permitidos y deja metadata vacía", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const recorded = await recordProcedureActivityBestEffort(
      {
        actorUserId: 12,
        procedurePath: "profiles.upsert",
        terminalResult: "completed",
        startedAt: new Date("2026-09-11T12:34:56.000Z"),
        correlationId: "4c85d642-b083-448a-ab7f-a491de889daf",
      },
      async () => ({ query }) as never
    );

    expect(recorded).toBe(true);
    expect(query).toHaveBeenCalledOnce();
    const [sql, values] = query.mock.calls[0];
    expect(sql).toContain("INSERT INTO admin_activity_events");
    expect(sql).toContain("'{}'::jsonb");
    expect(values).toEqual([
      "human",
      12,
      "/admin/profiles",
      "profiles.upsert",
      "guardado",
      "Ejecutar una mutación tRPC autenticada y autorizada",
      "profiles.upsert · completada",
      "4c85d642-b083-448a-ab7f-a491de889daf",
      new Date("2026-09-11T12:34:56.000Z"),
    ]);
  });

  it("no rompe la mutación cuando PostgreSQL o la migración no están disponibles", async () => {
    await expect(
      recordProcedureActivityBestEffort(
        {
          actorUserId: 12,
          procedurePath: "profiles.upsert",
          terminalResult: "completed",
          startedAt: new Date(),
        },
        async () => null
      )
    ).resolves.toBe(false);

    await expect(
      recordProcedureActivityBestEffort(
        {
          actorUserId: 12,
          procedurePath: "profiles.upsert",
          terminalResult: "completed",
          startedAt: new Date(),
        },
        async () =>
          ({
            query: vi.fn().mockRejectedValue(
              Object.assign(new Error("relation does not exist"), {
                code: "42P01",
              })
            ),
          }) as never
      )
    ).resolves.toBe(false);
  });
});
