-- The command menu (spec 0039). First drizzle-kit's `member_recents`: the records and views each member opened last,
-- their own bookmark like member_view_state (no outbox row, at most 20 rows per member, read back only through the
-- access door). Then, hand written, its row level security and crm_search_similar, the typo tolerant name search.
--
-- The foreign key briefly locks members against writes. Give up after 5 seconds rather than queue behind traffic,
-- like 0038.
set local lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE "member_recents" (
	"workspace_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"target_id" uuid NOT NULL,
	"visited_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_recents_pkey" PRIMARY KEY("workspace_id","member_id","kind","target_id"),
	CONSTRAINT "member_recents_kind" CHECK ("member_recents"."kind" in ('record', 'view'))
);
--> statement-breakpoint
ALTER TABLE "member_recents" ADD CONSTRAINT "member_recents_member" FOREIGN KEY ("workspace_id","member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "member_recents_by_time" ON "member_recents" USING btree ("workspace_id","member_id","visited_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "member_recents_by_target" ON "member_recents" USING btree ("workspace_id","target_id");
--> statement-breakpoint

-- Hand written from here.
-- The standard policy: an unset workspace matches nothing, even for the owner.
alter table member_recents enable row level security;
--> statement-breakpoint
alter table member_recents force row level security;
--> statement-breakpoint
create policy member_recents_tenant on member_recents
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint

-- Owner ids (never values) whose current text for one of `search_attributes` is close to `search_pattern` by pg_trgm
-- word similarity (a typo, a missing letter), in the session's workspace, at most `search_limit` rows (clamped to 1
-- to 200), in no particular order: the caller ranks the few it gets. An unset or empty workspace matches nothing.
-- Like crm_search_text (0012): row level security stops Postgres using the trigram index for `<%`, which isn't
-- leakproof, so the read runs as crm_search, which bypasses it, and filters by the session's workspace itself. The
-- match is the trigram index's own expression and predicate, so values_text_trigram answers it; no ORDER BY, so a
-- common match stops at the limit instead of scoring every candidate. The threshold is the function's own setting
-- (0.5, one wrong letter in a short word), never the session's. Trashed records' ids come back too: the caller's liveness and access checks decide what shows.
--
-- A standard SQL body (begin atomic) is parsed once, here, and binds its table, functions and operator by OID, so no
-- session setting can change what it reads. The operator is named with its schema, and parameters with the
-- function's name, so no column can shadow one.
create function crm_search_similar(search_attributes uuid[], search_pattern text, search_limit integer)
  returns setof uuid
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
  set pg_trgm.word_similarity_threshold = 0.5
  rows 200
begin atomic
  select v.owner_id
  from public."values" v
  where v.workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
    and v.attribute_id = any(crm_search_similar.search_attributes)
    and v.active_until is null
    and not v.is_cleared
    and v.text_value is not null
    and lower(crm_search_similar.search_pattern) operator(public.<%) lower(left(v.text_value, 2048))
  limit least(greatest(crm_search_similar.search_limit, 1), 200);
end;
--> statement-breakpoint
revoke all on function crm_search_similar(uuid[], text, integer) from public;
--> statement-breakpoint
grant execute on function crm_search_similar(uuid[], text, integer) to crm_app;
--> statement-breakpoint

-- Hand the function to crm_search, as 0012 did crm_search_text: SET on the role and CREATE on the schema for the
-- change only, then taken back.
grant crm_search to current_user with inherit false, set true;
--> statement-breakpoint
grant create on schema public to crm_search;
--> statement-breakpoint
alter function crm_search_similar(uuid[], text, integer) owner to crm_search;
--> statement-breakpoint
revoke create on schema public from crm_search;
--> statement-breakpoint
revoke crm_search from current_user;
--> statement-breakpoint

-- Refuse to finish unless the function is crm_search's, executable by crm_app and nobody else by a grant of its own,
-- and crm_search is still out of every other role's reach (0012's check, repeated).
do $$
declare
  fn constant regprocedure := 'public.crm_search_similar(uuid[], text, integer)'::regprocedure;
begin
  if (select pg_get_userbyid(p.proowner) from pg_proc p where p.oid = fn) <> 'crm_search'
    or exists (
      select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
      where p.oid = fn and a.privilege_type = 'EXECUTE'
        and a.grantee not in ('crm_search'::regrole, 'crm_app'::regrole)
    )
    or exists (select 1 from pg_proc p where p.proname = 'crm_search_similar' and p.oid <> fn)
    or not has_function_privilege('crm_app', fn, 'EXECUTE') then
    raise exception 'crm_search_similar must be owned by crm_search and executable by crm_app alone';
  end if;
  if exists (
    select 1 from pg_auth_members m
    where m.roleid = 'crm_search'::regrole
      and m.member <> (select datdba from pg_database where datname = current_database())
      and pg_get_userbyid(m.member) not in ('neon_service', 'cloud_admin')
  ) or exists (
    select 1 from pg_auth_members m
    where m.roleid = 'crm_search'::regrole and (m.set_option or m.inherit_option)
      and pg_get_userbyid(m.member) not in ('neon_service', 'cloud_admin')
  ) or pg_has_role('crm_app', 'crm_search', 'USAGE') or pg_has_role('crm_app', 'crm_search', 'SET')
    or exists (select 1 from pg_roles where rolname = 'crm_search' and (rolsuper or rolreplication or rolcreatedb)) then
    raise exception 'crm_search must be a plain role with no member but the database owner, with ADMIN only';
  end if;
end
$$;
