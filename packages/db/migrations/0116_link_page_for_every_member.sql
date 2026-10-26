-- A link page for every membership, made for them (26 Oct 2026, the owner: "we need to create link page
-- automatically as soon as someone signs up"). Spec 0056 made a handle belong to a membership and left a person to
-- claim one; now each membership gets its handle and an empty link page the moment it exists, with no claim step,
-- and Settings › Profile still changes it.
--
-- What changes:
-- * `crm_ensure_public_profile(owner, workspace, base)`, a crm_handle definer executable by crm_app: answers the
--   handle the membership already holds, or claims the first free one of `base`, `base-2` … `base-30`, then
--   `base-` and four random digits (30 tries), and makes the empty page behind it, hidden from search engines until
--   its owner says otherwise (an address nobody chose shouldn't be found by searching their name). It answers NULL,
--   writing nothing, for someone who isn't an active member of the workspace, who already holds 20 handles, or when
--   every try was taken: a membership is never refused because of its link page. `base` must already be a handle's
--   shape (the caller makes it, `handleBaseFor` in @crm/contracts, which also keeps reserved words out); anything
--   else is 22023 PROFILE_HANDLE_BASE. It answers NULL too unless `workspace` is the transaction's own
--   (`app.workspace_id`, as withWorkspace() sets it), so code running in one workspace can never make a page in
--   another. One person's claims queue on the advisory lock `crm_save_public_profile` takes, so the two never race.
-- * The backfill: every active member with a sign in, in a workspace that exists, who has no page there yet, gets
--   one, its base made here the way `handleBaseFor` makes it (their name's letters, else their email's part before
--   the @, padded with -me when short or reserved; the reserved words are copied as of today). It calls the same
--   definer with each row's workspace set as the transaction's, so it is idempotent: a second run finds every page
--   made and changes nothing. A row it can't make a page for (an account gone, a lock it waited too long for) is
--   counted in the deploy log and left to the daily cleanup, never failing the deploy. Postgres 17 compatible.
-- Any change to these roles or functions goes through security-access-reviewer.
set local lock_timeout = '5s';
--> statement-breakpoint
grant crm_handle to current_user with inherit false, set true;
--> statement-breakpoint
grant create on schema public to crm_handle;
--> statement-breakpoint
set local role crm_handle;
--> statement-breakpoint
create function crm_ensure_public_profile(owner uuid, workspace uuid, base text)
  returns text
  language plpgsql
  security definer
  set search_path = pg_catalog, pg_temp
as $$
declare
  held text;
  suffix text;
  candidate text;
  try integer;
  made integer;
begin
  if base is null or base !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or pg_catalog.char_length(base) not between 3 and 40 then
    raise exception using errcode = '22023', message = 'PROFILE_HANDLE_BASE';
  end if;
  if workspace is distinct from nullif(pg_catalog.current_setting('app.workspace_id', true), '')::uuid then
    return null;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('crm_public_handle:' || owner::text, 0));
  if not public.crm_workspace_member(owner, workspace) then
    return null;
  end if;
  select p.handle into held from auth.public_profiles p where p.user_id = owner and p.workspace_id = workspace;
  if held is not null then
    return held;
  end if;
  if (select pg_catalog.count(*) from auth.public_handles h where h.user_id = owner) >= 20 then
    return null;
  end if;
  for try in 1..60 loop
    suffix := case
      when try = 1 then ''
      when try <= 30 then '-' || try::text
      else '-' || (1000 + pg_catalog.floor(pg_catalog.random() * 9000))::integer::text
    end;
    candidate := pg_catalog.rtrim(pg_catalog.left(base, 40 - pg_catalog.char_length(suffix)), '-') || suffix;
    insert into auth.public_handles (handle, user_id, workspace_id) values (candidate, owner, workspace)
    on conflict (handle) do nothing;
    get diagnostics made = row_count;
    if made = 1 then
      insert into auth.public_profiles (user_id, workspace_id, handle, indexable)
      values (owner, workspace, candidate, false);
      return candidate;
    end if;
  end loop;
  return null;
end;
$$;
--> statement-breakpoint
revoke all on function crm_ensure_public_profile(uuid, uuid, text) from public;
--> statement-breakpoint
grant execute on function crm_ensure_public_profile(uuid, uuid, text) to crm_app;
--> statement-breakpoint
-- The backfill below calls it as this login, for this migration only (revoked again at its end).
do $$
begin
  execute pg_catalog.format('grant execute on function crm_ensure_public_profile(uuid, uuid, text) to %I', session_user);
end
$$;
--> statement-breakpoint
reset role;
--> statement-breakpoint
-- As the owner and past row level security, like 0113's backfill: a role it would filter fails here rather than
-- backfilling nothing.
set local row_security = off;
--> statement-breakpoint
do $$
declare
  kept constant text[] := array['about', 'account', 'accounts', 'admin', 'api', 'app', 'apps', 'assets', 'auth',
    'availability', 'b', 'billing', 'blog', 'book', 'booking', 'bookings', 'brand', 'calendar', 'callback', 'cancel',
    'captures', 'contact', 'dashboard', 'demo', 'developers', 'docs', 'download', 'edit', 'email',
    'email-preferences', 'embed', 'f', 'favicon', 'form', 'forms', 'health', 'help', 'home', 'inbox', 'index',
    'integrations', 'invite', 'join', 'legal', 'links', 'login', 'logout', 'mail', 'manage', 'manifest', 'new', 'null',
    'oauth', 'objects', 'pricing', 'privacy', 'profile', 'public', 'reschedule', 'robots', 'root', 'schedule',
    'search', 'security', 'settings', 'sign-in', 'sign-out', 'sign-up', 'signin', 'signup', 'sitemap', 'static',
    'status', 'support', 'team', 'terms', 'theme-boot', 'timefix', 'two-factor', 'undefined', 'user', 'users',
    'verify', 'w', 'webhooks', 'welcome', 'www'];
  joined record;
  from_name text;
  from_email text;
  base text;
  made integer := 0;
  missed integer := 0;
  handle text;
begin
  for joined in
    select m.user_id, m.workspace_id, m.name, m.email
    from public.members m
    join public.workspaces w on w.id = m.workspace_id
    join auth."user" u on u.id = m.user_id
    where m.status = 'active' and m.user_id is not null and w.deleted_at is null
      and not exists (select 1 from auth.public_profiles p where p.user_id = m.user_id and p.workspace_id = m.workspace_id)
    order by m.created_at, m.id
  loop
    -- handleBaseFor: lowercase, accents dropped, hyphens for anything else, at most 40.
    from_name := pg_catalog.rtrim(pg_catalog.left(pg_catalog.btrim(pg_catalog.regexp_replace(
      pg_catalog.regexp_replace(normalize(pg_catalog.lower(coalesce(joined.name, '')), NFKD), '[\u0300-\u036f]+', '', 'g'),
      '[^a-z0-9]+', '-', 'g'), '-'), 40), '-');
    from_email := pg_catalog.rtrim(pg_catalog.left(pg_catalog.btrim(pg_catalog.regexp_replace(
      pg_catalog.regexp_replace(normalize(pg_catalog.lower(pg_catalog.split_part(pg_catalog.split_part(coalesce(joined.email, ''), '@', 1), '+', 1)), NFKD),
      '[\u0300-\u036f]+', '', 'g'), '[^a-z0-9]+', '-', 'g'), '-'), 40), '-');
    if pg_catalog.char_length(from_name) >= 3 and not from_name = any (kept) then
      base := from_name;
    elsif pg_catalog.char_length(from_email) >= 3 and not from_email = any (kept) then
      base := from_email;
    else
      base := case when from_name = '' then coalesce(nullif(from_email, ''), 'me') else from_name end;
      if pg_catalog.char_length(base) < 3 or base = any (kept) then
        base := base || '-me';
      end if;
      base := pg_catalog.rtrim(pg_catalog.left(base, 40), '-');
    end if;
    begin
      perform pg_catalog.set_config('app.workspace_id', joined.workspace_id::text, true);
      handle := public.crm_ensure_public_profile(joined.user_id, joined.workspace_id, base);
    exception when others then
      handle := null;
    end;
    if handle is null then
      missed := missed + 1;
    else
      made := made + 1;
    end if;
  end loop;
  perform pg_catalog.set_config('app.workspace_id', '', true);
  if made > 0 or missed > 0 then
    raise notice '0116_link_page_for_every_member: % link pages made, % memberships left without one', made, missed;
  end if;
end
$$;
--> statement-breakpoint
set local role crm_handle;
--> statement-breakpoint
do $$
begin
  execute pg_catalog.format('revoke execute on function crm_ensure_public_profile(uuid, uuid, text) from %I', session_user);
end
$$;
--> statement-breakpoint
reset role;
--> statement-breakpoint
revoke create on schema public from crm_handle;
--> statement-breakpoint
revoke crm_handle from current_user;
