-- The guest look (spec 0065, AC-6570 as amended): the business's one look for its guest menu, reservation page and
-- business page, saved from the Menus Design page. A document of closed words and hexes (`MenuLook` in contracts); null
-- is the default, Warm. The database holds its shape and size only; the server checks every part on the way in and again
-- on the way out, since it ends up as custom properties on a public page.
alter table "business_profiles" add column "look" jsonb;
--> statement-breakpoint
alter table "business_profiles" add constraint "business_profiles_look"
  check ("look" is null or (jsonb_typeof("look") = 'object' and octet_length("look"::text) <= 2000));
