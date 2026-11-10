-- Unsubscribing from news and offers (10 November 2026). Numbered 0204.
--
-- A guest who said yes to a business's news and offers can take it back from any email that business sends them: a
-- one click unsubscribe (RFC 8058's `List-Unsubscribe`, posted by the mail service) or the footer's link. Either
-- writes a withdrawal into `consent_records` the way every consent is written, a new row saying no, so the person's
-- latest row for the purpose is their answer. Its source is the new `email_link`: the inbox owner, from a signed link
-- in an email, with no source row (`source_id` null).
--
-- Subscribing again goes back through the double opt-in (migration 0202): a request in `consent_requests` with the
-- same source, `email_link`, naming the withdrawal it follows (`source_id`), so one withdrawal asks at most once, and
-- the consent its confirm writes carries the same source.
--
-- Constraint changes only: old code never writes `email_link`, so the rollout and a rollback are safe. Postgres 17
-- compatible.
set local lock_timeout = '5s';
--> statement-breakpoint
alter table consent_records drop constraint consent_records_source;
--> statement-breakpoint
alter table consent_records add constraint consent_records_source check (
  source_type in ('submission', 'member', 'site', 'appointment', 'event_registration', 'email_link')
  and (source_type <> 'submission' or (source_id is not null and question_id is not null))
);
--> statement-breakpoint
alter table consent_requests drop constraint consent_requests_source;
--> statement-breakpoint
alter table consent_requests add constraint consent_requests_source check (source_type in ('appointment', 'email_link'));
