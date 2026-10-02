CREATE TYPE "public"."actor_type" AS ENUM('member', 'api_key', 'automation', 'system');--> statement-breakpoint
CREATE TYPE "public"."attribute_type" AS ENUM('text', 'long_text', 'number', 'currency', 'date', 'timestamp', 'checkbox', 'select', 'status', 'rating', 'email', 'phone', 'domain', 'url', 'location', 'personal_name', 'actor_reference', 'record_reference', 'file', 'interaction');--> statement-breakpoint
CREATE TYPE "public"."member_status" AS ENUM('active', 'removed');--> statement-breakpoint
CREATE TYPE "public"."system_column" AS ENUM('id', 'created_at', 'created_by', 'updated_at', 'updated_by');--> statement-breakpoint
CREATE TABLE "attributes" (
	"workspace_id" uuid NOT NULL,
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"object_id" uuid,
	"list_id" uuid,
	"api_slug" text NOT NULL,
	"title" text NOT NULL,
	"type" "attribute_type" NOT NULL,
	"is_multi" boolean DEFAULT false NOT NULL,
	"is_required" boolean DEFAULT false NOT NULL,
	"is_unique" boolean DEFAULT false NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"system_column" "system_column",
	"default_value" jsonb,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"description" text,
	"position" integer NOT NULL,
	"relationship_id" uuid,
	"archived_at" timestamp (6) with time zone,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"created_by_type" "actor_type" NOT NULL,
	"created_by_id" uuid,
	"created_by_member_id" uuid,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_by_type" "actor_type" NOT NULL,
	"updated_by_id" uuid,
	"updated_by_member_id" uuid,
	CONSTRAINT "attributes_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "attributes_parent" CHECK (num_nonnulls("attributes"."object_id", "attributes"."list_id") = 1),
	CONSTRAINT "attributes_system" CHECK (("attributes"."system_column" is null) or "attributes"."is_system"),
	CONSTRAINT "attributes_multi" CHECK (not "attributes"."is_multi" or "attributes"."type" in ('select', 'email', 'phone', 'domain', 'url', 'actor_reference', 'record_reference', 'file')),
	CONSTRAINT "attributes_unique" CHECK (not "attributes"."is_unique" or "attributes"."type" in ('text', 'email', 'domain', 'url', 'phone', 'number')),
	CONSTRAINT "attributes_created_by_actor" CHECK (("attributes"."created_by_type" is null and "attributes"."created_by_id" is null and "attributes"."created_by_member_id" is null)
      or ("attributes"."created_by_type" = 'system' and "attributes"."created_by_id" is null and "attributes"."created_by_member_id" is null)
      or ("attributes"."created_by_type" = 'member' and "attributes"."created_by_id" is not null and "attributes"."created_by_member_id" = "attributes"."created_by_id")
      or ("attributes"."created_by_type" in ('api_key', 'automation') and "attributes"."created_by_id" is not null and "attributes"."created_by_member_id" is null)),
	CONSTRAINT "attributes_updated_by_actor" CHECK (("attributes"."updated_by_type" is null and "attributes"."updated_by_id" is null and "attributes"."updated_by_member_id" is null)
      or ("attributes"."updated_by_type" = 'system' and "attributes"."updated_by_id" is null and "attributes"."updated_by_member_id" is null)
      or ("attributes"."updated_by_type" = 'member' and "attributes"."updated_by_id" is not null and "attributes"."updated_by_member_id" = "attributes"."updated_by_id")
      or ("attributes"."updated_by_type" in ('api_key', 'automation') and "attributes"."updated_by_id" is not null and "attributes"."updated_by_member_id" is null))
);
--> statement-breakpoint
CREATE TABLE "members" (
	"workspace_id" uuid NOT NULL,
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"user_id" uuid,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"status" "member_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"created_by_type" "actor_type" NOT NULL,
	"created_by_id" uuid,
	"created_by_member_id" uuid,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_by_type" "actor_type" NOT NULL,
	"updated_by_id" uuid,
	"updated_by_member_id" uuid,
	CONSTRAINT "members_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "members_created_by_actor" CHECK (("members"."created_by_type" is null and "members"."created_by_id" is null and "members"."created_by_member_id" is null)
      or ("members"."created_by_type" = 'system' and "members"."created_by_id" is null and "members"."created_by_member_id" is null)
      or ("members"."created_by_type" = 'member' and "members"."created_by_id" is not null and "members"."created_by_member_id" = "members"."created_by_id")
      or ("members"."created_by_type" in ('api_key', 'automation') and "members"."created_by_id" is not null and "members"."created_by_member_id" is null)),
	CONSTRAINT "members_updated_by_actor" CHECK (("members"."updated_by_type" is null and "members"."updated_by_id" is null and "members"."updated_by_member_id" is null)
      or ("members"."updated_by_type" = 'system' and "members"."updated_by_id" is null and "members"."updated_by_member_id" is null)
      or ("members"."updated_by_type" = 'member' and "members"."updated_by_id" is not null and "members"."updated_by_member_id" = "members"."updated_by_id")
      or ("members"."updated_by_type" in ('api_key', 'automation') and "members"."updated_by_id" is not null and "members"."updated_by_member_id" is null))
);
--> statement-breakpoint
CREATE TABLE "objects" (
	"workspace_id" uuid NOT NULL,
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"api_slug" text NOT NULL,
	"singular_name" text NOT NULL,
	"plural_name" text NOT NULL,
	"icon" text NOT NULL,
	"hue" text NOT NULL,
	"is_standard" boolean DEFAULT false NOT NULL,
	"standard_key" text,
	"template_version" integer,
	"primary_attribute_id" uuid,
	"archived_at" timestamp (6) with time zone,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"created_by_type" "actor_type" NOT NULL,
	"created_by_id" uuid,
	"created_by_member_id" uuid,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_by_type" "actor_type" NOT NULL,
	"updated_by_id" uuid,
	"updated_by_member_id" uuid,
	CONSTRAINT "objects_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "objects_standard" CHECK ("objects"."is_standard" = ("objects"."standard_key" is not null)),
	CONSTRAINT "objects_created_by_actor" CHECK (("objects"."created_by_type" is null and "objects"."created_by_id" is null and "objects"."created_by_member_id" is null)
      or ("objects"."created_by_type" = 'system' and "objects"."created_by_id" is null and "objects"."created_by_member_id" is null)
      or ("objects"."created_by_type" = 'member' and "objects"."created_by_id" is not null and "objects"."created_by_member_id" = "objects"."created_by_id")
      or ("objects"."created_by_type" in ('api_key', 'automation') and "objects"."created_by_id" is not null and "objects"."created_by_member_id" is null)),
	CONSTRAINT "objects_updated_by_actor" CHECK (("objects"."updated_by_type" is null and "objects"."updated_by_id" is null and "objects"."updated_by_member_id" is null)
      or ("objects"."updated_by_type" = 'system' and "objects"."updated_by_id" is null and "objects"."updated_by_member_id" is null)
      or ("objects"."updated_by_type" = 'member' and "objects"."updated_by_id" is not null and "objects"."updated_by_member_id" = "objects"."updated_by_id")
      or ("objects"."updated_by_type" in ('api_key', 'automation') and "objects"."updated_by_id" is not null and "objects"."updated_by_member_id" is null))
);
--> statement-breakpoint
CREATE TABLE "records" (
	"workspace_id" uuid NOT NULL,
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"object_id" uuid NOT NULL,
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
	CONSTRAINT "records_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "records_deleted" CHECK (("records"."deleted_at" is null) = ("records"."deleted_by_type" is null)),
	CONSTRAINT "records_created_by_actor" CHECK (("records"."created_by_type" is null and "records"."created_by_id" is null and "records"."created_by_member_id" is null)
      or ("records"."created_by_type" = 'system' and "records"."created_by_id" is null and "records"."created_by_member_id" is null)
      or ("records"."created_by_type" = 'member' and "records"."created_by_id" is not null and "records"."created_by_member_id" = "records"."created_by_id")
      or ("records"."created_by_type" in ('api_key', 'automation') and "records"."created_by_id" is not null and "records"."created_by_member_id" is null)),
	CONSTRAINT "records_updated_by_actor" CHECK (("records"."updated_by_type" is null and "records"."updated_by_id" is null and "records"."updated_by_member_id" is null)
      or ("records"."updated_by_type" = 'system' and "records"."updated_by_id" is null and "records"."updated_by_member_id" is null)
      or ("records"."updated_by_type" = 'member' and "records"."updated_by_id" is not null and "records"."updated_by_member_id" = "records"."updated_by_id")
      or ("records"."updated_by_type" in ('api_key', 'automation') and "records"."updated_by_id" is not null and "records"."updated_by_member_id" is null)),
	CONSTRAINT "records_deleted_by_actor" CHECK (("records"."deleted_by_type" is null and "records"."deleted_by_id" is null and "records"."deleted_by_member_id" is null)
      or ("records"."deleted_by_type" = 'system' and "records"."deleted_by_id" is null and "records"."deleted_by_member_id" is null)
      or ("records"."deleted_by_type" = 'member' and "records"."deleted_by_id" is not null and "records"."deleted_by_member_id" = "records"."deleted_by_id")
      or ("records"."deleted_by_type" in ('api_key', 'automation') and "records"."deleted_by_id" is not null and "records"."deleted_by_member_id" is null))
);
--> statement-breakpoint
CREATE TABLE "values" (
	"workspace_id" uuid NOT NULL,
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"version_id" uuid NOT NULL,
	"attribute_id" uuid NOT NULL,
	"record_id" uuid,
	"entry_id" uuid,
	"owner_id" uuid NOT NULL,
	"position" smallint DEFAULT 0 NOT NULL,
	"is_cleared" boolean DEFAULT false NOT NULL,
	"text_value" text,
	"number_value" numeric(19, 4),
	"date_value" date,
	"timestamp_value" timestamp (3) with time zone,
	"bool_value" boolean,
	"option_id" uuid,
	"actor_type" "actor_type",
	"actor_id" uuid,
	"actor_member_id" uuid,
	"json_value" jsonb,
	"unique_key" text,
	"held_unique_key" text,
	"active_from" timestamp (6) with time zone NOT NULL,
	"active_until" timestamp (6) with time zone,
	"set_by_type" "actor_type" NOT NULL,
	"set_by_id" uuid,
	"set_by_member_id" uuid,
	CONSTRAINT "values_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "values_owner" CHECK (num_nonnulls("values"."record_id", "values"."entry_id") = 1 and "values"."owner_id" = coalesce("values"."record_id", "values"."entry_id")),
	CONSTRAINT "values_period" CHECK ("values"."active_until" is null or "values"."active_until" > "values"."active_from"),
	CONSTRAINT "values_cleared" CHECK (not "values"."is_cleared" or num_nonnulls("values"."text_value", "values"."number_value", "values"."date_value", "values"."timestamp_value", "values"."bool_value", "values"."option_id", "values"."actor_type", "values"."json_value") = 0),
	CONSTRAINT "values_set_by_actor" CHECK (("values"."set_by_type" is null and "values"."set_by_id" is null and "values"."set_by_member_id" is null)
      or ("values"."set_by_type" = 'system' and "values"."set_by_id" is null and "values"."set_by_member_id" is null)
      or ("values"."set_by_type" = 'member' and "values"."set_by_id" is not null and "values"."set_by_member_id" = "values"."set_by_id")
      or ("values"."set_by_type" in ('api_key', 'automation') and "values"."set_by_id" is not null and "values"."set_by_member_id" is null)),
	CONSTRAINT "values_actor_actor" CHECK (("values"."actor_type" is null and "values"."actor_id" is null and "values"."actor_member_id" is null)
      or ("values"."actor_type" = 'system' and "values"."actor_id" is null and "values"."actor_member_id" is null)
      or ("values"."actor_type" = 'member' and "values"."actor_id" is not null and "values"."actor_member_id" = "values"."actor_id")
      or ("values"."actor_type" in ('api_key', 'automation') and "values"."actor_id" is not null and "values"."actor_member_id" is null))
);
--> statement-breakpoint
CREATE TABLE "workspace_counters" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"live_records" integer DEFAULT 0 NOT NULL,
	"custom_objects" integer DEFAULT 0 NOT NULL,
	"lists" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"deleted_at" timestamp (6) with time zone,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"created_by_type" "actor_type" NOT NULL,
	"created_by_id" uuid,
	"created_by_member_id" uuid,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_by_type" "actor_type" NOT NULL,
	"updated_by_id" uuid,
	"updated_by_member_id" uuid,
	CONSTRAINT "workspaces_created_by_actor" CHECK (("workspaces"."created_by_type" is null and "workspaces"."created_by_id" is null and "workspaces"."created_by_member_id" is null)
      or ("workspaces"."created_by_type" = 'system' and "workspaces"."created_by_id" is null and "workspaces"."created_by_member_id" is null)
      or ("workspaces"."created_by_type" = 'member' and "workspaces"."created_by_id" is not null and "workspaces"."created_by_member_id" = "workspaces"."created_by_id")
      or ("workspaces"."created_by_type" in ('api_key', 'automation') and "workspaces"."created_by_id" is not null and "workspaces"."created_by_member_id" is null)),
	CONSTRAINT "workspaces_updated_by_actor" CHECK (("workspaces"."updated_by_type" is null and "workspaces"."updated_by_id" is null and "workspaces"."updated_by_member_id" is null)
      or ("workspaces"."updated_by_type" = 'system' and "workspaces"."updated_by_id" is null and "workspaces"."updated_by_member_id" is null)
      or ("workspaces"."updated_by_type" = 'member' and "workspaces"."updated_by_id" is not null and "workspaces"."updated_by_member_id" = "workspaces"."updated_by_id")
      or ("workspaces"."updated_by_type" in ('api_key', 'automation') and "workspaces"."updated_by_id" is not null and "workspaces"."updated_by_member_id" is null))
);
--> statement-breakpoint
ALTER TABLE "attributes" ADD CONSTRAINT "attributes_object" FOREIGN KEY ("workspace_id","object_id") REFERENCES "public"."objects"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attributes" ADD CONSTRAINT "attributes_created_by" FOREIGN KEY ("workspace_id","created_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attributes" ADD CONSTRAINT "attributes_updated_by" FOREIGN KEY ("workspace_id","updated_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_workspace" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_created_by" FOREIGN KEY ("workspace_id","created_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_updated_by" FOREIGN KEY ("workspace_id","updated_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "objects" ADD CONSTRAINT "objects_workspace" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "objects" ADD CONSTRAINT "objects_primary_attribute" FOREIGN KEY ("workspace_id","primary_attribute_id") REFERENCES "public"."attributes"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "objects" ADD CONSTRAINT "objects_created_by" FOREIGN KEY ("workspace_id","created_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "objects" ADD CONSTRAINT "objects_updated_by" FOREIGN KEY ("workspace_id","updated_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records" ADD CONSTRAINT "records_object" FOREIGN KEY ("workspace_id","object_id") REFERENCES "public"."objects"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records" ADD CONSTRAINT "records_created_by" FOREIGN KEY ("workspace_id","created_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records" ADD CONSTRAINT "records_updated_by" FOREIGN KEY ("workspace_id","updated_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records" ADD CONSTRAINT "records_deleted_by" FOREIGN KEY ("workspace_id","deleted_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "values" ADD CONSTRAINT "values_attribute" FOREIGN KEY ("workspace_id","attribute_id") REFERENCES "public"."attributes"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "values" ADD CONSTRAINT "values_record" FOREIGN KEY ("workspace_id","record_id") REFERENCES "public"."records"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "values" ADD CONSTRAINT "values_set_by" FOREIGN KEY ("workspace_id","set_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "values" ADD CONSTRAINT "values_actor" FOREIGN KEY ("workspace_id","actor_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_counters" ADD CONSTRAINT "workspace_counters_workspace" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attributes_object_slug" ON "attributes" USING btree ("workspace_id","object_id","api_slug") WHERE "attributes"."object_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "attributes_list_slug" ON "attributes" USING btree ("workspace_id","list_id","api_slug") WHERE "attributes"."list_id" is not null;--> statement-breakpoint
CREATE INDEX "attributes_by_object" ON "attributes" USING btree ("workspace_id","object_id","position");--> statement-breakpoint
CREATE INDEX "attributes_by_list" ON "attributes" USING btree ("workspace_id","list_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "members_email" ON "members" USING btree ("workspace_id",lower("email")) WHERE "members"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "objects_api_slug" ON "objects" USING btree ("workspace_id","api_slug");--> statement-breakpoint
CREATE UNIQUE INDEX "objects_standard_key" ON "objects" USING btree ("workspace_id","standard_key") WHERE "objects"."standard_key" is not null;--> statement-breakpoint
CREATE INDEX "records_live" ON "records" USING btree ("workspace_id","object_id","id") WHERE "records"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "records_created" ON "records" USING btree ("workspace_id","object_id","created_at","id") WHERE "records"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "records_updated" ON "records" USING btree ("workspace_id","object_id","updated_at","id") WHERE "records"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "values_current" ON "values" USING btree ("workspace_id","owner_id","attribute_id","position") WHERE "values"."active_until" is null;--> statement-breakpoint
CREATE INDEX "values_text" ON "values" USING btree ("workspace_id","attribute_id",(lower(left("text_value", 256)) collate "und-x-icu"),"position","owner_id") WHERE active_until is null and not is_cleared and text_value is not null;--> statement-breakpoint
CREATE INDEX "values_text_trigram" ON "values" USING gin ("workspace_id","attribute_id",lower(left("text_value", 2048)) gin_trgm_ops) WHERE active_until is null and not is_cleared and text_value is not null;--> statement-breakpoint
CREATE INDEX "values_history" ON "values" USING btree ("workspace_id","owner_id","attribute_id","active_from");--> statement-breakpoint
CREATE UNIQUE INDEX "workspaces_slug" ON "workspaces" USING btree ("slug") WHERE "workspaces"."deleted_at" is null;