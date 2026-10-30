-- Importing into a list (spec 0048, AC-4833). An import may name a list (`list_id`): each row finds or makes its
-- record as before, then adds an entry to the list (or, in an "Each record once" list that already holds the record,
-- updates that entry's values). The row keeps the entry it added (`entry_id`), so the import's undo takes exactly
-- those entries out again. Deleting the list (never done today: lists are archived) drops its imports, as an
-- object's do. PLACEHOLDER number: renumbered after main's last migration when this lane merges.
set local lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "imports" ADD COLUMN "list_id" uuid;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_list" FOREIGN KEY ("workspace_id","list_id") REFERENCES "public"."lists"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "imports_by_list" ON "imports" USING btree ("workspace_id","list_id") WHERE "imports"."list_id" is not null;--> statement-breakpoint
ALTER TABLE "import_rows" ADD COLUMN "entry_id" uuid;
