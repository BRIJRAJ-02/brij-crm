-- A condition's record fact key names its field by a uuid in one spelling only (spec 0043, AC-1603): the contract
-- now refuses `person.` or `company.` with anything but a lower case 8-4-4-4-12 id, where it took any 36 hex digits
-- and dashes (36 dashes answered 500 at the database's uuid cast). A stored document must still parse, so a key the
-- old pattern let in and the new one refuses is rewritten here to the nil uuid, which names no field: a team page's
-- rule over it is skipped as unreadable, as it was meant to be, and a form's draft still can't publish it. None is
-- expected (the editors only ever write canonical ids, and a team page's save cast every new key), so these touch
-- nothing on a database that never took one.
--
-- Hand written, data only. Migrations run as the owner, past row level security, so this reaches every workspace,
-- each row keeping its own. Row security off: a role it would filter fails here rather than rewriting nothing, like
-- 0082. jsonb prints a pair as `"key": "value"`; a string holding a quote prints it as `\"`, so only a condition's
-- own key matches.
set local row_security = off;
--> statement-breakpoint
update form_versions
set document = regexp_replace(
  document::text,
  '"key": "(person|company)\.(?![0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")[0-9a-f-]{36}"',
  '"key": "\1.00000000-0000-0000-0000-000000000000"',
  'g'
)::jsonb
where document::text ~ '"key": "(person|company)\.(?![0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")[0-9a-f-]{36}"';
--> statement-breakpoint
update booking_pages
set routing = regexp_replace(
  routing::text,
  '"key": "(person|company)\.(?![0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")[0-9a-f-]{36}"',
  '"key": "\1.00000000-0000-0000-0000-000000000000"',
  'g'
)::jsonb
where routing::text ~ '"key": "(person|company)\.(?![0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")[0-9a-f-]{36}"';
