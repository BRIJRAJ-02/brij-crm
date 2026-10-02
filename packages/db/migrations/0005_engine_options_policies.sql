-- Hand written: row level security for attribute options (spec 0004).
alter table attribute_options enable row level security;
--> statement-breakpoint
alter table attribute_options force row level security;
--> statement-breakpoint
create policy attribute_options_tenant on attribute_options
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
