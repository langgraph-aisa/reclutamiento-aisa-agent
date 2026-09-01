CREATE TABLE "job_profile_positions" (
	"id" serial PRIMARY KEY NOT NULL,
	"profile_id" integer NOT NULL,
	"job_position_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(180) NOT NULL,
	"summary" text,
	"objective" text,
	"responsibilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"required_requirements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"technical_skills" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"soft_skills" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"knowledge" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"academic_level" varchar(120),
	"experience_years_min" integer,
	"experience_years_max" integer,
	"languages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"licenses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"availability" text,
	"location" text,
	"salary_range" varchar(160),
	"work_mode" varchar(80),
	"ai_criteria" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_hash" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_change_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "reset_token_hash" varchar(128);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "reset_token_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "job_profile_positions" ADD CONSTRAINT "job_profile_positions_profile_id_job_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."job_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_profile_positions" ADD CONSTRAINT "job_profile_positions_job_position_id_job_positions_id_fk" FOREIGN KEY ("job_position_id") REFERENCES "public"."job_positions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_profiles" ADD CONSTRAINT "job_profiles_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "job_profile_position_uq" ON "job_profile_positions" USING btree ("profile_id","job_position_id");