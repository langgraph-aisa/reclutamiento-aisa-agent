import { describe, expect, it } from "vitest";
import { humanReviewStamp } from "../client/src/components/review/CandidateReviewSummary";

/**
 * El sello de la revisión humana **no está quemado**.
 *
 * La pregunta que responde esta prueba es concreta: ¿la hora y la fecha que ve
 * el evaluador corresponden al momento en que la persona guardó la revisión, o
 * son un texto fijo? Un rótulo de fecha escrito a mano en la interfaz mentiría
 * en el único dato que justifica su existencia —cuándo se revisó— y esa mentira
 * sería invisible, porque el texto siempre se vería bien.
 *
 * Se comprueba con instantes distintos, con un cruce de día y con un año
 * anterior a la entrega: si el sello devolviera la fecha del sistema o una
 * constante, los tres casos fallarían.
 */

describe("sello de la revisión humana", () => {
  it("produce sellos distintos para instantes distintos", () => {
    const first = humanReviewStamp("2026-09-18T22:45:00.000Z");
    const second = humanReviewStamp("2026-09-18T23:10:00.000Z");
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first).not.toEqual(second);
    // 22:45 UTC son las 16:45 en Guatemala: el texto del ejemplo es una
    // consecuencia de este instante, no una cadena escrita en el código.
    expect(first).toMatchObject({ time: "16:45", date: "18 SEP 2026" });
    expect(second?.time).toBe("17:10");
  });

  it("traslada día, mes y año del instante recibido", () => {
    expect(humanReviewStamp("2025-01-03T12:00:00.000Z")).toMatchObject({
      time: "06:00",
      date: "03 ENE 2025",
    });
    expect(humanReviewStamp("2024-07-31T15:30:00.000Z")).toMatchObject({
      time: "09:30",
      date: "31 JUL 2024",
    });
  });

  it("convierte a la zona horaria de la institución y no a UTC", () => {
    // Las 03:00 UTC del 19 son las 21:00 del 18 en Guatemala: el día retrocede.
    expect(humanReviewStamp("2026-09-19T03:00:00.000Z")).toMatchObject({
      time: "21:00",
      date: "18 SEP 2026",
    });
  });

  it("no inventa un sello cuando no hay revisión registrada", () => {
    expect(humanReviewStamp(null)).toBeNull();
    expect(humanReviewStamp(undefined)).toBeNull();
    expect(humanReviewStamp("")).toBeNull();
    expect(humanReviewStamp("no-es-una-fecha")).toBeNull();
  });

  it("es determinista y no depende del reloj de quien consulta", () => {
    // Un instante anterior a esta entrega: si el sello usara la fecha de hoy,
    // el año mostrado sería el vigente y no 2020.
    const value = "2020-02-29T18:00:00.000Z";
    const first = humanReviewStamp(value);
    expect(first).toEqual(humanReviewStamp(value));
    expect(first?.date).toBe("29 FEB 2020");
    expect(first?.time).toBe("12:00");
    expect(first?.date).not.toContain("2026");
  });

  it("expone el instante en ISO para poder correlacionarlo con el asiento", () => {
    const stamp = humanReviewStamp("2026-09-18T22:45:00.000Z");
    expect(stamp?.iso).toBe("2026-09-18T22:45:00.000Z");
    expect(new Date(stamp!.iso).toISOString()).toBe(stamp?.iso);
  });

  it("compone el texto visible a partir del instante y cambia con él", () => {
    // Misma composición que la matriz: «Revisión Humana (hora) fecha».
    const badge = (iso: string) => {
      const stamp = humanReviewStamp(iso);
      return stamp ? `Revisión Humana (${stamp.time}) ${stamp.date}` : null;
    };
    expect(badge("2026-09-18T22:45:00.000Z")).toBe(
      "Revisión Humana (16:45) 18 SEP 2026"
    );
    expect(badge("2026-09-19T14:05:00.000Z")).toBe(
      "Revisión Humana (08:05) 19 SEP 2026"
    );
    expect(badge("2026-09-19T14:05:00.000Z")).not.toBe(
      badge("2026-09-18T22:45:00.000Z")
    );
  });
});
