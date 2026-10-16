-- The view each member last opened per object (spec 0020, milestone 2, AC-478), so another browser or device
-- opens the same one. A member's own bookmark: no outbox row, and gone with its view (cascade) or the member's
-- removal (`deleteMemberViews`). The table, keys and index are drizzle-kit's; row level security is hand written
-- at the end.
--
-- The foreign keys briefly lock members and views against writes. Give up after 5 seconds rather than queue
-- behind traffic, like 0035 and 0037.
set local lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE "member_view_state" (
	"workspace_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"parent_id" uuid NOT NULL,
	"view_id" uuid NOT NULL,
	"opened_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_view_state_pkey" PRIMARY KEY("workspace_id","member_id","parent_id")
);
--> statement-breakpoint
ALTER TABLE "member_view_state" ADD CONSTRAINT "member_view_state_member" FOREIGN KEY ("workspace_id","member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_view_state" ADD CONSTRAINT "member_view_state_view" FOREIGN KEY ("workspace_id","view_id") REFERENCES "public"."views"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "member_view_state_by_view" ON "member_view_state" USING btree ("workspace_id","view_id");
--> statement-breakpoint

-- Hand written from here.
-- The standard policy: an unset workspace matches nothing, even for the owner.
alter table member_view_state enable row level security;
--> statement-breakpoint
alter table member_view_state force row level security;
--> statement-breakpoint
create policy member_view_state_tenant on member_view_state
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
