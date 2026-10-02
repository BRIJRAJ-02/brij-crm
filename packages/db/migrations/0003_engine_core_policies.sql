-- Hand written: row level security for the engine's first tables (spec 0004).
-- Every table forces it, so even the owner's connections go through the policy,
-- and each policy is the plain comparison: an unset workspace matches nothing.

alter table workspaces enable row level security;
--> statement-breakpoint
alter table workspaces force row level security;
--> statement-breakpoint
create policy workspaces_tenant on workspaces
  using (id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint

alter table workspace_counters enable row level security;
--> statement-breakpoint
alter table workspace_counters force row level security;
--> statement-breakpoint
create policy workspace_counters_tenant on workspace_counters
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint

alter table members enable row level security;
--> statement-breakpoint
alter table members force row level security;
--> statement-breakpoint
create policy members_tenant on members
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint

alter table objects enable row level security;
--> statement-breakpoint
alter table objects force row level security;
--> statement-breakpoint
create policy objects_tenant on objects
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint

alter table attributes enable row level security;
--> statement-breakpoint
alter table attributes force row level security;
--> statement-breakpoint
create policy attributes_tenant on attributes
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint

alter table records enable row level security;
--> statement-breakpoint
alter table records force row level security;
--> statement-breakpoint
create policy records_tenant on records
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint

alter table "values" enable row level security;
--> statement-breakpoint
alter table "values" force row level security;
--> statement-breakpoint
create policy values_tenant on "values"
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint

-- Every edit moves rows out of the current value indexes, so dead entries pile
-- up fast. Leave room on each page and vacuum early.
alter table "values" set (fillfactor = 80, autovacuum_vacuum_scale_factor = 0.01, autovacuum_analyze_scale_factor = 0.02);
