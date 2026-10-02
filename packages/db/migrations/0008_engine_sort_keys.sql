CREATE TABLE "sort_keys" (
	"workspace_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"attribute_id" uuid NOT NULL,
	"record_id" uuid NOT NULL,
	"entry_id" uuid,
	"live" boolean NOT NULL,
	"text_key" text collate "und-x-icu",
	"number_key" bigint,
	"code_key" text collate "C",
	"date_key" date,
	"time_key" timestamp (3) with time zone,
	"option_id" uuid,
	"bool_key" boolean,
	CONSTRAINT "sort_keys_pkey" PRIMARY KEY("workspace_id","owner_id","attribute_id"),
	CONSTRAINT "sort_keys_owner" CHECK ("sort_keys"."owner_id" = coalesce("sort_keys"."entry_id", "sort_keys"."record_id"))
);
--> statement-breakpoint
ALTER TABLE "list_entries" ADD CONSTRAINT "list_entries_record_key" UNIQUE("workspace_id","id","record_id");--> statement-breakpoint
ALTER TABLE "sort_keys" ADD CONSTRAINT "sort_keys_attribute" FOREIGN KEY ("workspace_id","attribute_id") REFERENCES "public"."attributes"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sort_keys" ADD CONSTRAINT "sort_keys_record" FOREIGN KEY ("workspace_id","record_id") REFERENCES "public"."records"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sort_keys" ADD CONSTRAINT "sort_keys_entry" FOREIGN KEY ("workspace_id","entry_id","record_id") REFERENCES "public"."list_entries"("workspace_id","id","record_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sort_keys" ADD CONSTRAINT "sort_keys_option" FOREIGN KEY ("workspace_id","attribute_id","option_id") REFERENCES "public"."attribute_options"("workspace_id","attribute_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sort_keys_text" ON "sort_keys" USING btree ("workspace_id","attribute_id","text_key","owner_id") WHERE live and text_key is not null;--> statement-breakpoint
CREATE INDEX "sort_keys_by_record" ON "sort_keys" USING btree ("workspace_id","record_id");--> statement-breakpoint
CREATE INDEX "sort_keys_by_entry" ON "sort_keys" USING btree ("workspace_id","entry_id") WHERE "sort_keys"."entry_id" is not null;
