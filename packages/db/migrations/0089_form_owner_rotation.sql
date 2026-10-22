-- A form's owner can be a round robin rotation (spec 0029 milestone 3, AC-755, AC-756; spec 0023 AC-567, AC-1050;
-- lane form-leads-owner, 22 Oct 2026): `owner_rotation_id` names the rotation whose fairest member gets each new
-- lead, beside `owner_member_id` (a fixed member), at most one of the two set (`forms_one_owner`). Like the member,
-- it applies at once, not on publish. The rotation's foreign key leads with `workspace_id`, and
-- `forms_by_owner_rotation` serves the rotation's delete guard ("Used by 1 form") and the key's check. Nothing to
-- backfill: every form keeps the owner it had.
ALTER TABLE "forms" ADD COLUMN "owner_rotation_id" uuid;--> statement-breakpoint
ALTER TABLE "forms" ADD CONSTRAINT "forms_owner_rotation" FOREIGN KEY ("workspace_id","owner_rotation_id") REFERENCES "public"."rotations"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "forms_by_owner_rotation" ON "forms" USING btree ("workspace_id","owner_rotation_id") WHERE "forms"."owner_rotation_id" is not null;--> statement-breakpoint
ALTER TABLE "forms" ADD CONSTRAINT "forms_one_owner" CHECK ("forms"."owner_member_id" is null or "forms"."owner_rotation_id" is null);