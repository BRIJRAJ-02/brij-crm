-- Booking flow rules (spec 0062, L1, 3 November 2026).
--
-- NUMBERING: 0167, because 0165 and 0166 are held by two other unlanded lanes (form consent, data retention). If
-- this lands before them, renumber it after main's last and restamp its journal `when` immediately before it lands
-- (`pnpm --filter @crm/db check:journal origin/main`).
--
-- What changes, all additive with defaults that are exactly today's behaviour, so
-- nothing is backfilled and a page nobody edits behaves as it did (AC-6220):
-- * `after_booking` ('confirmation' or 'redirect') and `redirect_url`: what the page does once a booking commits.
--   The two are paired by a check, because a redirect page with no address would strand every visitor.
-- * `send_booking_details`: whether that redirect carries name, email, start, tz and page as query values. Off by
--   default: it puts the visitor's name and address into the host's own server logs.
-- * `cancel_cutoff_minutes` and `move_cutoff_minutes`: how long before the start a guest may no longer change the
--   booking, 0 to 20160 (14 days). 0, the default, is what every page did before. The host's own cancel and move
--   ignore them, so these never block the people who own the page.
--
-- Postgres 17 compatible: no 18 only built ins.
set local lock_timeout = '5s';
--> statement-breakpoint
alter table "public"."booking_pages"
  add column "after_booking" text not null default 'confirmation',
  add column "redirect_url" text,
  add column "send_booking_details" boolean not null default false,
  add column "cancel_cutoff_minutes" integer not null default 0,
  add column "move_cutoff_minutes" integer not null default 0;
--> statement-breakpoint
alter table "public"."booking_pages"
  add constraint "booking_pages_after" check ("after_booking" in ('confirmation', 'redirect'));
--> statement-breakpoint
alter table "public"."booking_pages"
  add constraint "booking_pages_redirect" check (
    ("after_booking" = 'redirect') = ("redirect_url" is not null)
    and ("redirect_url" is null or char_length("redirect_url") <= 2048)
  );
--> statement-breakpoint
alter table "public"."booking_pages"
  add constraint "booking_pages_cutoffs" check (
    "cancel_cutoff_minutes" between 0 and 20160 and "move_cutoff_minutes" between 0 and 20160
  );
--> statement-breakpoint
-- Requires confirmation (AC-6203). A booking on such a page starts `approval = 'pending'` and keeps `status =
-- 'confirmed'`, so it holds its slot through every read and the exclusion constraints that already guard a
-- confirmed booking, with nothing to widen. It stays off the host's calendar and gets no confirmation or reminders
-- until the host confirms (`approval = 'approved'`). A decline, by the host or by the expiry job, cancels it
-- (`status = 'cancelled'`, `approval = 'declined'`), which frees the slot the way any cancel does. Null is a
-- booking on a page that never asked, which is every booking before this migration.
alter table "public"."booking_pages"
  add column "requires_confirmation" boolean not null default false,
  -- Books only through one-time links (AC-6204): the page's own address then answers "by invitation".
  add column "links_only" boolean not null default false;
--> statement-breakpoint
alter table "public"."bookings"
  add column "approval" text,
  add column "decided_at" timestamp (6) with time zone,
  add column "decided_by_member_id" uuid,
  add column "decline_reason" text,
  add column "one_off_link_id" uuid;
--> statement-breakpoint
alter table "public"."bookings"
  add constraint "bookings_approval" check ("approval" is null or "approval" in ('pending', 'approved', 'declined'));
--> statement-breakpoint
-- A decision is stamped exactly when one was made; the expiry job decides with no member.
alter table "public"."bookings"
  add constraint "bookings_decided" check (
    ("decided_at" is null) = ("approval" is null or "approval" = 'pending')
    and ("decided_by_member_id" is null or "decided_at" is not null)
  );
--> statement-breakpoint
alter table "public"."bookings"
  add constraint "bookings_declined" check (
    ("approval" is distinct from 'declined' or "status" = 'cancelled')
    and ("decline_reason" is null or ("approval" = 'declined' and char_length("decline_reason") <= 500))
  );
--> statement-breakpoint
alter table "public"."bookings"
  add constraint "bookings_decided_by" foreign key ("workspace_id", "decided_by_member_id")
  references "public"."members" ("workspace_id", "id") on delete no action;
--> statement-breakpoint
-- The pending bookings in a range: the expiry sweep and the host's list of requests.
create index "bookings_pending" on "public"."bookings" ("workspace_id", "starts_at") where "approval" = 'pending';
--> statement-breakpoint
-- One off links (AC-6204): a link that books its page a set number of times, then shows "This link has been used".
-- The token is 32 random bytes the host copies once; only its SHA-256 is kept, and it travels in the address's
-- fragment, so it never reaches a server log or a Referer. A use is counted when the booking commits, under the
-- page's booking lock, so two visitors racing the last use can't both book.
create table "public"."booking_page_links" (
  "workspace_id" uuid not null,
  "id" uuid default uuidv7() not null,
  "page_id" uuid not null,
  "label" text,
  "token_hash" text not null,
  "max_uses" smallint not null default 1,
  "uses" smallint not null default 0,
  "expires_at" timestamp (6) with time zone,
  "revoked_at" timestamp (6) with time zone,
  "created_by_member_id" uuid not null,
  -- The write that made it: a retry of the same New link finds this one instead of making a second.
  "mutation_id" uuid not null,
  "created_at" timestamp (6) with time zone default now() not null,
  constraint "booking_page_links_pkey" primary key ("workspace_id", "id"),
  constraint "booking_page_links_label" check ("label" is null or char_length("label") between 1 and 60),
  constraint "booking_page_links_token" check ("token_hash" ~ '^[0-9a-f]{64}$'),
  constraint "booking_page_links_uses" check ("max_uses" between 1 and 50 and "uses" between 0 and "max_uses")
);
--> statement-breakpoint
alter table "public"."booking_page_links" add constraint "booking_page_links_workspace" foreign key ("workspace_id")
  references "public"."workspaces" ("id") on delete cascade;
