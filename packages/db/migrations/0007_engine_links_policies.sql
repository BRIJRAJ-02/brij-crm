-- Hand written: row level security for relationships, links, lists and entries (spec 0004).
alter table relationships enable row level security;
--> statement-breakpoint
alter table relationships force row level security;
--> statement-breakpoint
create policy relationships_tenant on relationships
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint

alter table lists enable row level security;
--> statement-breakpoint
alter table lists force row level security;
--> statement-breakpoint
create policy lists_tenant on lists
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint

alter table list_entries enable row level security;
--> statement-breakpoint
alter table list_entries force row level security;
--> statement-breakpoint
create policy list_entries_tenant on list_entries
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint

alter table record_links enable row level security;
--> statement-breakpoint
alter table record_links force row level security;
--> statement-breakpoint
create policy record_links_tenant on record_links
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint

-- Links churn like values: every change ends a row and starts one.
alter table record_links set (fillfactor = 80, autovacuum_vacuum_scale_factor = 0.01, autovacuum_analyze_scale_factor = 0.02);
