-- A partner's person claims their own Timefix login (spec 0070, AC-7023; owner, 10 Nov 2026: "as per industry
-- standard and in favour of Timefix").
--
-- Their managed identity becomes a login at a verified address in place, as a page only person's does on a hand over
-- (0203), so it is the same member, page, handle and history; no identity is ever merged (AC-7021). Unlike a hand over,
-- the partner keeps managing them: their `managed_members` row and their `auth.managed_users` row both stay, so the
-- partner's PUT, DELETE, list and launch still find the same person, and each is marked claimed instead.
--
-- - `managed_members.claimed_at`: when the person took their login. Only a partner's person is ever claimed (a page
--   only person's row goes on a hand over). The app reads it: a claimed person gets Timefix's email like any member,
--   the partner no longer changes their address (it is their login's), a partner's DELETE ends only the partner's hold
--   on them (they stay a member), and the 30 day purge never touches them.
-- - `auth.managed_users.claimed_at`: the identity login's mark of the same. A claimed identity is a login: the session
--   hook lets it sign in, and the console counts it as signed up. The row stays, so the partner's next PUT keyed by its
--   external id finds the same identity, never a new one.
-- - `invitations.frame_connection_id`: the connected app's embedded session a login invitation was last sent from
--   (none from Timefix). Inside the frame the app controls who acts as whom, so such an invitation only opens while
--   its person still holds plain Member with no custom role: an app can't send one for a Member, make them its admin
--   (AC-7024), then open it as an Admin login (security review, 10 Nov 2026). No foreign key: a disconnected
--   connection's row stays, and nothing joins on it.
--
-- Postgres 17 compatible. Nothing here changes a role, a grant, a function or a policy.
set local lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "managed_members" ADD COLUMN "claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "managed_members" ADD CONSTRAINT "managed_members_claimed" CHECK ("claimed_at" IS NULL OR "partner_id" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "frame_connection_id" uuid;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_frame" CHECK ("frame_connection_id" IS NULL OR "member_id" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "auth"."managed_users" ADD COLUMN "claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "auth"."managed_users" ADD CONSTRAINT "managed_users_claimed" CHECK ("claimed_at" IS NULL OR "partner_id" IS NOT NULL);
