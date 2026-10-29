-- The member told (spec 0037, AC-1264): puts a member's scheduling notice on Graphile Worker's queue, as
-- crm_enqueue_notification_email does for the notifications email, owned by the same crm_queue. It reads both
-- members under the caller's workspace setting (row level security still applies), and only when both are active and
-- different. It builds the queue row itself, so the caller chooses no task, payload or queue: task
-- crm_scheduling_notice, payload the workspace, actor and member ids alone, run 10 minutes from now, job key
-- scheduling-notice:<workspace>:<actor>:<member> with job_key_mode 'preserve_run_at', so ten minutes of one person's
-- changes to another's scheduling are one waiting row that keeps its first time, and 5 attempts. Answers whether it
-- queued.
create function crm_enqueue_scheduling_notice(actor_member_id uuid, member_id uuid)
  returns boolean
  language sql
  volatile
  security definer
  set search_path = pg_catalog, pg_temp
as $function$
  with pair as (
    select m.workspace_id, a.id as actor_id, m.id as member_id
    from public.members m
    join public.members a on a.workspace_id = m.workspace_id
      and a.id = crm_enqueue_scheduling_notice.actor_member_id and a.status = 'active'
    where m.id = crm_enqueue_scheduling_notice.member_id
      and m.workspace_id = nullif(pg_catalog.current_setting('app.workspace_id', true), '')::uuid
      and m.status = 'active'
      and m.id <> a.id
  ),
  added as materialized (
    select graphile_worker.add_job(
      identifier => 'crm_scheduling_notice',
      payload => pg_catalog.json_build_object(
        'workspaceId', pair.workspace_id, 'actorMemberId', pair.actor_id, 'memberId', pair.member_id
      ),
      run_at => pg_catalog.now() + interval '10 minutes',
      max_attempts => 5,
      job_key => 'scheduling-notice:' || pair.workspace_id::text || ':' || pair.actor_id::text || ':'
        || pair.member_id::text,
      job_key_mode => 'preserve_run_at'
    ) as queued
    from pair
  )
  select count(*) = 1 from added;
$function$;
--> statement-breakpoint
revoke all on function crm_enqueue_scheduling_notice(uuid, uuid) from public;
--> statement-breakpoint
grant execute on function crm_enqueue_scheduling_notice(uuid, uuid) to crm_app;
--> statement-breakpoint
grant crm_queue to current_user with inherit false, set true;
--> statement-breakpoint
grant create on schema public to crm_queue;
--> statement-breakpoint
alter function crm_enqueue_scheduling_notice(uuid, uuid) owner to crm_queue;
--> statement-breakpoint
revoke create on schema public from crm_queue;
--> statement-breakpoint
revoke crm_queue from current_user;
