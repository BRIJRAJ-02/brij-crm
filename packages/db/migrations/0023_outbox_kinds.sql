-- Every kind of change event (spec 0007, milestone 1, AC-77 and AC-79). drizzle-kit's, with this header and the
-- lock timeout hand written.
--
-- The enum only gains values (Postgres can't drop one), and nothing here uses them, so adding them inside the
-- migration's transaction is safe. object_id turns nullable for kinds with no object; list_id, item_ids and
-- actor_member_id are new. Every change is a catalog change only (a constant default, a dropped NOT NULL), but it
-- waits for the outbox's lock, which every write takes: give up after 5 seconds rather than queue behind traffic,
-- like 0020. The grants need nothing new: crm_app's insert and select and crm_relay's select and delete are on the
-- whole table, so they cover the new columns, and crm_app still can't update anything but published_at.
set local lock_timeout = '5s';
--> statement-breakpoint
ALTER TYPE "public"."outbox_kind" ADD VALUE 'entries';--> statement-breakpoint
ALTER TYPE "public"."outbox_kind" ADD VALUE 'views';--> statement-breakpoint
ALTER TYPE "public"."outbox_kind" ADD VALUE 'notes';--> statement-breakpoint
ALTER TYPE "public"."outbox_kind" ADD VALUE 'tasks';--> statement-breakpoint
ALTER TYPE "public"."outbox_kind" ADD VALUE 'members';--> statement-breakpoint
ALTER TYPE "public"."outbox_kind" ADD VALUE 'access';--> statement-breakpoint
ALTER TYPE "public"."outbox_kind" ADD VALUE 'jobs';--> statement-breakpoint
ALTER TABLE "outbox" ALTER COLUMN "object_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "list_id" uuid;--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "item_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "actor_member_id" uuid;
