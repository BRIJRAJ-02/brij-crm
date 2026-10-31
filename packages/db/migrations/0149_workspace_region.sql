-- The workspace's default currency and country (Settings › Workspace › General): where a new Currency attribute and a
-- new phone number start, and what an imported "$" is read as. Both optional: none keeps the language's region (en-IN
-- is IN and INR), as every workspace did before. Two nullable columns with no default, so the change rewrites no row.
-- The checks hold the shapes the contract takes: an ISO 4217 code is three capital letters, an ISO 3166 alpha 2 code
-- two (the contract refuses a code that is not in its list; the database only keeps a bad shape out).
set local lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "currency" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "country" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_currency" CHECK ("workspaces"."currency" is null or "workspaces"."currency" ~ '^[A-Z]{3}$');--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_country" CHECK ("workspaces"."country" is null or "workspaces"."country" ~ '^[A-Z]{2}$');
