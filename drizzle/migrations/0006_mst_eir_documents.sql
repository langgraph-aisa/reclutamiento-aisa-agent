CREATE TABLE "methodology_document_revisions" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" integer NOT NULL,
	"version" integer NOT NULL,
	"display_name" varchar(160) NOT NULL,
	"content_markdown" text NOT NULL,
	"changed_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "methodology_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_key" varchar(32) NOT NULL,
	"display_name" varchar(160) NOT NULL,
	"content_markdown" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by_user_id" integer,
	"updated_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "methodology_document_revisions" ADD CONSTRAINT "methodology_document_revisions_document_id_methodology_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."methodology_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "methodology_document_revisions" ADD CONSTRAINT "methodology_document_revisions_changed_by_user_id_users_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "methodology_documents" ADD CONSTRAINT "methodology_documents_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "methodology_documents" ADD CONSTRAINT "methodology_documents_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "methodology_document_revisions_document_version_uq" ON "methodology_document_revisions" USING btree ("document_id","version");--> statement-breakpoint
CREATE INDEX "methodology_document_revisions_document_idx" ON "methodology_document_revisions" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "methodology_documents_document_key_uq" ON "methodology_documents" USING btree ("document_key");