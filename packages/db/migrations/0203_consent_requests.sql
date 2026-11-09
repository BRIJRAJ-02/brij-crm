-- Double opt-in for news and offers on public reservations (9 November 2026). Numbered 0203: 0202 is held for
-- another lane.
--
-- A guest who ticks "Send me news and offers" on a reservation page no longer gives a consent there and then: the
-- tick is kept here as a request, and the guest gets an email with a signed link. Only opening that link and saying
-- yes writes the consent (`consent_records`, granted, source `appointment` and the visit), so a request never counts
-- anywhere consents are read: those read `consent_records`, and nothing here is in it. A request is confirmed once
-- (`confirmed_at`), and never after `expires_at`.
--
-- A tenant table: forced row level security and the standard workspace policy. Like every row hanging off a record
-- it restricts rather than cascades; the purge registry deletes a person's requests with them, a merge moves them
-- onto the person kept, and the daily cleanup deletes the ones that ran out unconfirmed.
--
-- Additive only: old code never reads the table, so the rollout and a rollback are safe. Postgres 17 compatible.
set local lock_timeout = '5s';
--> statement-breakpoint
create table consent_requests (
  workspace_id uuid not null,
  id uuid not null default uuidv7(),
  record_id uuid not null,
  purpose text not null,
  wording text not null,
  source_type text not null,
  source_id uuid not null,
  requested_at timestamp (6) with time zone not null default now(),
  expires_at timestamp (6) with time zone not null,
  confirmed_at timestamp (6) with time zone,
  constraint consent_requests_pkey primary key (workspace_id, id),
  constraint consent_requests_purpose check (purpose ~ '^[a-z][a-z0-9_]{0,39}$'),
  constraint consent_requests_wording check (char_length(wording) between 1 and 2000),
  constraint consent_requests_source check (source_type in ('appointment')),
  constraint consent_requests_expiry check (expires_at > requested_at)
);
--> statement-breakpoint
alter table consent_requests add constraint consent_requests_workspace foreign key (workspace_id)
  references workspaces (id) on delete cascade;
--> statement-breakpoint
-- No `on delete` action: the purge deletes these rows first, with the record's other links.
alter table consent_requests add constraint consent_requests_record foreign key (workspace_id, record_id)
  references records (workspace_id, id);
--> statement-breakpoint
-- One request per visit and purpose: a retried reservation asks once.
create unique index consent_requests_by_source on consent_requests using btree (workspace_id, source_id, purpose);
--> statement-breakpoint
-- The purge and the merge by record.
create index consent_requests_by_record on consent_requests using btree (workspace_id, record_id);
--> statement-breakpoint
-- The daily cleanup's sweep of requests that ran out unconfirmed.
create index consent_requests_open_expiry on consent_requests using btree (workspace_id, expires_at) where confirmed_at is null;
--> statement-breakpoint
alter table consent_requests enable row level security;
--> statement-breakpoint
alter table consent_requests force row level security;
--> statement-breakpoint
create policy consent_requests_tenant on consent_requests
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
-- The app inserts every column but `id`, `requested_at` and `confirmed_at` (the database's own times), may move a
-- row's `record_id` (a merge) and set `confirmed_at` (the confirm), and deletes (the purge, the daily cleanup).
revoke all on consent_requests from crm_app;
--> statement-breakpoint
grant select on consent_requests to crm_app;
--> statement-breakpoint
grant insert (workspace_id, record_id, purpose, wording, source_type, source_id, expires_at)
  on consent_requests to crm_app;
--> statement-breakpoint
grant update (record_id, confirmed_at) on consent_requests to crm_app;
--> statement-breakpoint
grant delete on consent_requests to crm_app;
