import { describe, expect, it } from "vitest";
import { APPLICATION_STATUS_OPTIONS } from "../shared/applicationStatus";
import {
  canChangeStatus,
  canManageConfiguration,
  canOperateCandidates,
  duplicateIdentity,
  shouldContinueAfterReview,
} from "./policy";

describe("recruitment policy", () => {
  it("allows operations for admin and recruiter only", () => {
    expect(canOperateCandidates("admin")).toBe(true);
    expect(canOperateCandidates("reclutador")).toBe(true);
    expect(canOperateCandidates("user")).toBe(false);
  });

  it("reserves configuration for admin", () => {
    expect(canManageConfiguration("admin")).toBe(true);
    expect(canManageConfiguration("reclutador")).toBe(false);
  });

  it("accepts only known statuses for an operational role", () => {
    expect(canChangeStatus("reclutador", "calificado")).toBe(true);
    expect(canChangeStatus("reclutador", "calificado_aisa")).toBe(true);
    expect(canChangeStatus("reclutador", "pre_calificado_prioritario")).toBe(
      true
    );
    expect(canChangeStatus("reclutador", "pre_calificado")).toBe(true);
    expect(canChangeStatus("reclutador", "pre_calificado_condicionado")).toBe(
      true
    );
    expect(canChangeStatus("user", "calificado")).toBe(false);
    expect(canChangeStatus("admin", "otro_estado")).toBe(false);
  });

  it("publishes every AI score band in the shared selectors", () => {
    const options = new Map(
      APPLICATION_STATUS_OPTIONS.map(option => [option.value, option.label])
    );

    expect(options.get("pre_calificado_prioritario")).toBe(
      "Precalificado prioritario"
    );
    expect(options.get("pre_calificado")).toBe("Precalificado");
    expect(options.get("pre_calificado_condicionado")).toBe(
      "Precalificado condicionado"
    );
    expect(options.get("pendiente_revision_humana")).toBe("Revisión humana");
    expect(options.get("no_calificado")).toBe("No precalificado");
  });

  it("uses phone plus position as duplicate identity", () => {
    expect(duplicateIdentity("+50255555555", 4)).toBe("+50255555555:4");
    expect(duplicateIdentity("+50255555555", 4)).toBe(
      duplicateIdentity("+50255555555", 4)
    );
    expect(duplicateIdentity("+50255555555", 5)).not.toBe(
      duplicateIdentity("+50255555555", 4)
    );
  });

  it("continues only while status remains qualified after the hold", () => {
    expect(shouldContinueAfterReview("calificado")).toBe(true);
    expect(shouldContinueAfterReview("calificado_aisa")).toBe(false);
    expect(shouldContinueAfterReview("pre_calificado_prioritario")).toBe(false);
    expect(shouldContinueAfterReview("pre_calificado_condicionado")).toBe(
      false
    );
    expect(shouldContinueAfterReview("no_calificado")).toBe(false);
    expect(shouldContinueAfterReview("en_revision")).toBe(false);
  });
});
