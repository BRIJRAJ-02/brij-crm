-- Saved reports (the reports lane, spec 0050 reserved): `reports`, one row per report, holding its definition
-- (`config`: measure, group by, a filter snapshot, chart type, win chances) and nothing else. Every figure a report
-- draws is read through `records.aggregate` when it opens, so the access door decides what each reader sees.
-- Shared with the workspace; its maker, or a holder of `views.manage`, changes or deletes it.
--
-- A new, empty table: no lock on anything that holds rows. The standard tenant policy, forced (the guard tests).
set local lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE "reports" (
	"workspace_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"object_id" uuid NOT NULL,
	"name" text NOT NULL,
	"config" jsonb NOT NULL,
	"creator_member_id" uuid,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"created_by_type" "actor_type" NOT NULL,
	"created_by_id" uuid,
	"created_by_member_id" uuid,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_by_type" "actor_type" NOT NULL,
	"updated_by_id" uuid,
	"updated_by_member_id" uuid,
	CONSTRAINT "reports_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "reports_name" CHECK (char_length("reports"."name") between 1 and 100 and "reports"."name" = btrim("reports"."name")),
	CONSTRAINT "reports_config" CHECK (jsonb_typeof("reports"."config") = 'object' and octet_length("reports"."config"::text) <= 16384),
	CONSTRAINT "reports_created_by_actor" CHECK (("reports"."created_by_type" is null and "reports"."created_by_id" is null and "reports"."created_by_member_id" is null)
      or ("reports"."created_by_type" = 'system' and "reports"."created_by_id" is null and "reports"."created_by_member_id" is null)
      or ("reports"."created_by_type" = 'member' and "reports"."created_by_id" is not null and "reports"."created_by_member_id" = "reports"."created_by_id")
      or ("reports"."created_by_type"::text not in ('member', 'system', 'calendar') and "reports"."created_by_id" is not null and "reports"."created_by_member_id" is null)),
	CONSTRAINT "reports_updated_by_actor" CHECK (("reports"."updated_by_type" is null and "reports"."updated_by_id" is null and "reports"."updated_by_member_id" is null)
      or ("reports"."updated_by_type" = 'system' and "reports"."updated_by_id" is null and "reports"."updated_by_member_id" is null)
      or ("reports"."updated_by_type" = 'member' and "reports"."updated_by_id" is not null and "reports"."updated_by_member_id" = "reports"."updated_by_id")
      or ("reports"."updated_by_type"::text not in ('member', 'system', 'calendar') and "reports"."updated_by_id" is not null and "reports"."updated_by_member_id" is null))
);
--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_object" FOREIGN KEY ("workspace_id","object_id") REFERENCES "public"."objects"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_creator" FOREIGN KEY ("workspace_id","creator_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_created_by" FOREIGN KEY ("workspace_id","created_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_updated_by" FOREIGN KEY ("workspace_id","updated_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reports_by_created" ON "reports" USING btree ("workspace_id","created_at","id");--> statement-breakpoint
CREATE INDEX "reports_by_object" ON "reports" USING btree ("workspace_id","object_id");--> statement-breakpoint
-- Hand written from here.
-- The standard policy: an unset workspace matches nothing, even for the owner.
alter table reports enable row level security;
--> statement-breakpoint
alter table reports force row level security;
--> statement-breakpoint
create policy reports_tenant on reports
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
