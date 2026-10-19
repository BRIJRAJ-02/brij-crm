-- Calendar quick actions (spec 0027): `booking_time_blocks`, the time a member closed on their own calendar (a block
-- for every page, a hold for every page but a private one), once as an absolute span or every week as local minutes,
-- and `booking_pages.is_private`. The standard tenant policy is hand written at the end.
--
-- The foreign keys briefly lock the tables they touch. Give up after 5 seconds rather than queue behind traffic, like
-- 0041.
set local lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE "booking_time_blocks" (
	"workspace_id" uuid NOT NULL,
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"member_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"repeat" text NOT NULL,
	"during" "tstzrange",
	"weekday" smallint,
	"start_minute" smallint,
	"end_minute" smallint,
	"time_zone" text,
	"from_date" date,
	"page_id" uuid,
	"label" text,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"created_by_type" "actor_type" NOT NULL,
	"created_by_id" uuid,
	"created_by_member_id" uuid,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_by_type" "actor_type" NOT NULL,
	"updated_by_id" uuid,
	"updated_by_member_id" uuid,
	CONSTRAINT "booking_time_blocks_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "booking_time_blocks_kind" CHECK ("booking_time_blocks"."kind" in ('block', 'hold')),
	CONSTRAINT "booking_time_blocks_shape" CHECK (("booking_time_blocks"."repeat" = 'once' and "booking_time_blocks"."during" is not null and not isempty("booking_time_blocks"."during") and lower_inc("booking_time_blocks"."during") and not upper_inc("booking_time_blocks"."during")
        and "booking_time_blocks"."weekday" is null and "booking_time_blocks"."start_minute" is null and "booking_time_blocks"."end_minute" is null and "booking_time_blocks"."time_zone" is null and "booking_time_blocks"."from_date" is null)
      or ("booking_time_blocks"."repeat" = 'weekly' and "booking_time_blocks"."kind" = 'block' and "booking_time_blocks"."during" is null and "booking_time_blocks"."weekday" between 0 and 6
        and "booking_time_blocks"."start_minute" >= 0 and "booking_time_blocks"."end_minute" > "booking_time_blocks"."start_minute" and "booking_time_blocks"."end_minute" <= 1440
        and "booking_time_blocks"."time_zone" is not null and "booking_time_blocks"."from_date" is not null)),
	CONSTRAINT "booking_time_blocks_page" CHECK ("booking_time_blocks"."page_id" is null or "booking_time_blocks"."kind" = 'hold'),
	CONSTRAINT "booking_time_blocks_label" CHECK ("booking_time_blocks"."label" is null or char_length("booking_time_blocks"."label") between 1 and 200),
	CONSTRAINT "booking_time_blocks_created_by_actor" CHECK (("booking_time_blocks"."created_by_type" is null and "booking_time_blocks"."created_by_id" is null and "booking_time_blocks"."created_by_member_id" is null)
      or ("booking_time_blocks"."created_by_type" = 'system' and "booking_time_blocks"."created_by_id" is null and "booking_time_blocks"."created_by_member_id" is null)
      or ("booking_time_blocks"."created_by_type" = 'member' and "booking_time_blocks"."created_by_id" is not null and "booking_time_blocks"."created_by_member_id" = "booking_time_blocks"."created_by_id")
      or ("booking_time_blocks"."created_by_type"::text not in ('member', 'system', 'calendar') and "booking_time_blocks"."created_by_id" is not null and "booking_time_blocks"."created_by_member_id" is null)),
	CONSTRAINT "booking_time_blocks_updated_by_actor" CHECK (("booking_time_blocks"."updated_by_type" is null and "booking_time_blocks"."updated_by_id" is null and "booking_time_blocks"."updated_by_member_id" is null)
      or ("booking_time_blocks"."updated_by_type" = 'system' and "booking_time_blocks"."updated_by_id" is null and "booking_time_blocks"."updated_by_member_id" is null)
      or ("booking_time_blocks"."updated_by_type" = 'member' and "booking_time_blocks"."updated_by_id" is not null and "booking_time_blocks"."updated_by_member_id" = "booking_time_blocks"."updated_by_id")
      or ("booking_time_blocks"."updated_by_type"::text not in ('member', 'system', 'calendar') and "booking_time_blocks"."updated_by_id" is not null and "booking_time_blocks"."updated_by_member_id" is null))
);
--> statement-breakpoint
ALTER TABLE "booking_pages" ADD COLUMN "is_private" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "booking_time_blocks" ADD CONSTRAINT "booking_time_blocks_member" FOREIGN KEY ("workspace_id","member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_time_blocks" ADD CONSTRAINT "booking_time_blocks_created_by" FOREIGN KEY ("workspace_id","created_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_time_blocks" ADD CONSTRAINT "booking_time_blocks_updated_by" FOREIGN KEY ("workspace_id","updated_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "booking_time_blocks_weekly" ON "booking_time_blocks" USING btree ("workspace_id","member_id") WHERE "booking_time_blocks"."repeat" = 'weekly';
--> statement-breakpoint
alter table booking_time_blocks enable row level security;
--> statement-breakpoint
alter table booking_time_blocks force row level security;
--> statement-breakpoint
create policy booking_time_blocks_tenant on booking_time_blocks
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