--> statement-breakpoint
alter table "public"."booking_page_links" add constraint "booking_page_links_page" foreign key ("workspace_id", "page_id")
  references "public"."booking_pages" ("workspace_id", "id") on delete cascade;
--> statement-breakpoint
alter table "public"."booking_page_links" add constraint "booking_page_links_created_by"
  foreign key ("workspace_id", "created_by_member_id") references "public"."members" ("workspace_id", "id") on delete no action;
--> statement-breakpoint
create unique index "booking_page_links_token_hash" on "public"."booking_page_links" ("workspace_id", "token_hash");
--> statement-breakpoint
create unique index "booking_page_links_mutation" on "public"."booking_page_links" ("workspace_id", "mutation_id");
--> statement-breakpoint
create index "booking_page_links_by_page" on "public"."booking_page_links" ("workspace_id", "page_id", "created_at");
--> statement-breakpoint
alter table "public"."booking_page_links" enable row level security;
--> statement-breakpoint
alter table "public"."booking_page_links" force row level security;
--> statement-breakpoint
create policy "booking_page_links_tenant" on "public"."booking_page_links"
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
alter table "public"."bookings" add constraint "bookings_one_off_link" foreign key ("workspace_id", "one_off_link_id")
  references "public"."booking_page_links" ("workspace_id", "id") on delete set null ("one_off_link_id");
--> statement-breakpoint
-- A request's emails and its wait (AC-6203): `requested` tells the visitor "Request received" and asks the host;
-- `approved` makes the confirmed booking's calendar event in the worker, then its confirmation; `declined` tells the
-- visitor, after the booking is cancelled; `pending_expire` runs at the earlier of 24 hours after the request and 1
-- hour before the start, and declines it if nobody answered. The function stays crm_queue's (0048, 0073), replaced
-- the same way: the migration's role holds crm_queue's rights just long enough, then gives them back.
-- The wait is timed from when the request was made, so the queue's role reads that one more column.
grant select (created_at) on bookings to crm_queue;
--> statement-breakpoint
grant crm_queue to current_user with inherit true, set false;
--> statement-breakpoint
create or replace function crm_enqueue_booking_mail(booking_id uuid, kind text)
  returns boolean
  language sql
  volatile
  security definer
  set search_path = pg_catalog, pg_temp
as $function$
  with booking as (
    select b.workspace_id, b.id,
      case crm_enqueue_booking_mail.kind
        when 'reminder_24h' then b.starts_at - interval '24 hours'
        when 'reminder_1h' then b.starts_at - interval '1 hour'
        -- Never sooner than five minutes from now, so a request made close to its start isn't declined at once.
        when 'pending_expire' then greatest(
          pg_catalog.now() + interval '5 minutes',
          least(b.created_at + interval '24 hours', b.starts_at - interval '1 hour')
        )
        else pg_catalog.now()
      end as run_at
    from public.bookings b
    where b.id = crm_enqueue_booking_mail.booking_id
      and b.workspace_id = nullif(pg_catalog.current_setting('app.workspace_id', true), '')::uuid
      and crm_enqueue_booking_mail.kind in ('confirmed', 'cancelled', 'moved', 'guests', 'reassigned', 'needs_host', 'host_changed', 'reminder_24h', 'reminder_1h', 'requested', 'approved', 'declined', 'pending_expire')
      and (b.status = 'confirmed' or crm_enqueue_booking_mail.kind in ('cancelled', 'declined'))
  ),
  added as materialized (
    select graphile_worker.add_job(
      identifier => 'crm_booking_mail',
      payload => pg_catalog.json_build_object(
        'workspaceId', booking.workspace_id, 'bookingId', booking.id, 'kind', crm_enqueue_booking_mail.kind
      ),
      run_at => booking.run_at,
      max_attempts => 5,
      job_key => case when crm_enqueue_booking_mail.kind like 'reminder_%' or crm_enqueue_booking_mail.kind = 'pending_expire'
        then 'crm-booking:' || booking.workspace_id::text || ':' || booking.id::text || ':' || crm_enqueue_booking_mail.kind
      end,
      job_key_mode => 'replace'
    ) as queued
    from booking
    where crm_enqueue_booking_mail.kind not like 'reminder_%' or booking.run_at > pg_catalog.now()
  )
  select count(*) = 1 from added;
$function$;
--> statement-breakpoint
revoke crm_queue from current_user;
