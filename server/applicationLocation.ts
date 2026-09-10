import { TRPCError } from "@trpc/server";

type LocationQueryClient = {
  query: (
    text: string,
    values?: unknown[]
  ) => Promise<{ rows: Array<Record<string, unknown>> }>;
};

export type ApplicationLocationInput = {
  zoneId: number;
  departmentId: number;
  municipalityId: number;
};

export type ResolvedApplicationLocation = ApplicationLocationInput & {
  zone: string;
  department: string;
  municipality: string;
};

/**
 * Resolves the three submitted identifiers through one relational join.
 * This prevents clients from pairing a zone with a department or municipality
 * that does not belong to the active Guatemala catalog.
 */
export async function resolveApplicationLocation(
  client: LocationQueryClient,
  input: ApplicationLocationInput
): Promise<ResolvedApplicationLocation> {
  const result = await client.query(
    `SELECT z.id AS zone_id,z.name AS zone_name,
            d.id AS department_id,d.name AS department_name,
            selected_m.id AS municipality_id,selected_m.name AS municipality_name
       FROM geo_zones z
       JOIN geo_municipalities zone_m ON zone_m.id=z.municipality_id AND zone_m.active=true
       JOIN geo_departments d ON d.id=zone_m.department_id AND d.active=true
       JOIN countries c ON c.id=d.country_id AND c.iso2='GT' AND c.active=true
       JOIN geo_municipalities selected_m
         ON selected_m.id=$2 AND selected_m.department_id=d.id AND selected_m.active=true
      WHERE z.id=$1 AND d.id=$3 AND z.active=true
        AND z.code ~ '^(?:[1-9]|1[0-9]|2[0-5])$'
      LIMIT 1`,
    [input.zoneId, input.municipalityId, input.departmentId]
  );
  const row = result.rows[0];
  if (!row) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "La zona, el departamento o el municipio no pertenecen al catálogo activo.",
    });
  }
  return {
    zoneId: Number(row.zone_id),
    departmentId: Number(row.department_id),
    municipalityId: Number(row.municipality_id),
    zone: String(row.zone_name),
    department: String(row.department_name),
    municipality: String(row.municipality_name),
  };
}
