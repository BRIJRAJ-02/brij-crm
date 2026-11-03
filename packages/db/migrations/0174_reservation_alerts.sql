-- A member's new reservation emails at a place (spec 0066 B7 lite; 4 November 2026).
--
-- One row per member and place once they choose: on or off. No row is the default, on for the workspace's owner
-- and off for everyone else, so a new restaurant hears of its first online reservation without setting anything. Only a
-- member who can Run service (`hospitality.service`) is ever emailed; the code checks that when it sends.
--
-- A tenant table: forced row level security and the standard workspace policy. Grants reach crm_app through the
-- default privileges.
set local lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE "reservation_alerts" (
	"workspace_id" uuid NOT NULL,
	"place_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"enabled" boolean NOT NULL,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservation_alerts_pkey" PRIMARY KEY("workspace_id","place_id","member_id")
);
--> statement-breakpoint
ALTER TABLE "reservation_alerts" ADD CONSTRAINT "reservation_alerts_place" FOREIGN KEY ("workspace_id","place_id") REFERENCES "public"."places"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_alerts" ADD CONSTRAINT "reservation_alerts_member" FOREIGN KEY ("workspace_id","member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reservation_alerts_member" ON "reservation_alerts" USING btree ("workspace_id","member_id");--> statement-breakpoint

alter table reservation_alerts enable row level security;
--> statement-breakpoint
alter table reservation_alerts force row level security;
--> statement-breakpoint
create policy reservation_alerts_tenant on reservation_alerts
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
