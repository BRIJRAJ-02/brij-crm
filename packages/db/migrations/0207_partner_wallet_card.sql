-- A partner's own Apple Wallet card (the owner, 13 November 2026). Numbered 0207.
--
-- The pass a person saves from their link page has always been Timefix's: the orange ground and the Timefix
-- wordmark. A partner whose people's pages live inside its own product can now have that card in its own brand: one
-- colour the ground is drawn from, and its logo in the wordmark's place. Both sit on the partner's registry row,
-- written only by the operator console, and read when a pass is made for somebody in a workspace the partner is
-- connected to.
--
-- - `wallet_colour`: `#` and six lowercase hex digits; null keeps Timefix's ground.
-- - `wallet_logo`, `wallet_logo_2x`, `wallet_logo_3x`: the logo as a PNG at each of Wallet's three scales, drawn in
--   the console's browser, each at most 100 KB; all three or none. Null keeps the Timefix wordmark.
-- - `wallet_logo_version`: moves with every new logo, so the console's preview address changes.
--
-- New nullable columns and one defaulted one: old code never reads or writes them, so the rollout and a rollback are
-- safe. Postgres 17 compatible.
set local lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "auth"."partners" ADD COLUMN "wallet_colour" text;--> statement-breakpoint
ALTER TABLE "auth"."partners" ADD COLUMN "wallet_logo" "bytea";--> statement-breakpoint
ALTER TABLE "auth"."partners" ADD COLUMN "wallet_logo_2x" "bytea";--> statement-breakpoint
ALTER TABLE "auth"."partners" ADD COLUMN "wallet_logo_3x" "bytea";--> statement-breakpoint
ALTER TABLE "auth"."partners" ADD COLUMN "wallet_logo_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "auth"."partners" ADD CONSTRAINT "partners_wallet_colour" CHECK ("auth"."partners"."wallet_colour" is null or "auth"."partners"."wallet_colour" ~ '^#[0-9a-f]{6}$');--> statement-breakpoint
ALTER TABLE "auth"."partners" ADD CONSTRAINT "partners_wallet_logo" CHECK (("auth"."partners"."wallet_logo" is null and "auth"."partners"."wallet_logo_2x" is null and "auth"."partners"."wallet_logo_3x" is null) or ("auth"."partners"."wallet_logo" is not null and "auth"."partners"."wallet_logo_2x" is not null and "auth"."partners"."wallet_logo_3x" is not null and octet_length("auth"."partners"."wallet_logo") between 1 and 102400 and octet_length("auth"."partners"."wallet_logo_2x") between 1 and 102400 and octet_length("auth"."partners"."wallet_logo_3x") between 1 and 102400));
