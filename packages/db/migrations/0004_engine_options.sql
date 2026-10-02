CREATE TYPE "public"."option_outcome" AS ENUM('open', 'won', 'lost');--> statement-breakpoint
CREATE TABLE "attribute_options" (
	"workspace_id" uuid NOT NULL,
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"attribute_id" uuid NOT NULL,
	"label" text NOT NULL,
	"hue" text NOT NULL,
	"position" integer NOT NULL,
	"outcome" "option_outcome",
	"target_time_in_stage" interval,
	"archived_at" timestamp (6) with time zone,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"created_by_type" "actor_type" NOT NULL,
	"created_by_id" uuid,
	"created_by_member_id" uuid,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_by_type" "actor_type" NOT NULL,
	"updated_by_id" uuid,
	"updated_by_member_id" uuid,
	CONSTRAINT "attribute_options_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "attribute_options_created_by_actor" CHECK (("attribute_options"."created_by_type" is null and "attribute_options"."created_by_id" is null and "attribute_options"."created_by_member_id" is null)
      or ("attribute_options"."created_by_type" = 'system' and "attribute_options"."created_by_id" is null and "attribute_options"."created_by_member_id" is null)
      or ("attribute_options"."created_by_type" = 'member' and "attribute_options"."created_by_id" is not null and "attribute_options"."created_by_member_id" = "attribute_options"."created_by_id")
      or ("attribute_options"."created_by_type" in ('api_key', 'automation') and "attribute_options"."created_by_id" is not null and "attribute_options"."created_by_member_id" is null)),
	CONSTRAINT "attribute_options_updated_by_actor" CHECK (("attribute_options"."updated_by_type" is null and "attribute_options"."updated_by_id" is null and "attribute_options"."updated_by_member_id" is null)
      or ("attribute_options"."updated_by_type" = 'system' and "attribute_options"."updated_by_id" is null and "attribute_options"."updated_by_member_id" is null)
      or ("attribute_options"."updated_by_type" = 'member' and "attribute_options"."updated_by_id" is not null and "attribute_options"."updated_by_member_id" = "attribute_options"."updated_by_id")
      or ("attribute_options"."updated_by_type" in ('api_key', 'automation') and "attribute_options"."updated_by_id" is not null and "attribute_options"."updated_by_member_id" is null))
);
--> statement-breakpoint
ALTER TABLE "attribute_options" ADD CONSTRAINT "attribute_options_attribute" FOREIGN KEY ("workspace_id","attribute_id") REFERENCES "public"."attributes"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribute_options" ADD CONSTRAINT "attribute_options_created_by" FOREIGN KEY ("workspace_id","created_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribute_options" ADD CONSTRAINT "attribute_options_updated_by" FOREIGN KEY ("workspace_id","updated_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attribute_options_of_attribute" ON "attribute_options" USING btree ("workspace_id","attribute_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "attribute_options_label" ON "attribute_options" USING btree ("workspace_id","attribute_id",lower("label")) WHERE "attribute_options"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "attribute_options_order" ON "attribute_options" USING btree ("workspace_id","attribute_id","position");--> statement-breakpoint
ALTER TABLE "values" ADD CONSTRAINT "values_option" FOREIGN KEY ("workspace_id","attribute_id","option_id") REFERENCES "public"."attribute_options"("workspace_id","attribute_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "values_number" ON "values" USING btree ("workspace_id","attribute_id","number_value","position","owner_id") WHERE active_until is null and not is_cleared and number_value is not null;--> statement-breakpoint
CREATE INDEX "values_date" ON "values" USING btree ("workspace_id","attribute_id","date_value","position","owner_id") WHERE active_until is null and not is_cleared and date_value is not null;--> statement-breakpoint
CREATE INDEX "values_timestamp" ON "values" USING btree ("workspace_id","attribute_id","timestamp_value","position","owner_id") WHERE active_until is null and not is_cleared and timestamp_value is not null;--> statement-breakpoint
CREATE INDEX "values_option" ON "values" USING btree ("workspace_id","attribute_id","option_id","position","owner_id") WHERE active_until is null and not is_cleared and option_id is not null;--> statement-breakpoint
CREATE INDEX "values_bool" ON "values" USING btree ("workspace_id","attribute_id","bool_value","position","owner_id") WHERE active_until is null and not is_cleared and bool_value is not null;--> statement-breakpoint
CREATE INDEX "values_actor" ON "values" USING btree ("workspace_id","attribute_id","actor_id","position","owner_id") WHERE active_until is null and not is_cleared and actor_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "values_unique" ON "values" USING btree ("workspace_id","attribute_id","unique_key") WHERE "values"."active_until" is null and "values"."unique_key" is not null;