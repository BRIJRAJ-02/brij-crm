-- Who a form tells about each new submission (spec 0023, AC-568, AC-1047): the members listed here, beside the
-- member its lead goes to. A uuid array, as `allowed_origins` is a text one: a member who leaves is skipped when a
-- notice is sent (spec 0023, a removed member in the list is skipped), never a broken reference. At most 20. Each
-- form made so far lists its maker, the one member it told before besides the lead's owner, so nobody stops being
-- told.
alter table forms add column notify_member_ids uuid[] not null default '{}'::uuid[];
--> statement-breakpoint
alter table forms add constraint forms_notify_member_ids check (cardinality(notify_member_ids) <= 20);
--> statement-breakpoint
update forms set notify_member_ids = array[created_by_member_id] where created_by_member_id is not null;
