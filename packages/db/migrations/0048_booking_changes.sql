ALTER TABLE "bookings" ADD COLUMN "manage_token_derived" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "cancelled_at" timestamp (6) with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "cancelled_by" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "previous_starts_at" timestamp (6) with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_cancelled_by" CHECK (("bookings"."cancelled_by" is null and "bookings"."cancelled_at" is null) or ("bookings"."status" = 'cancelled' and "bookings"."cancelled_by" in ('guest', 'host', 'calendar') and "bookings"."cancelled_at" is not null));--> statement-breakpoint

-- Puts a booking's email on Graphile Worker's queue (spec 0025, milestone 2): how the app reaches the queue for
-- booking mail, as crm_enqueue_calendar_sync does for calendar sync, owned by the same crm_queue. It reads the
-- booking under the caller's workspace setting (row level security still applies, crm_queue bypasses nothing). It
-- builds the queue row itself, so the caller chooses only the kind: task crm_booking_mail, payload the workspace
-- and booking ids and the kind, 5 attempts. `confirmed`, `cancelled`, `moved` and `guests` run now, each its own
-- row. `reminder_24h` and `reminder_1h` run that long before the booking starts, keyed by booking and kind with
-- job_key_mode 'replace', so a move replaces them; a reminder whose time has passed is not queued (AC-637), and one
-- left for a booking that was cancelled finds it cancelled and sends nothing (crm_queue never deletes). Answers
-- whether it queued. Quoted and fully qualified for the reasons crm_enqueue_job's comment gives.
create function crm_enqueue_booking_mail(booking_id uuid, kind text)
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
        else pg_catalog.now()
      end as run_at
    from public.bookings b
    where b.id = crm_enqueue_booking_mail.booking_id
      and b.workspace_id = nullif(pg_catalog.current_setting('app.workspace_id', true), '')::uuid
      and crm_enqueue_booking_mail.kind in ('confirmed', 'cancelled', 'moved', 'guests', 'reminder_24h', 'reminder_1h')
      and (b.status = 'confirmed' or crm_enqueue_booking_mail.kind = 'cancelled')
  ),
  added as materialized (
    select graphile_worker.add_job(
      identifier => 'crm_booking_mail',
      payload => pg_catalog.json_build_object(
        'workspaceId', booking.workspace_id, 'bookingId', booking.id, 'kind', crm_enqueue_booking_mail.kind
      ),
      run_at => booking.run_at,
      max_attempts => 5,
      job_key => case when crm_enqueue_booking_mail.kind like 'reminder_%'
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
revoke all on function crm_enqueue_booking_mail(uuid, text) from public;
--> statement-breakpoint
grant execute on function crm_enqueue_booking_mail(uuid, text) to crm_app;
--> statement-breakpoint
-- The four columns the function reads, and nothing else of the table.
grant select (workspace_id, id, status, starts_at) on bookings to crm_queue;
--> statement-breakpoint
grant crm_queue to current_user with inherit false, set true;
--> statement-breakpoint
grant create on schema public to crm_queue;
--> statement-breakpoint
alter function crm_enqueue_booking_mail(uuid, text) owner to crm_queue;
--> statement-breakpoint
revoke create on schema public from crm_queue;
--> statement-breakpoint
revoke crm_queue from current_user;
