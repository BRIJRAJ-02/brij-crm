-- A task's links purged with their records (late trap #79, 29 Oct 2026). A task that links no records is everyone's
-- (spec 0019, AC-447), so a task linked only to records some members couldn't see became every member's to read and
-- change the day the purge removed those records for good. The purge now marks such a task (`links_purged`) before
-- deleting its links, and the task rule reads a task with none left as its creator's and assignee's only. Tasks a
-- purge already emptied can't be told apart from ones made with no links, so they stay as they are. Adding a column
-- with a constant default rewrites nothing. Postgres 17 compatible.
set local lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "links_purged" boolean DEFAULT false NOT NULL;
