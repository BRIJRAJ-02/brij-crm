-- Publish for every public page (spec 0068, AC-6810 to AC-6816; 4 November 2026). Numbered 0171, after 0170's
-- templates (0166 to 0169 are claimed by other branches).
--
-- One pattern for every kind of page: an edit goes into the page row's `draft` (the changed settings only, by name,
-- with `draft_changed_at`), guests keep seeing the live columns, and Publish writes the draft into the live columns
-- and keeps a version here: who, when, and the published settings whole. The last 20 per page are kept (AC-6812).
-- Booking pages are the first kind; link, business and event pages plug into the same table by `page_kind`.
-- Forms keep their own tables (`form_versions`).
--
-- Every booking page that exists now is published as it is, as version 1 (AC-6814), so nothing changes for guests.
-- A tenant table: forced row level security and the plain workspace policy, every index leading with the workspace.
set local lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE "page_versions" (
	"workspace_id" uuid NOT NULL,
	"page_kind" text NOT NULL,
	"page_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"published_by_member_id" uuid,
	"published_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_versions_pkey" PRIMARY KEY("workspace_id","page_kind","page_id","version"),
	CONSTRAINT "page_versions_kind" CHECK ("page_versions"."page_kind" in ('booking', 'link', 'business', 'event')),
	CONSTRAINT "page_versions_version" CHECK ("page_versions"."version" >= 1),
	CONSTRAINT "page_versions_snapshot" CHECK (
		jsonb_typeof("page_versions"."snapshot") = 'object' and pg_column_size("page_versions"."snapshot") <= 65536
	)
);
--> statement-breakpoint
ALTER TABLE "page_versions" ADD CONSTRAINT "page_versions_workspace" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Who published, while they are a member; a member removed later leaves the version, named by nobody.
ALTER TABLE "page_versions" ADD CONSTRAINT "page_versions_published_by" FOREIGN KEY ("workspace_id","published_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE set null ("published_by_member_id") ON UPDATE no action;--> statement-breakpoint
-- A page's versions, newest first (the versions list, the next number and the prune).
CREATE INDEX "page_versions_newest" ON "page_versions" USING btree ("workspace_id","page_kind","page_id","version" DESC);--> statement-breakpoint
CREATE INDEX "page_versions_by_member" ON "page_versions" USING btree ("workspace_id","published_by_member_id") WHERE "published_by_member_id" is not null;--> statement-breakpoint

alter table page_versions enable row level security;
--> statement-breakpoint
alter table page_versions force row level security;
--> statement-breakpoint
create policy page_versions_tenant on page_versions
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint

-- A version is a record of what guests saw: the app adds and prunes them, and never rewrites one.
revoke all on page_versions from crm_app;
--> statement-breakpoint
grant select, insert, delete on page_versions to crm_app;
--> statement-breakpoint

-- The draft on the page row: the changed settings by name, at most 64 KB, and when it last changed. Both null when
-- there is nothing to publish.
ALTER TABLE "booking_pages" ADD COLUMN "draft" jsonb;--> statement-breakpoint
ALTER TABLE "booking_pages" ADD COLUMN "draft_changed_at" timestamp (6) with time zone;--> statement-breakpoint
ALTER TABLE "booking_pages" ADD CONSTRAINT "booking_pages_draft" CHECK (
	("booking_pages"."draft" is null) = ("booking_pages"."draft_changed_at" is null)
	and ("booking_pages"."draft" is null
		or (jsonb_typeof("booking_pages"."draft") = 'object' and pg_column_size("booking_pages"."draft") <= 65536))
);--> statement-breakpoint

-- Every page that exists now, published as it is (AC-6814): its guest facing settings, as `publishedSnapshot` in
-- `@crm/core` writes them, named by nobody. A managed template is not a page guests see, so it has none.
insert into page_versions (workspace_id, page_kind, page_id, version, snapshot, published_by_member_id, published_at)
select p.workspace_id, 'booking', p.id, 1,
  jsonb_build_object(
    'title', p.title,
    'description', p.description,
    'durations', to_jsonb(p.durations),
    'location', p.location,
    'bufferBefore', p.buffer_before,
    'bufferAfter', p.buffer_after,
    'minNoticeMinutes', p.min_notice_minutes,
    'windowDays', p.window_days,
    'dailyLimit', p.daily_limit,
    'slotStep', p.slot_step,
    'scheduleId', p.schedule_id,
    'defaultView', p.default_view,
    'showSocials', p.show_socials,
    'questions', p.questions
  ),
  null, p.updated_at
from booking_pages p
where p.deleted_at is null and p.kind <> 'managed';
