-- Where a booking page files its answers (booking answers parity, 27 October 2026). Spec 0057 pinned a page's
-- questions to People; a public form has never had that limit, and a workspace running its own object ("Graphic
-- Designers") wants the same. The page now names the object its answers are filed onto.
--
-- Null is People, which is what every page did before, so nothing is backfilled and no page changes behaviour.
-- The booking still matches or makes the visitor's Person either way (that is what a booking is): only the answers
-- move, onto a record of the chosen object found or made by the visitor's email, the way a form does it. An object
-- with no unique email attribute can't match a visitor, so choosing one is refused on save, not at booking time.
--
-- Row level security is unchanged: the column lives on a tenant table that already forces it, and the foreign key
-- is inside the workspace, so an object of another workspace can never be named.
ALTER TABLE "booking_pages" ADD COLUMN "answers_object_id" uuid;--> statement-breakpoint
ALTER TABLE "booking_pages" ADD CONSTRAINT "booking_pages_answers_object" FOREIGN KEY ("workspace_id","answers_object_id") REFERENCES "public"."objects"("workspace_id","id") ON DELETE no action ON UPDATE no action;
