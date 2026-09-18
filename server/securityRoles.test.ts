import { describe, expect, it } from "vitest";
import { ADMIN_PAGE_LABELS } from "@shared/activityAudit";
import {
  EMPTY_GRANT,
  FULL_GRANT,
  PERMISSION_ACTIONS,
  SECURITY_RESOURCES,
  permissionDecision,
  permissionMapKey,
  securityModules,
  toPermissionMap,
} from "./securityRoles";

describe("catálogo de entradas gobernadas", () => {
  it("toma los módulos de la fuente única y no de una lista propia", () => {
    const modules = securityModules();
    expect(modules).toHaveLength(Object.keys(ADMIN_PAGE_LABELS).length);
    expect(modules.map(module => module.key)).toContain("/admin/inbox");
    expect(modules.map(module => module.label)).toContain("Bandeja de entrada");
  });

  it("gobierna dominios de la base y no tablas", () => {
    expect(SECURITY_RESOURCES.length).toBeGreaterThan(0);
    for (const resource of SECURITY_RESOURCES) {
      // Un dominio se nombra en singular y describe un concepto, no un objeto
      // físico: `candidate_knowledge_files` sería una tabla y envejecería.
      expect(resource.key).not.toContain("_");
      expect(resource.note.length).toBeGreaterThan(0);
    }
  });

  it("declara las cinco columnas del permiso", () => {
    expect(PERMISSION_ACTIONS).toEqual([
      "view",
      "read",
      "write",
      "edit",
      "delete",
    ]);
    expect(EMPTY_GRANT).toMatchObject({ view: false, delete: false });
    expect(FULL_GRANT).toMatchObject({ view: true, delete: true });
  });
});

const grants = [
  {
    scope: "modulo",
    resourceKey: "/admin/inbox",
    grant: { ...EMPTY_GRANT, view: true, read: true },
  },
  {
    scope: "recurso",
    resourceKey: "candidatos",
    grant: { ...EMPTY_GRANT, view: true, read: true, edit: true },
  },
];

describe("decisión de acceso", () => {
  it("el administrador conserva todo por rol", () => {
    for (const action of PERMISSION_ACTIONS) {
      expect(
        permissionDecision({
          role: "admin",
          grants: [],
          scope: "modulo",
          key: "/admin/config",
          action,
        })
      ).toBe(true);
    }
  });

  it("sin concesión no hay acceso", () => {
    expect(
      permissionDecision({
        role: "reclutador",
        grants,
        scope: "modulo",
        key: "/admin/reports",
        action: "view",
      })
    ).toBe(false);
  });

  it("concede exactamente la acción concedida y ninguna otra", () => {
    const base = {
      role: "reclutador",
      grants,
      scope: "modulo" as const,
      key: "/admin/inbox",
    };
    expect(permissionDecision({ ...base, action: "view" })).toBe(true);
    expect(permissionDecision({ ...base, action: "read" })).toBe(true);
    expect(permissionDecision({ ...base, action: "write" })).toBe(false);
    expect(permissionDecision({ ...base, action: "edit" })).toBe(false);
    expect(permissionDecision({ ...base, action: "delete" })).toBe(false);
  });

  it("separa el alcance del menú del alcance de la base", () => {
    // La misma clave en otro alcance no concede nada: el permiso del menú no
    // autoriza a tocar los registros, y al revés.
    expect(
      permissionDecision({
        role: "reclutador",
        grants,
        scope: "recurso",
        key: "/admin/inbox",
        action: "view",
      })
    ).toBe(false);
    expect(
      permissionDecision({
        role: "reclutador",
        grants,
        scope: "recurso",
        key: "candidatos",
        action: "edit",
      })
    ).toBe(true);
    expect(
      permissionDecision({
        role: "reclutador",
        grants,
        scope: "recurso",
        key: "candidatos",
        action: "delete",
      })
    ).toBe(false);
  });

  it("una cuenta sin rol reconocido no obtiene acceso implícito", () => {
    expect(
      permissionDecision({
        role: null,
        grants: [],
        scope: "modulo",
        key: "/admin",
        action: "read",
      })
    ).toBe(false);
  });
});

describe("mapa de concesiones", () => {
  it("traduce las filas guardadas a la forma que consume la decisión", () => {
    const map = toPermissionMap([
      {
        scope: "modulo",
        resource_key: "/admin/users",
        can_view: true,
        can_read: true,
        can_write: false,
        can_edit: false,
        can_delete: false,
      },
    ]);
    expect(map[permissionMapKey("modulo", "/admin/users")]).toEqual({
      view: true,
      read: true,
      write: false,
      edit: false,
      delete: false,
    });
  });

  it("sin filas el mapa queda vacío: la ausencia es ausencia", () => {
    expect(toPermissionMap([])).toEqual({});
  });
});
