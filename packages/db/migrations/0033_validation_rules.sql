-- Validation rules (spec 0013, milestone 1, migration A): a rule per row, travelling with its attribute, and on each
-- attribute the count of rules that read it (its own plus those whose condition names it) and a version that moves
-- whenever one of them changes, so a write to an object with no rules reads nothing more. The table and columns are
-- drizzle-kit's; row level security is hand written at the end.
--
-- The foreign keys briefly lock objects, attributes and members against writes, and the two new attribute columns
-- take the attributes table's lock for a moment (constant defaults: no rewrite). Give up after 5 seconds rather
-- than queue behind traffic, like 0020, 0023, 0026 and 0029.
set local lock_timeout = '5s';
--> statement-breakpoint
CREATE TYPE "public"."validation_rule_kind" AS ENUM('required_when', 'length', 'pattern', 'email_domain', 'phone_country', 'range', 'integer', 'currency_in', 'date_range', 'count');--> statement-breakpoint
CREATE TABLE "validation_rules" (
	"workspace_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"object_id" uuid NOT NULL,
	"attribute_id" uuid NOT NULL,
	"kind" "validation_rule_kind" NOT NULL,
	"params" jsonb NOT NULL,
	"condition" jsonb,
	"message" text,
	"position" smallint NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"breaking_count" integer,
	"breaking_sample" uuid[],
	"counted_at" timestamp (6) with time zone,
	"counted_version" integer,
	"counted_by_member_id" uuid,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"created_by_type" "actor_type" NOT NULL,
	"created_by_id" uuid,
	"created_by_member_id" uuid,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_by_type" "actor_type" NOT NULL,
	"updated_by_id" uuid,
	"updated_by_member_id" uuid,
	CONSTRAINT "validation_rules_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "validation_rules_message" CHECK ("validation_rules"."message" is null or char_length("validation_rules"."message") between 1 and 200),
	CONSTRAINT "validation_rules_position" CHECK ("validation_rules"."position" >= 0),
	CONSTRAINT "validation_rules_sample" CHECK ("validation_rules"."breaking_sample" is null or coalesce(array_length("validation_rules"."breaking_sample", 1), 0) <= 20),
	CONSTRAINT "validation_rules_created_by_actor" CHECK (("validation_rules"."created_by_type" is null and "validation_rules"."created_by_id" is null and "validation_rules"."created_by_member_id" is null)
      or ("validation_rules"."created_by_type" = 'system' and "validation_rules"."created_by_id" is null and "validation_rules"."created_by_member_id" is null)
      or ("validation_rules"."created_by_type" = 'member' and "validation_rules"."created_by_id" is not null and "validation_rules"."created_by_member_id" = "validation_rules"."created_by_id")
      or ("validation_rules"."created_by_type" in ('api_key', 'automation') and "validation_rules"."created_by_id" is not null and "validation_rules"."created_by_member_id" is null)),
	CONSTRAINT "validation_rules_updated_by_actor" CHECK (("validation_rules"."updated_by_type" is null and "validation_rules"."updated_by_id" is null and "validation_rules"."updated_by_member_id" is null)
      or ("validation_rules"."updated_by_type" = 'system' and "validation_rules"."updated_by_id" is null and "validation_rules"."updated_by_member_id" is null)
      or ("validation_rules"."updated_by_type" = 'member' and "validation_rules"."updated_by_id" is not null and "validation_rules"."updated_by_member_id" = "validation_rules"."updated_by_id")
      or ("validation_rules"."updated_by_type" in ('api_key', 'automation') and "validation_rules"."updated_by_id" is not null and "validation_rules"."updated_by_member_id" is null))
);
--> statement-breakpoint
ALTER TABLE "attributes" ADD COLUMN "rule_count" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "attributes" ADD COLUMN "rules_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "validation_rules" ADD CONSTRAINT "validation_rules_object" FOREIGN KEY ("workspace_id","object_id") REFERENCES "public"."objects"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validation_rules" ADD CONSTRAINT "validation_rules_attribute" FOREIGN KEY ("workspace_id","attribute_id") REFERENCES "public"."attributes"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validation_rules" ADD CONSTRAINT "validation_rules_counted_by" FOREIGN KEY ("workspace_id","counted_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validation_rules" ADD CONSTRAINT "validation_rules_created_by" FOREIGN KEY ("workspace_id","created_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validation_rules" ADD CONSTRAINT "validation_rules_updated_by" FOREIGN KEY ("workspace_id","updated_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "validation_rules_by_attribute" ON "validation_rules" USING btree ("workspace_id","object_id","attribute_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "validation_rules_one_required_when" ON "validation_rules" USING btree ("workspace_id","attribute_id") WHERE "validation_rules"."kind" = 'required_when';
--> statement-breakpoint

-- Hand written from here.
-- The standard policy: an unset workspace matches nothing, even for the owner.
alter table validation_rules enable row level security;
--> statement-breakpoint
alter table validation_rules force row level security;
--> statement-breakpoint
create policy validation_rules_tenant on validation_rules
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
