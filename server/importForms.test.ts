import { describe, expect, it } from "vitest";
import {
  deriveNameColumn,
  derivePhoneColumn,
  parseSpreadsheetGrid,
} from "./importForms";

describe("importForms spreadsheet parsing", () => {
  it("parses headers and rows from a CSV buffer", () => {
    const grid = parseSpreadsheetGrid(
      Buffer.from(
        "Nombre;WhatsApp;Años de experiencia\nMaría Pérez;+502 5555 1234;5\n",
        "utf8"
      )
    );
    expect(grid.headers).toEqual([
      "Nombre",
      "WhatsApp",
      "Años de experiencia",
    ]);
    expect(grid.rows).toHaveLength(1);
    expect(grid.rows[0][0]).toBe("María Pérez");
    expect(grid.rows[0][1]).toBe("+502 5555 1234");
    expect(grid.rows[0][2]).toBe("5");
  });

  it("locates phone and name columns case-insensitively", () => {
    expect(derivePhoneColumn(["Nombre", "Teléfono"])).toBe(1);
    expect(derivePhoneColumn(["WhatsApp"])).toBe(0);
    expect(derivePhoneColumn(["Zona", "Edad"])).toBe(-1);
    expect(deriveNameColumn(["Apellido", "Nombre completo"])).toBe(1);
  });

  it("rejects sheets without response rows", () => {
    expect(() =>
      parseSpreadsheetGrid(Buffer.from("Nombre;WhatsApp\n", "utf8"))
    ).toThrow("encabezados");
  });
});
