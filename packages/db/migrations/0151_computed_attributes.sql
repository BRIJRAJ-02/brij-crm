-- Computed attributes (spec 0015): lookups, rollups and formulas, stored as ordinary values written by the system.
--
-- 1. `attributes` gains the definition (`computed`, jsonb the contracts' `ComputedDefinition` checked), where its
--    values stand (`computed_state`: filling, ok, broken, null exactly when the attribute isn't computed), why it
--    stopped (`computed_error`), the definition's version (a fill started for an older one ends doing nothing), how
--    deep it builds on other computed attributes (1 to 3) and how many computed attributes read it.
-- 2. `computed_inputs`, the dependency index: one row per input a computed attribute reads, by role, rebuilt whole
--    with the definition. A write's planner reads it by input (`computed_inputs_by_input`). A tenant table under
--    forced row level security with the plain policy.
-- 3. `attribute_options.mirror_of`: a lookup of a select or status keeps a mirror of the related attribute's
--    options, since a value's option must be one of its own attribute's (spec 0004's foreign key).
--
-- No backfill: no attribute is computed yet.
set local lock_timeout = '5s';
--> statement-breakpoint
CREATE TYPE "public"."computed_state" AS ENUM('filling', 'ok', 'broken');
--> statement-breakpoint
CREATE TYPE "public"."computed_input_role" AS ENUM('same_record', 'far_value', 'link', 'far_condition', 'option_labels');
--> statement-breakpoint
ALTER TABLE "attributes" ADD COLUMN "computed" jsonb;--> statement-breakpoint
ALTER TABLE "attributes" ADD COLUMN "computed_state" "computed_state";--> statement-breakpoint
ALTER TABLE "attributes" ADD COLUMN "computed_error" text;--> statement-breakpoint
ALTER TABLE "attributes" ADD COLUMN "computed_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "attributes" ADD COLUMN "computed_depth" smallint;--> statement-breakpoint
ALTER TABLE "attributes" ADD COLUMN "dependent_count" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "attributes" ADD CONSTRAINT "attributes_computed" CHECK (("computed" is null) = ("computed_state" is null));--> statement-breakpoint
ALTER TABLE "attributes" ADD CONSTRAINT "attributes_computed_depth" CHECK ("computed_depth" is null or "computed_depth" between 1 and 3);--> statement-breakpoint
ALTER TABLE "attributes" ADD CONSTRAINT "attributes_dependents" CHECK ("dependent_count" >= 0);--> statement-breakpoint
CREATE TABLE "computed_inputs" (
  "workspace_id" uuid NOT NULL,
  "computed_attribute_id" uuid NOT NULL,
  "input_attribute_id" uuid NOT NULL,
  "role" "computed_input_role" NOT NULL,
  "via_attribute_id" uuid,
  CONSTRAINT "computed_inputs_pkey" PRIMARY KEY("workspace_id","computed_attribute_id","input_attribute_id","role")
);
--> statement-breakpoint
ALTER TABLE "computed_inputs" ADD CONSTRAINT "computed_inputs_computed" FOREIGN KEY ("workspace_id","computed_attribute_id") REFERENCES "public"."attributes"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "computed_inputs" ADD CONSTRAINT "computed_inputs_input" FOREIGN KEY ("workspace_id","input_attribute_id") REFERENCES "public"."attributes"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "computed_inputs" ADD CONSTRAINT "computed_inputs_via" FOREIGN KEY ("workspace_id","via_attribute_id") REFERENCES "public"."attributes"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "computed_inputs_by_input" ON "computed_inputs" USING btree ("workspace_id","input_attribute_id");--> statement-breakpoint
ALTER TABLE "computed_inputs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "computed_inputs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "computed_inputs_tenant" ON "computed_inputs"
  USING ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "attribute_options" ADD COLUMN "mirror_of" uuid;--> statement-breakpoint
ALTER TABLE "attribute_options" ADD CONSTRAINT "attribute_options_mirror" FOREIGN KEY ("workspace_id","mirror_of") REFERENCES "public"."attribute_options"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attribute_options_mirror_of" ON "attribute_options" USING btree ("workspace_id","attribute_id","mirror_of") WHERE "attribute_options"."mirror_of" is not null;
