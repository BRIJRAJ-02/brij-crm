-- A meeting link added by hand (bookings fix lane O, B-07, 4 November 2026): `meeting_link` emails the guest and their
-- guests the link a host pasted on the booking's panel, for a video call no calendar made one for. The function stays
-- crm_queue's (0048, 0073, 0167), replaced the same way with every kind kept and one added: the migration's role holds
-- crm_queue's rights just long enough, then gives them back.
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
      and crm_enqueue_booking_mail.kind in ('confirmed', 'cancelled', 'moved', 'guests', 'reassigned', 'needs_host', 'host_changed', 'reminder_24h', 'reminder_1h', 'requested', 'approved', 'declined', 'pending_expire', 'meeting_link')
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
