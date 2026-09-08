ALTER TABLE "conversation_messages" ADD COLUMN "message_key" varchar(120);--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD COLUMN "delivery_status" varchar(32) DEFAULT 'recorded' NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD COLUMN "attempt_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD COLUMN "sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_messages_message_key_uq" ON "conversation_messages" USING btree ("message_key");
