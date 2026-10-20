-- Notes (spec 0019, milestone 3; 0044 before landing): `notes`, its own table beside the records engine. A note's foreign key to its
-- record has no `on delete` action, so removing a record for good with a note left fails unless the purge step deleted
-- its notes first, in the same transaction. The table, keys and indexes are drizzle-kit's; row level security is hand
-- written at the end. The outbox already has the `notes` kind and `item_ids` (spec 0007).
--
-- The foreign keys briefly lock records and members against writes. Give up after 5 seconds rather than queue
-- behind traffic, like 0037.
set local lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE "notes" (
	"workspace_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"record_id" uuid NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"content" jsonb NOT NULL,
	"content_text" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"created_by_type" "actor_type" NOT NULL,
	"created_by_id" uuid,
	"created_by_member_id" uuid,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_by_type" "actor_type" NOT NULL,
	"updated_by_id" uuid,
	"updated_by_member_id" uuid,
	"deleted_at" timestamp (6) with time zone,
	"deleted_by_type" "actor_type",
	"deleted_by_id" uuid,
	"deleted_by_member_id" uuid,
	CONSTRAINT "notes_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "notes_title" CHECK (char_length("notes"."title") <= 200),
	CONSTRAINT "notes_content_text" CHECK (char_length("notes"."content_text") <= 100000),
	CONSTRAINT "notes_version" CHECK ("notes"."version" >= 1),
	CONSTRAINT "notes_deleted" CHECK (("notes"."deleted_at" is null) = ("notes"."deleted_by_type" is null)),
	CONSTRAINT "notes_created_by_actor" CHECK (("notes"."created_by_type" is null and "notes"."created_by_id" is null and "notes"."created_by_member_id" is null)
      or ("notes"."created_by_type" = 'system' and "notes"."created_by_id" is null and "notes"."created_by_member_id" is null)
      or ("notes"."created_by_type" = 'member' and "notes"."created_by_id" is not null and "notes"."created_by_member_id" = "notes"."created_by_id")
      or ("notes"."created_by_type"::text not in ('member', 'system', 'calendar') and "notes"."created_by_id" is not null and "notes"."created_by_member_id" is null)),
	CONSTRAINT "notes_updated_by_actor" CHECK (("notes"."updated_by_type" is null and "notes"."updated_by_id" is null and "notes"."updated_by_member_id" is null)
      or ("notes"."updated_by_type" = 'system' and "notes"."updated_by_id" is null and "notes"."updated_by_member_id" is null)
      or ("notes"."updated_by_type" = 'member' and "notes"."updated_by_id" is not null and "notes"."updated_by_member_id" = "notes"."updated_by_id")
      or ("notes"."updated_by_type"::text not in ('member', 'system', 'calendar') and "notes"."updated_by_id" is not null and "notes"."updated_by_member_id" is null)),
	CONSTRAINT "notes_deleted_by_actor" CHECK (("notes"."deleted_by_type" is null and "notes"."deleted_by_id" is null and "notes"."deleted_by_member_id" is null)
      or ("notes"."deleted_by_type" = 'system' and "notes"."deleted_by_id" is null and "notes"."deleted_by_member_id" is null)
      or ("notes"."deleted_by_type" = 'member' and "notes"."deleted_by_id" is not null and "notes"."deleted_by_member_id" = "notes"."deleted_by_id")
      or ("notes"."deleted_by_type"::text not in ('member', 'system', 'calendar') and "notes"."deleted_by_id" is not null and "notes"."deleted_by_member_id" is null))
);
--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_record" FOREIGN KEY ("workspace_id","record_id") REFERENCES "public"."records"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_created_by" FOREIGN KEY ("workspace_id","created_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_updated_by" FOREIGN KEY ("workspace_id","updated_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_deleted_by" FOREIGN KEY ("workspace_id","deleted_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notes_by_record" ON "notes" USING btree ("workspace_id","record_id","updated_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "notes_by_record_created" ON "notes" USING btree ("workspace_id","record_id","created_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "notes_trashed" ON "notes" USING btree ("workspace_id","deleted_at") WHERE "notes"."deleted_at" is not null;
--> statement-breakpoint

-- Hand written from here.
-- The standard policy: an unset workspace matches nothing, even for the owner.
alter table notes enable row level security;
--> statement-breakpoint
alter table notes force row level security;
--> statement-breakpoint
create policy notes_tenant on notes
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
