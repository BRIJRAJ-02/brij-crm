-- Partners and connections (spec 0070, slice 2, AC-7010 to AC-7013).
--
-- Numbered 0192 and stamped after 0191 (team link pages, slice 1), which lands first.
--
-- `auth.partners` (global, the identity login's, like the rest of schema `auth`): an outside product a super admin
-- registered, its logo, the origins that may frame Timefix, the exact addresses a connect may send back to, and the
-- SHA-256 of its secret with the secret's last four characters. Never the secret.
--
-- `partner_connections` and `partner_codes` (tenant, forced row level security, the plain policy): a partner linked
-- to one workspace by an owner, with the modules it may use and the SHA-256 of its access token; and the one time
-- codes of the OAuth connect (60 seconds, used once, bound to the partner, the redirect address and the PKCE
-- challenge). The door reads a connection, and the exchange a code, under the workspace their tokens' public half
-- names, so no lookup crosses workspaces and no new role exists.
--
-- `actor_type` gains `partner`, for slice 3's History rows written as the partner. No check names it: every actor
-- check compares as text and admits any type but member, system and calendar with an id.
set local lock_timeout = '5s';
--> statement-breakpoint
ALTER TYPE "public"."actor_type" ADD VALUE 'partner';--> statement-breakpoint
CREATE TABLE "auth"."partners" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "client_id" text NOT NULL,
  "name" text NOT NULL,
  "logo" bytea,
  "logo_type" text,
  "logo_version" integer DEFAULT 0 NOT NULL,
  "frame_origins" text[] NOT NULL,
  "redirect_uris" text[] NOT NULL,
  "secret_hash" bytea NOT NULL,
  "secret_hint" text NOT NULL,
  "created_by" uuid NOT NULL,
  "created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
  "secret_replaced_at" timestamp (6) with time zone,
  CONSTRAINT "partners_client_id_shape" CHECK ("auth"."partners"."client_id" ~ '^tfp_[A-Za-z0-9_-]{22}$'),
  CONSTRAINT "partners_name" CHECK (char_length("auth"."partners"."name") between 1 and 80),
  CONSTRAINT "partners_logo" CHECK (("auth"."partners"."logo" is null and "auth"."partners"."logo_type" is null) or (octet_length("auth"."partners"."logo") between 1 and 204800 and "auth"."partners"."logo_type" in ('image/png', 'image/jpeg', 'image/webp'))),
  CONSTRAINT "partners_frame_origins" CHECK (cardinality("auth"."partners"."frame_origins") <= 10),
  CONSTRAINT "partners_redirect_uris" CHECK (cardinality("auth"."partners"."redirect_uris") between 1 and 10),
  CONSTRAINT "partners_secret_hash" CHECK (octet_length("auth"."partners"."secret_hash") = 32),
  CONSTRAINT "partners_secret_hint" CHECK (char_length("auth"."partners"."secret_hint") = 4)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "partners_client_id" ON "auth"."partners" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "partners_created" ON "auth"."partners" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE TABLE "partner_connections" (
  "workspace_id" uuid NOT NULL,
  "id" uuid DEFAULT uuidv7() NOT NULL,
  "partner_id" uuid NOT NULL,
  "modules" text[] NOT NULL,
  "approved_by_member_id" uuid NOT NULL,
  "token_hash" bytea NOT NULL,
  "created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
  "last_call_at" timestamp (6) with time zone,
  "disconnected_at" timestamp (6) with time zone,
  "disconnected_by_member_id" uuid,
  CONSTRAINT "partner_connections_pkey" PRIMARY KEY("workspace_id","id"),
  CONSTRAINT "partner_connections_modules" CHECK (cardinality("modules") between 1 and 20 and "modules" <@ array['link_pages']::text[]),
  CONSTRAINT "partner_connections_token_hash" CHECK (octet_length("token_hash") = 32),
  CONSTRAINT "partner_connections_disconnected" CHECK ("disconnected_by_member_id" is null or "disconnected_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "partner_codes" (
  "workspace_id" uuid NOT NULL,
  "id" uuid DEFAULT uuidv7() NOT NULL,
  "partner_id" uuid NOT NULL,
  "code_hash" bytea NOT NULL,
  "code_challenge" text NOT NULL,
  "redirect_uri" text NOT NULL,
  "modules" text[] NOT NULL,
  "approved_by_member_id" uuid NOT NULL,
  "created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp (6) with time zone NOT NULL,
  "used_at" timestamp (6) with time zone,
  "connection_id" uuid,
  CONSTRAINT "partner_codes_pkey" PRIMARY KEY("workspace_id","id"),
  CONSTRAINT "partner_codes_code_hash" CHECK (octet_length("code_hash") = 32),
  CONSTRAINT "partner_codes_challenge" CHECK ("code_challenge" ~ '^[A-Za-z0-9_-]{43}$'),
  CONSTRAINT "partner_codes_redirect" CHECK (char_length("redirect_uri") between 1 and 500),
  CONSTRAINT "partner_codes_modules" CHECK (cardinality("modules") between 1 and 20 and "modules" <@ array['link_pages']::text[]),
  CONSTRAINT "partner_codes_expiry" CHECK ("expires_at" > "created_at"),
  CONSTRAINT "partner_codes_used" CHECK (("used_at" is null) = ("connection_id" is null))
);
--> statement-breakpoint
ALTER TABLE "partner_connections" ADD CONSTRAINT "partner_connections_workspace" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_connections" ADD CONSTRAINT "partner_connections_approved_by" FOREIGN KEY ("workspace_id","approved_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_connections" ADD CONSTRAINT "partner_connections_disconnected_by" FOREIGN KEY ("workspace_id","disconnected_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_codes" ADD CONSTRAINT "partner_codes_workspace" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_codes" ADD CONSTRAINT "partner_codes_approved_by" FOREIGN KEY ("workspace_id","approved_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_codes" ADD CONSTRAINT "partner_codes_connection" FOREIGN KEY ("workspace_id","connection_id") REFERENCES "public"."partner_connections"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "partner_connections_live" ON "partner_connections" USING btree ("workspace_id","partner_id") WHERE "partner_connections"."disconnected_at" is null;--> statement-breakpoint
CREATE INDEX "partner_connections_list" ON "partner_connections" USING btree ("workspace_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "partner_codes_expires" ON "partner_codes" USING btree ("workspace_id","expires_at");--> statement-breakpoint
CREATE INDEX "partner_codes_connection_ix" ON "partner_codes" USING btree ("workspace_id","connection_id");--> statement-breakpoint
ALTER TABLE "partner_connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "partner_connections" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "partner_connections_tenant" ON "partner_connections"
  USING ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "partner_codes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "partner_codes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "partner_codes_tenant" ON "partner_codes"
  USING ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
