-- A booking page's own "Add bookings to" that goes (spec 0024 milestone 5, AC-997; side lane calendars-server,
-- 22 Oct 2026). The calendar's foreign key already sets the page's `destination_calendar_id` to null when the
-- calendar goes (the provider removed it, or its account was disconnected or its grant revoked, which deletes the
-- connection and its calendars), so the page follows its owner's default. Until now nothing said so: the editor
-- read a plain default. `destination_removed_name` keeps the gone calendar's name, so the owner's editor can say the
-- page fell back, and setting the page's destination again clears it (the service does).
--
-- The trigger crm_booking_pages_destination_gone runs before each calendar row is deleted (cascaded deletes too),
-- before the foreign key's own set null, and writes the name on the pages naming it. Its explicit
-- `workspace_id = old.workspace_id` is what keeps workspaces apart: a cascade from calendar_connections runs as the
-- table's owner, past row level security, so never trim that filter as if the policy did it. Nothing to backfill: a
-- page whose calendar went before this migration reads as the default, as it did.
ALTER TABLE "booking_pages" ADD COLUMN "destination_removed_name" text;--> statement-breakpoint
ALTER TABLE "booking_pages" ADD CONSTRAINT "booking_pages_destination_removed_name" CHECK (char_length("booking_pages"."destination_removed_name") <= 255);--> statement-breakpoint
create function crm_booking_pages_destination_gone()
  returns trigger
  language plpgsql
  set search_path = pg_catalog, pg_temp
as $function$
begin
  update public.booking_pages
  set destination_removed_name = pg_catalog.left(old.name, 255)
  where workspace_id = old.workspace_id and destination_calendar_id = old.id;
  return old;
end;
$function$;
--> statement-breakpoint
revoke all on function crm_booking_pages_destination_gone() from public;
--> statement-breakpoint
create trigger calendar_calendars_page_destination_gone
  before delete on calendar_calendars
  for each row execute function crm_booking_pages_destination_gone();
