-- An import into an "Each record once" list that already holds a row's record updates that entry's values (spec
-- 0048, AC-4833). The row now keeps what it changed there (`entry_changes`: `{ entryId, before, written }`, each
-- attribute's value before the import and the version the import wrote), so the import's undo puts those values back
-- too, unless they changed since.
set local lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "import_rows" ADD COLUMN "entry_changes" jsonb;
