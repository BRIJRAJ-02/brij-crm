-- The guest role (spec 0031, slice 9, AC-828): someone outside the team who sees only what the access rules share
-- with them, holds no permission, takes no seat, and can't host. Added last, so `owner`, `admin`, `member` keep
-- their order. Nothing in this batch uses the value, so it may be added inside the migration's transaction.
ALTER TYPE "public"."member_role" ADD VALUE IF NOT EXISTS 'guest';
