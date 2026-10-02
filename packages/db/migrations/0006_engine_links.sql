CREATE TYPE "public"."relationship_cardinality" AS ENUM('one_to_one', 'one_to_many', 'many_to_one', 'many_to_many');--> statement-breakpoint
CREATE TABLE "list_entries" (
	"workspace_id" uuid NOT NULL,
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"list_id" uuid NOT NULL,
	"record_id" uuid NOT NULL,
	"deleted_at" timestamp (6) with time zone,
	"deleted_by_type" "actor_type",
	"deleted_by_id" uuid,
	"deleted_by_member_id" uuid,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"created_by_type" "actor_type" NOT NULL,
	"created_by_id" uuid,
	"created_by_member_id" uuid,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_by_type" "actor_type" NOT NULL,
	"updated_by_id" uuid,
	"updated_by_member_id" uuid,
	CONSTRAINT "list_entries_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "list_entries_deleted" CHECK (("list_entries"."deleted_at" is null) = ("list_entries"."deleted_by_type" is null)),
	CONSTRAINT "list_entries_created_by_actor" CHECK (("list_entries"."created_by_type" is null and "list_entries"."created_by_id" is null and "list_entries"."created_by_member_id" is null)
      or ("list_entries"."created_by_type" = 'system' and "list_entries"."created_by_id" is null and "list_entries"."created_by_member_id" is null)
      or ("list_entries"."created_by_type" = 'member' and "list_entries"."created_by_id" is not null and "list_entries"."created_by_member_id" = "list_entries"."created_by_id")
      or ("list_entries"."created_by_type" in ('api_key', 'automation') and "list_entries"."created_by_id" is not null and "list_entries"."created_by_member_id" is null)),
	CONSTRAINT "list_entries_updated_by_actor" CHECK (("list_entries"."updated_by_type" is null and "list_entries"."updated_by_id" is null and "list_entries"."updated_by_member_id" is null)
      or ("list_entries"."updated_by_type" = 'system' and "list_entries"."updated_by_id" is null and "list_entries"."updated_by_member_id" is null)
      or ("list_entries"."updated_by_type" = 'member' and "list_entries"."updated_by_id" is not null and "list_entries"."updated_by_member_id" = "list_entries"."updated_by_id")
      or ("list_entries"."updated_by_type" in ('api_key', 'automation') and "list_entries"."updated_by_id" is not null and "list_entries"."updated_by_member_id" is null)),
	CONSTRAINT "list_entries_deleted_by_actor" CHECK (("list_entries"."deleted_by_type" is null and "list_entries"."deleted_by_id" is null and "list_entries"."deleted_by_member_id" is null)
      or ("list_entries"."deleted_by_type" = 'system' and "list_entries"."deleted_by_id" is null and "list_entries"."deleted_by_member_id" is null)
      or ("list_entries"."deleted_by_type" = 'member' and "list_entries"."deleted_by_id" is not null and "list_entries"."deleted_by_member_id" = "list_entries"."deleted_by_id")
      or ("list_entries"."deleted_by_type" in ('api_key', 'automation') and "list_entries"."deleted_by_id" is not null and "list_entries"."deleted_by_member_id" is null))
);
--> statement-breakpoint
CREATE TABLE "lists" (
	"workspace_id" uuid NOT NULL,
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"object_id" uuid NOT NULL,
	"api_slug" text NOT NULL,
	"name" text NOT NULL,
	"allows_duplicates" boolean DEFAULT true NOT NULL,
	"entry_count" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp (6) with time zone,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"created_by_type" "actor_type" NOT NULL,
	"created_by_id" uuid,
	"created_by_member_id" uuid,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_by_type" "actor_type" NOT NULL,
	"updated_by_id" uuid,
	"updated_by_member_id" uuid,
	CONSTRAINT "lists_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "lists_entry_count" CHECK ("lists"."entry_count" >= 0),
	CONSTRAINT "lists_created_by_actor" CHECK (("lists"."created_by_type" is null and "lists"."created_by_id" is null and "lists"."created_by_member_id" is null)
      or ("lists"."created_by_type" = 'system' and "lists"."created_by_id" is null and "lists"."created_by_member_id" is null)
      or ("lists"."created_by_type" = 'member' and "lists"."created_by_id" is not null and "lists"."created_by_member_id" = "lists"."created_by_id")
      or ("lists"."created_by_type" in ('api_key', 'automation') and "lists"."created_by_id" is not null and "lists"."created_by_member_id" is null)),
	CONSTRAINT "lists_updated_by_actor" CHECK (("lists"."updated_by_type" is null and "lists"."updated_by_id" is null and "lists"."updated_by_member_id" is null)
      or ("lists"."updated_by_type" = 'system' and "lists"."updated_by_id" is null and "lists"."updated_by_member_id" is null)
      or ("lists"."updated_by_type" = 'member' and "lists"."updated_by_id" is not null and "lists"."updated_by_member_id" = "lists"."updated_by_id")
      or ("lists"."updated_by_type" in ('api_key', 'automation') and "lists"."updated_by_id" is not null and "lists"."updated_by_member_id" is null))
);
--> statement-breakpoint
CREATE TABLE "record_links" (
	"workspace_id" uuid NOT NULL,
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"version_id" uuid NOT NULL,
	"relationship_id" uuid NOT NULL,
	"from_record_id" uuid NOT NULL,
	"to_record_id" uuid NOT NULL,
	"position" smallint DEFAULT 0 NOT NULL,
	"to_position" smallint DEFAULT 0 NOT NULL,
	"from_single" boolean NOT NULL,
	"to_single" boolean NOT NULL,
	"active_from" timestamp (6) with time zone NOT NULL,
	"active_until" timestamp (6) with time zone,
	"set_by_type" "actor_type" NOT NULL,
	"set_by_id" uuid,
	"set_by_member_id" uuid,
	"ended_by_type" "actor_type",
	"ended_by_id" uuid,
	"ended_by_member_id" uuid,
	CONSTRAINT "record_links_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "record_links_period" CHECK ("record_links"."active_until" is null or "record_links"."active_until" > "record_links"."active_from"),
	CONSTRAINT "record_links_ended" CHECK (("record_links"."active_until" is null) = ("record_links"."ended_by_type" is null)),
	CONSTRAINT "record_links_set_by_actor" CHECK (("record_links"."set_by_type" is null and "record_links"."set_by_id" is null and "record_links"."set_by_member_id" is null)
      or ("record_links"."set_by_type" = 'system' and "record_links"."set_by_id" is null and "record_links"."set_by_member_id" is null)
      or ("record_links"."set_by_type" = 'member' and "record_links"."set_by_id" is not null and "record_links"."set_by_member_id" = "record_links"."set_by_id")
      or ("record_links"."set_by_type" in ('api_key', 'automation') and "record_links"."set_by_id" is not null and "record_links"."set_by_member_id" is null)),
	CONSTRAINT "record_links_ended_by_actor" CHECK (("record_links"."ended_by_type" is null and "record_links"."ended_by_id" is null and "record_links"."ended_by_member_id" is null)
      or ("record_links"."ended_by_type" = 'system' and "record_links"."ended_by_id" is null and "record_links"."ended_by_member_id" is null)
      or ("record_links"."ended_by_type" = 'member' and "record_links"."ended_by_id" is not null and "record_links"."ended_by_member_id" = "record_links"."ended_by_id")
      or ("record_links"."ended_by_type" in ('api_key', 'automation') and "record_links"."ended_by_id" is not null and "record_links"."ended_by_member_id" is null))
);
--> statement-breakpoint
CREATE TABLE "relationships" (
	"workspace_id" uuid NOT NULL,
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"cardinality" "relationship_cardinality" NOT NULL,
	"from_attribute_id" uuid NOT NULL,
	"to_attribute_id" uuid,
	"target_object_ids" uuid[],
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"created_by_type" "actor_type" NOT NULL,
	"created_by_id" uuid,
	"created_by_member_id" uuid,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_by_type" "actor_type" NOT NULL,
	"updated_by_id" uuid,
	"updated_by_member_id" uuid,
	CONSTRAINT "relationships_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "relationships_ends" CHECK ("relationships"."to_attribute_id" is null or "relationships"."to_attribute_id" <> "relationships"."from_attribute_id"),
	CONSTRAINT "relationships_one_way" CHECK (("relationships"."to_attribute_id" is null) = ("relationships"."target_object_ids" is not null) and ("relationships"."target_object_ids" is null or cardinality("relationships"."target_object_ids") between 1 and 20)),
	CONSTRAINT "relationships_created_by_actor" CHECK (("relationships"."created_by_type" is null and "relationships"."created_by_id" is null and "relationships"."created_by_member_id" is null)
      or ("relationships"."created_by_type" = 'system' and "relationships"."created_by_id" is null and "relationships"."created_by_member_id" is null)
      or ("relationships"."created_by_type" = 'member' and "relationships"."created_by_id" is not null and "relationships"."created_by_member_id" = "relationships"."created_by_id")
      or ("relationships"."created_by_type" in ('api_key', 'automation') and "relationships"."created_by_id" is not null and "relationships"."created_by_member_id" is null)),
	CONSTRAINT "relationships_updated_by_actor" CHECK (("relationships"."updated_by_type" is null and "relationships"."updated_by_id" is null and "relationships"."updated_by_member_id" is null)
      or ("relationships"."updated_by_type" = 'system' and "relationships"."updated_by_id" is null and "relationships"."updated_by_member_id" is null)
      or ("relationships"."updated_by_type" = 'member' and "relationships"."updated_by_id" is not null and "relationships"."updated_by_member_id" = "relationships"."updated_by_id")
      or ("relationships"."updated_by_type" in ('api_key', 'automation') and "relationships"."updated_by_id" is not null and "relationships"."updated_by_member_id" is null))
);
--> statement-breakpoint
ALTER TABLE "list_entries" ADD CONSTRAINT "list_entries_list" FOREIGN KEY ("workspace_id","list_id") REFERENCES "public"."lists"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_entries" ADD CONSTRAINT "list_entries_record" FOREIGN KEY ("workspace_id","record_id") REFERENCES "public"."records"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_entries" ADD CONSTRAINT "list_entries_created_by" FOREIGN KEY ("workspace_id","created_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_entries" ADD CONSTRAINT "list_entries_updated_by" FOREIGN KEY ("workspace_id","updated_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_entries" ADD CONSTRAINT "list_entries_deleted_by" FOREIGN KEY ("workspace_id","deleted_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lists" ADD CONSTRAINT "lists_object" FOREIGN KEY ("workspace_id","object_id") REFERENCES "public"."objects"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lists" ADD CONSTRAINT "lists_created_by" FOREIGN KEY ("workspace_id","created_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lists" ADD CONSTRAINT "lists_updated_by" FOREIGN KEY ("workspace_id","updated_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_links" ADD CONSTRAINT "record_links_relationship" FOREIGN KEY ("workspace_id","relationship_id") REFERENCES "public"."relationships"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_links" ADD CONSTRAINT "record_links_from_record" FOREIGN KEY ("workspace_id","from_record_id") REFERENCES "public"."records"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_links" ADD CONSTRAINT "record_links_to_record" FOREIGN KEY ("workspace_id","to_record_id") REFERENCES "public"."records"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_links" ADD CONSTRAINT "record_links_set_by" FOREIGN KEY ("workspace_id","set_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_links" ADD CONSTRAINT "record_links_ended_by" FOREIGN KEY ("workspace_id","ended_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_from_attribute" FOREIGN KEY ("workspace_id","from_attribute_id") REFERENCES "public"."attributes"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_to_attribute" FOREIGN KEY ("workspace_id","to_attribute_id") REFERENCES "public"."attributes"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_created_by" FOREIGN KEY ("workspace_id","created_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_updated_by" FOREIGN KEY ("workspace_id","updated_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "list_entries_live" ON "list_entries" USING btree ("workspace_id","list_id","id") WHERE "list_entries"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "list_entries_record" ON "list_entries" USING btree ("workspace_id","record_id","list_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lists_api_slug" ON "lists" USING btree ("workspace_id","api_slug");--> statement-breakpoint
CREATE INDEX "record_links_from" ON "record_links" USING btree ("workspace_id","relationship_id","from_record_id","position") WHERE active_until is null;--> statement-breakpoint
CREATE INDEX "record_links_to" ON "record_links" USING btree ("workspace_id","relationship_id","to_record_id","to_position") WHERE active_until is null;--> statement-breakpoint
CREATE UNIQUE INDEX "record_links_current" ON "record_links" USING btree ("workspace_id","relationship_id","from_record_id","to_record_id") WHERE active_until is null;--> statement-breakpoint
CREATE UNIQUE INDEX "record_links_from_single" ON "record_links" USING btree ("workspace_id","relationship_id","from_record_id") WHERE active_until is null and from_single;--> statement-breakpoint
CREATE UNIQUE INDEX "record_links_to_single" ON "record_links" USING btree ("workspace_id","relationship_id","to_record_id") WHERE active_until is null and to_single;--> statement-breakpoint
CREATE INDEX "record_links_from_history" ON "record_links" USING btree ("workspace_id","from_record_id","relationship_id","active_from");--> statement-breakpoint
CREATE INDEX "record_links_to_history" ON "record_links" USING btree ("workspace_id","to_record_id","relationship_id","active_from");--> statement-breakpoint
CREATE UNIQUE INDEX "relationships_from" ON "relationships" USING btree ("workspace_id","from_attribute_id");--> statement-breakpoint
CREATE UNIQUE INDEX "relationships_to" ON "relationships" USING btree ("workspace_id","to_attribute_id") WHERE "relationships"."to_attribute_id" is not null;--> statement-breakpoint
ALTER TABLE "attributes" ADD CONSTRAINT "attributes_list" FOREIGN KEY ("workspace_id","list_id") REFERENCES "public"."lists"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attributes" ADD CONSTRAINT "attributes_relationship" FOREIGN KEY ("workspace_id","relationship_id") REFERENCES "public"."relationships"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "values" ADD CONSTRAINT "values_entry" FOREIGN KEY ("workspace_id","entry_id") REFERENCES "public"."list_entries"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attributes" ADD CONSTRAINT "attributes_reference" CHECK ("attributes"."relationship_id" is null or "attributes"."type" = 'record_reference');