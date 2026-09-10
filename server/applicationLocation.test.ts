import { TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";
import { resolveApplicationLocation } from "./applicationLocation";

describe("application location catalog contract", () => {
  it("accepts a zone, department and municipality linked by the active GT catalog", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          zone_id: 25,
          zone_name: "Zona 25",
          department_id: 1,
          department_name: "Guatemala",
          municipality_id: 17,
          municipality_name: "San Miguel Petapa",
        },
      ],
    });

    await expect(
      resolveApplicationLocation(
        { query },
        { zoneId: 25, departmentId: 1, municipalityId: 17 }
      )
    ).resolves.toEqual({
      zoneId: 25,
      zone: "Zona 25",
      departmentId: 1,
      department: "Guatemala",
      municipalityId: 17,
      municipality: "San Miguel Petapa",
    });

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("JOIN geo_municipalities selected_m"),
      [25, 17, 1]
    );
  });

  it("rejects identifiers that do not form one valid catalog relationship", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });

    await expect(
      resolveApplicationLocation(
        { query },
        { zoneId: 1, departmentId: 2, municipalityId: 10 }
      )
    ).rejects.toBeInstanceOf(TRPCError);
  });
});
