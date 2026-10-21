-- Lead routing (spec 0043): routing_decisions (one row per decision, for each rule's report), a team page's rules
-- (booking_pages.routing), and a booking's no show mark (bookings.no_show_at, no_show_by_member_id). Tables, keys and
-- indexes are drizzle-kit's; row level security is hand written at the end.
CREATE TABLE "routing_decisions" (
	"workspace_id" uuid NOT NULL,
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"surface_kind" text NOT NULL,
	"surface_id" uuid NOT NULL,
	"rule_id" text,
	"qualified" boolean,
	"skipped" text[] DEFAULT '{}'::text[] NOT NULL,
	"submission_id" uuid,
	"routed_page_id" uuid,
	"hosts" uuid[],
	"booking_id" uuid,
	"decided_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "routing_decisions_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "routing_decisions_surface" CHECK ("routing_decisions"."surface_kind" in ('form', 'booking_page')),
	CONSTRAINT "routing_decisions_submission" CHECK (("routing_decisions"."surface_kind" = 'form') = ("routing_decisions"."submission_id" is not null)),
	CONSTRAINT "routing_decisions_hosts" CHECK ("routing_decisions"."hosts" is null or cardinality("routing_decisions"."hosts") between 1 and 8)
);
--> statement-breakpoint
ALTER TABLE "booking_pages" ADD COLUMN "routing" jsonb DEFAULT '{"rules":[]}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "no_show_at" timestamp (6) with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "no_show_by_member_id" uuid;--> statement-breakpoint
ALTER TABLE "routing_decisions" ADD CONSTRAINT "routing_decisions_booking" FOREIGN KEY ("workspace_id","booking_id") REFERENCES "public"."bookings"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routing_decisions" ADD CONSTRAINT "routing_decisions_routed_page" FOREIGN KEY ("workspace_id","routed_page_id") REFERENCES "public"."booking_pages"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "routing_decisions_by_surface" ON "routing_decisions" USING btree ("workspace_id","surface_id","decided_at");--> statement-breakpoint
CREATE INDEX "routing_decisions_by_submission" ON "routing_decisions" USING btree ("workspace_id","submission_id") WHERE "routing_decisions"."submission_id" is not null;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_no_show_by" FOREIGN KEY ("workspace_id","no_show_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_no_show" CHECK (("bookings"."no_show_at" is null) = ("bookings"."no_show_by_member_id" is null));
--> statement-breakpoint
-- Hand written from here.
-- The standard policy: an unset workspace matches nothing, even for the owner.
alter table routing_decisions enable row level security;
--> statement-breakpoint
alter table routing_decisions force row level security;
--> statement-breakpoint
create policy routing_decisions_tenant on routing_decisions
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
