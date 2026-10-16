-- Tasks (spec 0019, milestone 1): `tasks` and `task_records`, their own tables beside the records engine. A link's
-- foreign key to its record has no `on delete` action, so removing a record for good with a link left fails unless
-- the purge registry (spec 0022) deleted the links first; a task removed by the cleanup takes its links. The tables,
-- keys and indexes are drizzle-kit's; row level security is hand written at the end. The outbox already has the
-- `tasks` kind and `item_ids` (spec 0007).
--
-- The foreign keys briefly lock records and members against writes. Give up after 5 seconds rather than queue
-- behind traffic, like 0020, 0023, 0026, 0029 and 0033.
set local lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE "task_records" (
	"workspace_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"record_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"created_by_type" "actor_type" NOT NULL,
	"created_by_id" uuid,
	"created_by_member_id" uuid,
	CONSTRAINT "task_records_pkey" PRIMARY KEY("workspace_id","task_id","record_id"),
	CONSTRAINT "task_records_position" CHECK ("task_records"."position" >= 0),
	CONSTRAINT "task_records_created_by_actor" CHECK (("task_records"."created_by_type" is null and "task_records"."created_by_id" is null and "task_records"."created_by_member_id" is null)
      or ("task_records"."created_by_type" = 'system' and "task_records"."created_by_id" is null and "task_records"."created_by_member_id" is null)
      or ("task_records"."created_by_type" = 'member' and "task_records"."created_by_id" is not null and "task_records"."created_by_member_id" = "task_records"."created_by_id")
      or ("task_records"."created_by_type" in ('api_key', 'automation') and "task_records"."created_by_id" is not null and "task_records"."created_by_member_id" is null))
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"workspace_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"title" text NOT NULL,
	"is_done" boolean DEFAULT false NOT NULL,
	"done_at" timestamp (6) with time zone,
	"done_by_type" "actor_type",
	"done_by_id" uuid,
	"done_by_member_id" uuid,
	"due_on" date,
	"assignee_member_id" uuid,
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
	CONSTRAINT "tasks_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "tasks_title" CHECK (char_length("tasks"."title") between 1 and 2000),
	CONSTRAINT "tasks_done" CHECK ("tasks"."is_done" = ("tasks"."done_at" is not null)),
	CONSTRAINT "tasks_done_actor" CHECK (("tasks"."done_at" is null) = ("tasks"."done_by_type" is null)),
	CONSTRAINT "tasks_deleted" CHECK (("tasks"."deleted_at" is null) = ("tasks"."deleted_by_type" is null)),
	CONSTRAINT "tasks_created_by_actor" CHECK (("tasks"."created_by_type" is null and "tasks"."created_by_id" is null and "tasks"."created_by_member_id" is null)
      or ("tasks"."created_by_type" = 'system' and "tasks"."created_by_id" is null and "tasks"."created_by_member_id" is null)
      or ("tasks"."created_by_type" = 'member' and "tasks"."created_by_id" is not null and "tasks"."created_by_member_id" = "tasks"."created_by_id")
      or ("tasks"."created_by_type" in ('api_key', 'automation') and "tasks"."created_by_id" is not null and "tasks"."created_by_member_id" is null)),
	CONSTRAINT "tasks_updated_by_actor" CHECK (("tasks"."updated_by_type" is null and "tasks"."updated_by_id" is null and "tasks"."updated_by_member_id" is null)
      or ("tasks"."updated_by_type" = 'system' and "tasks"."updated_by_id" is null and "tasks"."updated_by_member_id" is null)
      or ("tasks"."updated_by_type" = 'member' and "tasks"."updated_by_id" is not null and "tasks"."updated_by_member_id" = "tasks"."updated_by_id")
      or ("tasks"."updated_by_type" in ('api_key', 'automation') and "tasks"."updated_by_id" is not null and "tasks"."updated_by_member_id" is null)),
	CONSTRAINT "tasks_done_by_actor" CHECK (("tasks"."done_by_type" is null and "tasks"."done_by_id" is null and "tasks"."done_by_member_id" is null)
      or ("tasks"."done_by_type" = 'system' and "tasks"."done_by_id" is null and "tasks"."done_by_member_id" is null)
      or ("tasks"."done_by_type" = 'member' and "tasks"."done_by_id" is not null and "tasks"."done_by_member_id" = "tasks"."done_by_id")
      or ("tasks"."done_by_type" in ('api_key', 'automation') and "tasks"."done_by_id" is not null and "tasks"."done_by_member_id" is null)),
	CONSTRAINT "tasks_deleted_by_actor" CHECK (("tasks"."deleted_by_type" is null and "tasks"."deleted_by_id" is null and "tasks"."deleted_by_member_id" is null)
      or ("tasks"."deleted_by_type" = 'system' and "tasks"."deleted_by_id" is null and "tasks"."deleted_by_member_id" is null)
      or ("tasks"."deleted_by_type" = 'member' and "tasks"."deleted_by_id" is not null and "tasks"."deleted_by_member_id" = "tasks"."deleted_by_id")
      or ("tasks"."deleted_by_type" in ('api_key', 'automation') and "tasks"."deleted_by_id" is not null and "tasks"."deleted_by_member_id" is null))
);
--> statement-breakpoint
ALTER TABLE "task_records" ADD CONSTRAINT "task_records_task" FOREIGN KEY ("workspace_id","task_id") REFERENCES "public"."tasks"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_records" ADD CONSTRAINT "task_records_record" FOREIGN KEY ("workspace_id","record_id") REFERENCES "public"."records"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_records" ADD CONSTRAINT "task_records_created_by" FOREIGN KEY ("workspace_id","created_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee" FOREIGN KEY ("workspace_id","assignee_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by" FOREIGN KEY ("workspace_id","created_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_updated_by" FOREIGN KEY ("workspace_id","updated_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_done_by" FOREIGN KEY ("workspace_id","done_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_deleted_by" FOREIGN KEY ("workspace_id","deleted_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_records_by_record" ON "task_records" USING btree ("workspace_id","record_id","created_at" DESC NULLS LAST,"task_id");--> statement-breakpoint
CREATE INDEX "tasks_assigned_open" ON "tasks" USING btree ("workspace_id","assignee_member_id","due_on","created_at","id") WHERE "tasks"."deleted_at" is null and not "tasks"."is_done";--> statement-breakpoint
CREATE INDEX "tasks_created_open" ON "tasks" USING btree ("workspace_id","created_by_member_id","due_on","created_at","id") WHERE "tasks"."deleted_at" is null and not "tasks"."is_done";--> statement-breakpoint
CREATE INDEX "tasks_all_open" ON "tasks" USING btree ("workspace_id","due_on","created_at","id") WHERE "tasks"."deleted_at" is null and not "tasks"."is_done";--> statement-breakpoint
CREATE INDEX "tasks_assigned_done" ON "tasks" USING btree ("workspace_id","assignee_member_id","done_at" DESC NULLS LAST,"id") WHERE "tasks"."deleted_at" is null and "tasks"."is_done";--> statement-breakpoint
CREATE INDEX "tasks_created_done" ON "tasks" USING btree ("workspace_id","created_by_member_id","done_at" DESC NULLS LAST,"id") WHERE "tasks"."deleted_at" is null and "tasks"."is_done";--> statement-breakpoint
CREATE INDEX "tasks_all_done" ON "tasks" USING btree ("workspace_id","done_at" DESC NULLS LAST,"id") WHERE "tasks"."deleted_at" is null and "tasks"."is_done";--> statement-breakpoint
CREATE INDEX "tasks_trashed" ON "tasks" USING btree ("workspace_id","deleted_at") WHERE "tasks"."deleted_at" is not null;
--> statement-breakpoint

-- Hand written from here.
-- The standard policy: an unset workspace matches nothing, even for the owner.
alter table tasks enable row level security;
--> statement-breakpoint
alter table tasks force row level security;
--> statement-breakpoint
create policy tasks_tenant on tasks
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
alter table task_records enable row level security;
--> statement-breakpoint
alter table task_records force row level security;
--> statement-breakpoint
create policy task_records_tenant on task_records
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);