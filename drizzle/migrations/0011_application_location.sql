ALTER TABLE "applications" ADD COLUMN "location_zone_id" integer;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "location_department_id" integer;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "location_municipality_id" integer;--> statement-breakpoint

-- Catálogo mínimo operativo para el selector obligatorio de residencia.
-- Las inserciones son idempotentes y conservan cualquier nombre administrado.
INSERT INTO countries (iso2,name,dialing_code,active)
VALUES ('GT','Guatemala','+502',true)
ON CONFLICT (iso2) DO UPDATE SET active=true;--> statement-breakpoint

INSERT INTO geo_departments (country_id,code,name,active)
SELECT id,'01','Guatemala',true FROM countries WHERE iso2='GT'
ON CONFLICT (country_id,code) DO UPDATE SET active=true;--> statement-breakpoint

INSERT INTO geo_municipalities (department_id,code,name,active)
SELECT department.id,seed.code,seed.name,true
FROM geo_departments department
JOIN countries country ON country.id=department.country_id AND country.iso2='GT'
CROSS JOIN (VALUES
  ('101','Guatemala'),
  ('102','Santa Catarina Pinula'),
  ('103','San José Pinula'),
  ('104','San José del Golfo'),
  ('105','Palencia'),
  ('106','Chinautla'),
  ('107','San Pedro Ayampuc'),
  ('108','Mixco'),
  ('109','San Pedro Sacatepéquez'),
  ('110','San Juan Sacatepéquez'),
  ('111','San Raymundo'),
  ('112','Chuarrancho'),
  ('113','Fraijanes'),
  ('114','Amatitlán'),
  ('115','Villa Nueva'),
  ('116','Villa Canales'),
  ('117','San Miguel Petapa')
) AS seed(code,name)
WHERE department.code='01'
ON CONFLICT (department_id,code) DO UPDATE SET active=true;--> statement-breakpoint

INSERT INTO geo_zones (municipality_id,code,name,active)
SELECT municipality.id,series.zone_number::text,'Zona ' || series.zone_number,true
FROM geo_municipalities municipality
JOIN geo_departments department
  ON department.id=municipality.department_id AND department.code='01'
JOIN countries country
  ON country.id=department.country_id AND country.iso2='GT'
CROSS JOIN generate_series(1,25) AS series(zone_number)
WHERE municipality.code='101'
ON CONFLICT (municipality_id,code) DO UPDATE SET active=true;--> statement-breakpoint

ALTER TABLE "applications" ADD CONSTRAINT "applications_location_zone_id_geo_zones_id_fk" FOREIGN KEY ("location_zone_id") REFERENCES "public"."geo_zones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_location_department_id_geo_departments_id_fk" FOREIGN KEY ("location_department_id") REFERENCES "public"."geo_departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_location_municipality_id_geo_municipalities_id_fk" FOREIGN KEY ("location_municipality_id") REFERENCES "public"."geo_municipalities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "applications_location_idx" ON "applications" USING btree ("location_department_id","location_municipality_id","location_zone_id");
