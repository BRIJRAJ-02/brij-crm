-- Full workspace export (scope #37's export half, lane wip/crm-dataio, 31 Oct 2026). PLACEHOLDER number: renumber
-- after main's last migration at landing, and stamp its journal `when` with the time then.
--
-- An owner's "Export everything" is one more `exports` row (`source = 'workspace'`): its files' text goes into the
-- same `export_chunks` while the `workspace.export` job writes it, then the job zips them into the private file
-- store at `storage_path` and drops the chunks. The row's tenancy, row level security and cleanup are the table's
-- own (the daily cleanup removes the stored zip before the row). Expand only: old code never writes `workspace`.
ALTER TABLE "exports" ADD COLUMN "storage_path" text;--> statement-breakpoint
ALTER TABLE "exports" DROP CONSTRAINT "exports_source";--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "exports_source" CHECK ("exports"."source" in ('form_submissions', 'records', 'workspace'));--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "exports_workspace_source" CHECK (("exports"."source" = 'workspace') = ("exports"."storage_path" is not null));
