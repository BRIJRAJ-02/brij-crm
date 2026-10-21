-- Members gain a picture and a time zone of their own (spec 0031, slices 3 and 7): both empty until file storage
-- (#32) and the profile page, so screens show initials and the browser's zone. Nullable columns with checks only, so
-- the table is never rewritten. Give up after 5 seconds rather than queue behind traffic, like 0041.
set local lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "avatar_url" text;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "time_zone" text;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_avatar_url" CHECK (char_length("members"."avatar_url") <= 2048);--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_time_zone" CHECK (char_length("members"."time_zone") between 1 and 64);