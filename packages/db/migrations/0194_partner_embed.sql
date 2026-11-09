-- Embedded screens and the partner sandbox (spec 0070, slice 4, AC-7030 to AC-7035).
--
-- Numbered 0194 and stamped after 0193 (managed members, slice 3), which lands first.
--
-- `partner_launches` (tenant, forced row level security, the plain policy): a partner's server asked to open one
-- screen for one of its managed members, and got a one time code (60 seconds, used once). Only the SHA-256 of the
-- code's secret half is kept; its public half names the workspace and the row, so the redemption reads it under that
-- workspace's row level security, as the connect's codes are.
--
-- `auth.session` gains the embed scope, the connection a launch's session belongs to and its workspace: both set or
-- both empty. A session with them set opens only the shared modules' procedures in that workspace; a disconnect or a
-- sandbox wipe deletes every session of the connection by the partial index.
--
-- `auth.partners.is_test` marks a sandbox partner, and `partner_connections.is_test` each connection one made (copied
-- at the exchange, so a connection stays what it was made as). The console wipes a sandbox partner's live test
-- connections in one go: `crm_operator_partner_connections`, a definer owned by crm_operator (its eighth function),
-- answers their workspace and id, ids only, and the app ends each under its own workspace.
set local lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE "partner_launches" (
  "workspace_id" uuid NOT NULL,
  "id" uuid DEFAULT uuidv7() NOT NULL,
  "connection_id" uuid NOT NULL,
  "member_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "screen" text NOT NULL,
  "theme" text,
  "code_hash" bytea NOT NULL,
  "created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp (6) with time zone NOT NULL,
  "used_at" timestamp (6) with time zone,
  CONSTRAINT "partner_launches_pkey" PRIMARY KEY("workspace_id","id"),
  CONSTRAINT "partner_launches_screen" CHECK ("screen" = any(array['link_pages.mine', 'link_pages.team']::text[])),
  CONSTRAINT "partner_launches_theme" CHECK ("theme" is null or "theme" in ('light', 'dark')),
  CONSTRAINT "partner_launches_code_hash" CHECK (octet_length("code_hash") = 32),
  CONSTRAINT "partner_launches_expiry" CHECK ("expires_at" > "created_at")
);
--> statement-breakpoint
ALTER TABLE "partner_launches" ADD CONSTRAINT "partner_launches_workspace" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_launches" ADD CONSTRAINT "partner_launches_connection" FOREIGN KEY ("workspace_id","connection_id") REFERENCES "public"."partner_connections"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_launches" ADD CONSTRAINT "partner_launches_member" FOREIGN KEY ("workspace_id","member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "partner_launches_expires" ON "partner_launches" USING btree ("workspace_id","expires_at");--> statement-breakpoint
CREATE INDEX "partner_launches_connection_ix" ON "partner_launches" USING btree ("workspace_id","connection_id");--> statement-breakpoint
CREATE INDEX "partner_launches_member_ix" ON "partner_launches" USING btree ("workspace_id","member_id");--> statement-breakpoint
ALTER TABLE "partner_launches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "partner_launches" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "partner_launches_tenant" ON "partner_launches"
  USING ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "auth"."session" ADD COLUMN "embed_connection_id" uuid;--> statement-breakpoint
ALTER TABLE "auth"."session" ADD COLUMN "embed_workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "auth"."session" ADD CONSTRAINT "session_embed" CHECK (("auth"."session"."embed_connection_id" is null) = ("auth"."session"."embed_workspace_id" is null));--> statement-breakpoint
CREATE INDEX "session_embed_connection" ON "auth"."session" USING btree ("embed_connection_id") WHERE "auth"."session"."embed_connection_id" is not null;--> statement-breakpoint
-- An embedded session ends 12 hours after its launch whatever reads it: a session read that would extend it (Better
-- Auth renews a session past its update age) keeps its expiry, and its scope never changes or goes.
create function "auth"."crm_keep_embed_session"() returns trigger
  language plpgsql
  set search_path = pg_catalog, pg_temp
as $$
begin
  if old.embed_connection_id is not null then
    new.expires_at := least(new.expires_at, old.expires_at);
    new.embed_connection_id := old.embed_connection_id;
    new.embed_workspace_id := old.embed_workspace_id;
  end if;
  return new;
end
$$;
--> statement-breakpoint
create trigger "session_keep_embed" before update on "auth"."session"
  for each row execute function "auth"."crm_keep_embed_session"();
--> statement-breakpoint
ALTER TABLE "auth"."partners" ADD COLUMN "is_test" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "partner_connections" ADD COLUMN "is_test" boolean DEFAULT false NOT NULL;--> statement-breakpoint
grant select (workspace_id, id, partner_id, is_test, disconnected_at) on partner_connections to crm_operator;
--> statement-breakpoint
-- A sandbox partner's live test connections, every workspace's (at most 1,000): their workspace and id, nothing
-- else. The console's Wipe test connections ends each under its own workspace's row level security.
create function crm_operator_partner_connections(partner uuid)
  returns table (workspace_id uuid, connection_id uuid)
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
  rows 50
begin atomic
  select c.workspace_id, c.id
  from public.partner_connections c
  where c.partner_id = crm_operator_partner_connections.partner
    and c.is_test
    and c.disconnected_at is null
  limit 1000;
end;
--> statement-breakpoint
revoke all on function crm_operator_partner_connections(uuid) from public;
--> statement-breakpoint
grant execute on function crm_operator_partner_connections(uuid) to crm_app;
--> statement-breakpoint
grant crm_operator to current_user with inherit false, set true;
--> statement-breakpoint
grant create on schema public to crm_operator;
--> statement-breakpoint
alter function crm_operator_partner_connections(uuid) owner to crm_operator;
--> statement-breakpoint
revoke create on schema public from crm_operator;
--> statement-breakpoint
revoke crm_operator from current_user;
--> statement-breakpoint
-- Refuse to finish unless crm_operator is still as narrow as it reads: its eight functions its own, definers with a
-- standard body and the fixed search path, executable only by crm_app; no table privilege; and no column privilege
-- but reads, besides the early access switch's update.
do $$
declare
  owned integer;
begin
  select count(*) into owned from pg_proc p where pg_get_userbyid(p.proowner) = 'crm_operator';
  if owned <> 8 or exists (
    select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
    where pg_get_userbyid(p.proowner) = 'crm_operator' and a.privilege_type = 'EXECUTE'
      and a.grantee not in ('crm_operator'::regrole, 'crm_app'::regrole)
  ) or exists (
    select 1 from pg_proc p
    where pg_get_userbyid(p.proowner) = 'crm_operator'
      and (not p.prosecdef or p.prosqlbody is null or p.proconfig <> array['search_path=pg_catalog, pg_temp'])
  ) or exists (
    select 1 from information_schema.role_table_grants g where g.grantee = 'crm_operator'
  ) or exists (
    select 1 from pg_attribute att cross join lateral aclexplode(att.attacl) a
    where a.grantee = 'crm_operator'::regrole and a.privilege_type <> 'SELECT'
      and not (att.attrelid = 'public.workspaces'::regclass and att.attname = 'early_access'
        and a.privilege_type = 'UPDATE')
  ) then
    raise exception '0194_partner_embed: crm_operator must own exactly its eight functions and update only early_access';
  end if;
end
$$;
