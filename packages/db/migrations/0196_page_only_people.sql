-- Page only people (spec 0070 follow-up, 9 Nov 2026, the owner: "admin to be able to make pages like timefix.com/nick,
-- timefix.com/kate, without nick and kate signing up themselves").
--
-- Numbered 0196 and stamped after 0195 (business apps on), which is on main.
--
-- A page only person is a managed member that no partner added: someone with `link_pages.manage_team` added them from
-- Team pages, in Timefix or inside a partner's frame. They reuse slice 3's managed identity (an `.invalid` address, no
-- password, no linked account, refused by the session hook), so nothing about sign in changes. They differ from a
-- partner's person in one way: no partner owns them, so a partner's PUT and DELETE (keyed by partner and external id)
-- can never find, change or remove them.
--
-- `managed_members`: `partner_id` and `connection_id` become null for a page only person, and `created_by_member_id`
-- names who added them. For them `external_id` is the row's own id, so `auth.managed_users` keys them the same way
-- (workspace, no partner, that id). The check keeps the two kinds apart: a partner's row has a partner and a
-- connection and no maker; a page only row has neither, a maker, and its own id as its external id.
--
-- `auth.managed_users`: `partner_id` becomes null for a page only identity. Its unique index treats a null partner as
-- one value (nulls not distinct, Postgres 15 and later), so the same (workspace, id) is still one identity.
--
-- Postgres 17 compatible. Nothing here changes a role, a grant, a function or a policy.
set local lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "managed_members" ALTER COLUMN "partner_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "managed_members" ALTER COLUMN "connection_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "managed_members" ADD COLUMN "created_by_member_id" uuid;--> statement-breakpoint
ALTER TABLE "managed_members" ADD CONSTRAINT "managed_members_created_by" FOREIGN KEY ("workspace_id","created_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "managed_members" ADD CONSTRAINT "managed_members_kind" CHECK (
  ("partner_id" IS NOT NULL AND "connection_id" IS NOT NULL AND "created_by_member_id" IS NULL)
  OR ("partner_id" IS NULL AND "connection_id" IS NULL AND "created_by_member_id" IS NOT NULL AND "external_id" = "id"::text)
);--> statement-breakpoint
CREATE INDEX "managed_members_created_by_ix" ON "managed_members" USING btree ("workspace_id","created_by_member_id");--> statement-breakpoint
ALTER TABLE "auth"."managed_users" ALTER COLUMN "partner_id" DROP NOT NULL;--> statement-breakpoint
DROP INDEX "auth"."managed_users_external";--> statement-breakpoint
CREATE UNIQUE INDEX "managed_users_external" ON "auth"."managed_users" USING btree ("workspace_id","partner_id","external_id") NULLS NOT DISTINCT;
