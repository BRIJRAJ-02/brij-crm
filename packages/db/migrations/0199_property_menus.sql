-- Properties, slice 2b (spec 0065 H7, AC-6517 to AC-6519): each business has its own menu library and its own draft.
-- Numbered 0199, after 0198 (properties).
--
-- What changes:
-- * `menu_items`, `menu_photos` and `menu_option_groups` gain `property_id` (not null), so the per business limits
--   (2,000 dishes, 1,000 photos, AC-6518) count one business's rows, and a currency change (AC-6519) asks only whether
--   that business has a price. A dish belongs to the business whose menu places it (the first such menu by position),
--   else the first business; an option group to the business of the first dish offering it, else the first; a photo to
--   the business whose look names it as a cover, else the business of the first dish showing it, else the first. Today
--   every workspace in production has one business, so each of these is that one.
-- * Where a workspace already has two businesses (a preview or a dev database since 0198), what its draft last
--   published was the whole workspace's, so Discard has nothing of one business's own to go back to: it is cleared.
-- * A dish's photo is its own business's: `menu_items_photo` becomes a composite key to `menu_photos`, setting only
--   `photo_id` null when the photo goes.
-- * `menu_drafts` (the count of changes, what was last published, Live or Hidden) is keyed per business:
--   `(workspace_id, property_id)`.
-- * A menu's position counts within its business, renumbered here.
--
-- While the deploy rolls out and after a rollback, the old code still runs: `crm_first_property_id()` is the new
-- columns' default, as in 0198, so an old insert lands on the first business. The old code's `on conflict
-- (workspace_id)` write to `menu_drafts` (every menu edit counts a change through it) is refused during that window,
-- with nothing written: the deploy window is short, and the menu editor says so and keeps nothing half done.
--
-- Locks: access exclusive on the menu tables, none large, for as long as the transaction runs. No table is rewritten.
-- Postgres 17 compatible.
set local lock_timeout = '5s';
--> statement-breakpoint
alter table menu_items add column property_id uuid;
--> statement-breakpoint
alter table menu_photos add column property_id uuid;
--> statement-breakpoint
alter table menu_option_groups add column property_id uuid;
--> statement-breakpoint
alter table menu_drafts add column property_id uuid;
--> statement-breakpoint
-- Every step from here to `row_security = on` reads every workspace's rows, as the owner, like 0198.
set local row_security = off;
--> statement-breakpoint
update menu_items i set property_id = owner.property_id
  from (
    select distinct on (pl.workspace_id, pl.item_id) pl.workspace_id, pl.item_id, m.property_id
    from menu_placements pl
    join menu_sections s on s.workspace_id = pl.workspace_id and s.id = pl.section_id
    join menus m on m.workspace_id = s.workspace_id and m.id = s.menu_id
    order by pl.workspace_id, pl.item_id, m.position, m.id
  ) owner
  where owner.workspace_id = i.workspace_id and owner.item_id = i.id;
--> statement-breakpoint
update menu_items t set property_id = p.id
  from properties p
  where p.workspace_id = t.workspace_id and p.position = 0 and t.property_id is null;
--> statement-breakpoint
update menu_option_groups g set property_id = owner.property_id
  from (
    select distinct on (ig.workspace_id, ig.group_id) ig.workspace_id, ig.group_id, i.property_id
    from menu_item_option_groups ig
    join menu_items i on i.workspace_id = ig.workspace_id and i.id = ig.item_id
    order by ig.workspace_id, ig.group_id, i.id
  ) owner
  where owner.workspace_id = g.workspace_id and owner.group_id = g.id;
--> statement-breakpoint
update menu_option_groups t set property_id = p.id
  from properties p
  where p.workspace_id = t.workspace_id and p.position = 0 and t.property_id is null;
--> statement-breakpoint
-- A cover first: its look is live with no Publish, so its business must never lose it to another's Publish.
update menu_photos ph set property_id = p.id
  from properties p
  where p.workspace_id = ph.workspace_id and p.look -> 'cover' ->> 'id' = ph.id::text;
--> statement-breakpoint
update menu_photos ph set property_id = owner.property_id
  from (
    select distinct on (i.workspace_id, i.photo_id) i.workspace_id, i.photo_id, i.property_id
    from menu_items i
    where i.photo_id is not null
    order by i.workspace_id, i.photo_id, i.id
  ) owner
  where owner.workspace_id = ph.workspace_id and owner.photo_id = ph.id and ph.property_id is null;
--> statement-breakpoint
update menu_photos t set property_id = p.id
  from properties p
  where p.workspace_id = t.workspace_id and p.position = 0 and t.property_id is null;
