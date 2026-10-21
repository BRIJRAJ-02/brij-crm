-- A form may keep its submissions only (spec 0023 follow-up, the owner's "what if I don't need to map",
-- 21 October 2026): `forms.main_object_id` (the draft's target) may be null. Each published version keeps its
-- own target in its document, and a submission is filed with its version's target, so no row changes here.
ALTER TABLE "forms" ALTER COLUMN "main_object_id" DROP NOT NULL;
