-- The invite link (spec 0031, slice 6, AC-818): an open link invitation keeps its own token, so an admin can copy
-- the link again at any time; it always hashes to token_hash, and an email invitation never keeps one. A nullable
-- column and a check every existing row (all email invitations) passes, so nothing is rewritten. Give up after 5
-- seconds rather than queue behind traffic, like 0041.
set local lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "link_token" text;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_link_token" CHECK (("invitations"."kind" = 'email' and "invitations"."link_token" is null)
        or ("invitations"."kind" = 'link' and "invitations"."link_token" is not null
          and encode(sha256(convert_to("invitations"."link_token", 'UTF8')), 'hex') = "invitations"."token_hash"));