--> statement-breakpoint
-- A dish that shows a photo another business's dish holds (never in production, where each workspace has one business)
-- lets go of it rather than show it across businesses.
update menu_items i set photo_id = null
  from menu_photos ph
  where ph.workspace_id = i.workspace_id and ph.id = i.photo_id and ph.property_id <> i.property_id;
--> statement-breakpoint
update menu_drafts t set property_id = p.id
  from properties p
  where p.workspace_id = t.workspace_id and p.position = 0;
--> statement-breakpoint
update menu_drafts d set published = null
  where (select count(*) from properties p where p.workspace_id = d.workspace_id) > 1;
--> statement-breakpoint
update menus m set position = r.n - 1
  from (
    select workspace_id, id, row_number() over (partition by workspace_id, property_id order by position, id) as n
    from menus
  ) r
  where r.workspace_id = m.workspace_id and r.id = m.id and m.position <> r.n - 1;
--> statement-breakpoint
set local row_security = on;
--> statement-breakpoint
alter table menu_items alter column property_id set not null;
--> statement-breakpoint
alter table menu_photos alter column property_id set not null;
--> statement-breakpoint
alter table menu_option_groups alter column property_id set not null;
--> statement-breakpoint
alter table menu_drafts alter column property_id set not null;
--> statement-breakpoint
alter table menu_items add constraint menu_items_property foreign key (workspace_id, property_id)
  references properties (workspace_id, id) deferrable initially deferred;
--> statement-breakpoint
alter table menu_photos add constraint menu_photos_property foreign key (workspace_id, property_id)
  references properties (workspace_id, id) deferrable initially deferred;
--> statement-breakpoint
alter table menu_option_groups add constraint menu_option_groups_property foreign key (workspace_id, property_id)
  references properties (workspace_id, id) deferrable initially deferred;
--> statement-breakpoint
alter table menu_drafts add constraint menu_drafts_property foreign key (workspace_id, property_id)
  references properties (workspace_id, id) deferrable initially deferred;
--> statement-breakpoint
create index menu_items_property on menu_items using btree (workspace_id, property_id);
--> statement-breakpoint
create index menu_option_groups_property on menu_option_groups using btree (workspace_id, property_id);
--> statement-breakpoint
create unique index menu_photos_in_property on menu_photos using btree (workspace_id, id, property_id);
--> statement-breakpoint
create index menu_photos_property on menu_photos using btree (workspace_id, property_id);
--> statement-breakpoint
alter table menu_items drop constraint menu_items_photo;
--> statement-breakpoint
alter table menu_items add constraint menu_items_photo foreign key (workspace_id, photo_id, property_id)
  references menu_photos (workspace_id, id, property_id) on delete set null (photo_id);
--> statement-breakpoint
alter table menu_drafts drop constraint menu_drafts_pkey;
--> statement-breakpoint
alter table menu_drafts add constraint menu_drafts_pkey primary key (workspace_id, property_id);
--> statement-breakpoint
alter table menu_items alter column property_id set default crm_first_property_id();
--> statement-breakpoint
alter table menu_photos alter column property_id set default crm_first_property_id();
--> statement-breakpoint
alter table menu_option_groups alter column property_id set default crm_first_property_id();
--> statement-breakpoint
alter table menu_drafts alter column property_id set default crm_first_property_id();
--> statement-breakpoint
-- Refuse to finish unless it all holds: every row on its own workspace's business, and row level security still forced.
set local row_security = off;
--> statement-breakpoint
do $$
begin
  if exists (
    select 1 from menu_items i
    where not exists (select 1 from properties p where p.workspace_id = i.workspace_id and p.id = i.property_id)
  ) or exists (
    select 1 from menu_photos x
    where not exists (select 1 from properties p where p.workspace_id = x.workspace_id and p.id = x.property_id)
  ) or exists (
    select 1 from menu_option_groups g
    where not exists (select 1 from properties p where p.workspace_id = g.workspace_id and p.id = g.property_id)
  ) or exists (
    select 1 from menu_drafts d
    where not exists (select 1 from properties p where p.workspace_id = d.workspace_id and p.id = d.property_id)
  ) then
    raise exception '0199_property_menus: every menu row must be on its workspace''s own business';
  end if;
  if exists (
    select 1 from pg_class c
    where c.oid in ('public.menu_items'::regclass, 'public.menu_photos'::regclass,
      'public.menu_option_groups'::regclass, 'public.menu_drafts'::regclass)
      and not (c.relrowsecurity and c.relforcerowsecurity)
  ) then
    raise exception '0199_property_menus: the menu tables keep their row level security';
  end if;
end
$$;
--> statement-breakpoint
set local row_security = on;
