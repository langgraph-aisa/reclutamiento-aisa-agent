import { describe, expect, it } from "vitest";
import {
  CODEC_CATALOG,
  CODEC_FAMILY_ORDER,
  codecAdvisories,
  codecCatalogComplete,
  codecCatalogWithStates,
  codecFamilySummary,
  codecSettingKey,
  codecStatesFromRows,
} from "./codecRegistry";

describe("catálogo de códecs del transporte", () => {
  it("declara el espectro completo, agrupado y sin identificadores repetidos", () => {
    expect(CODEC_CATALOG).toHaveLength(25);
    const ids = CODEC_CATALOG.map(entry => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    // Las cuatro familias del transporte: audio, video, imagen y documentos.
    expect(CODEC_FAMILY_ORDER).toHaveLength(4);
    for (const family of CODEC_FAMILY_ORDER) {
      expect(CODEC_CATALOG.some(entry => entry.family === family)).toBe(true);
    }
  });

  it("separa contenedor de códec y declara el decodificador de cada entrada", () => {
    for (const entry of CODEC_CATALOG) {
      expect(entry.container.length).toBeGreaterThan(0);
      expect(entry.codec.length).toBeGreaterThan(0);
      expect(entry.decoder.length).toBeGreaterThan(0);
      expect(entry.requirement.length).toBeGreaterThan(0);
      expect(entry.note.length).toBeGreaterThan(0);
    }
  });

  it("declara sin conducto lo que el artefacto aún no procesa", () => {
    // Honestidad del catálogo: el video y los formatos sin tubería se declaran
    // como tales en lugar de prometer una capacidad que no existe.
    const sinConducto = CODEC_CATALOG.filter(
      entry => entry.use === "sin-conducto"
    );
    expect(sinConducto.length).toBeGreaterThan(0);
    expect(
      CODEC_CATALOG.filter(entry => entry.family === "video").every(
        entry => entry.use === "sin-conducto"
      )
    ).toBe(true);
    expect(codecSettingKey("doc-pdf")).toBe("codec_enabled:doc-pdf");
  });
});

describe("estado declarado del registro", () => {
  it("una entrada sin fila se declara encendida", () => {
    const states = codecStatesFromRows([]);
    expect(codecCatalogComplete(states)).toBe(true);
    expect(codecCatalogWithStates(states).every(entry => entry.enabled)).toBe(
      true
    );
  });

  it("solo el valor explícito apaga una entrada", () => {
    const states = codecStatesFromRows([
      { setting_key: "codec_enabled:doc-pdf", setting_value: "false" },
      { setting_key: "codec_enabled:audio-mp3", setting_value: "true" },
    ]);
    expect(states["doc-pdf"]).toBe(false);
    expect(states["audio-mp3"]).toBe(true);
    expect(states["imagen-png"]).toBe(true);
    expect(codecCatalogComplete(states)).toBe(false);
  });
});

describe("advertencias del registro", () => {
  it("no habla cuando todo está encendido", () => {
    const states = codecStatesFromRows([]);
    expect(codecAdvisories(states)).toEqual([]);
    expect(codecFamilySummary(states).every(row => row.breaking.length === 0)).toBe(
      true
    );
  });

  it("advierte cuando se apaga una entrada con conducto en uso", () => {
    const states = codecStatesFromRows([
      { setting_key: "codec_enabled:doc-pdf", setting_value: "false" },
    ]);
    const advisories = codecAdvisories(states);
    expect(advisories).toHaveLength(1);
    expect(advisories[0]).toContain("Documentos");
    expect(advisories[0]).toContain(".pdf");
    expect(advisories[0]).toContain("pérdida");
  });

  it("apagar una entrada sin conducto es mantenimiento y no advierte", () => {
    // La distinción es la razón de ser del registro: apagar lo que no tiene
    // tubería no pierde información; apagar lo que sí la tiene, sí.
    const states = codecStatesFromRows([
      { setting_key: "codec_enabled:video-mp4-h264", setting_value: "false" },
      { setting_key: "codec_enabled:doc-odt", setting_value: "false" },
    ]);
    expect(codecAdvisories(states)).toEqual([]);
    const video = codecFamilySummary(states).find(
      row => row.family === "video"
    );
    expect(video?.enabled).toBe(4);
    expect(video?.total).toBe(5);
  });
});
