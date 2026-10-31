-- API keys (parity #34, the first slice; see the design note for /architect). PLACEHOLDER number: renumber after
-- main's last migration when this lands, and stamp the journal's `when` then.
--
-- `api_keys`: a key's name, scopes, the SHA-256 of its secret and the secret's last four characters, who made it (its
-- access never exceeds theirs), when it was last used and when it was revoked. Never the secret. A tenant table under
-- forced row level security with the plain policy: the door reads a key under the workspace its public half names, so
-- no lookup across workspaces and no new role exist.
set local lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE "api_keys" (
  "workspace_id" uuid NOT NULL,
  "id" uuid DEFAULT uuidv7() NOT NULL,
  "name" text NOT NULL,
  "scopes" text[] NOT NULL,
  "secret_hash" bytea NOT NULL,
  "hint" text NOT NULL,
  "created_by_member_id" uuid NOT NULL,
  "created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
  "last_used_at" timestamp (6) with time zone,
  "revoked_at" timestamp (6) with time zone,
  "revoked_by_member_id" uuid,
  CONSTRAINT "api_keys_pkey" PRIMARY KEY("workspace_id","id"),
  CONSTRAINT "api_keys_name" CHECK (char_length("name") between 1 and 80),
  CONSTRAINT "api_keys_scopes" CHECK (cardinality("scopes") between 1 and 2 and "scopes" <@ array['data.read', 'data.write']::text[]),
  CONSTRAINT "api_keys_secret_hash" CHECK (octet_length("secret_hash") = 32),
  CONSTRAINT "api_keys_hint" CHECK (char_length("hint") = 4),
  CONSTRAINT "api_keys_revoked" CHECK (("revoked_at" is null) = ("revoked_by_member_id" is null))
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_workspace" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by" FOREIGN KEY ("workspace_id","created_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_revoked_by" FOREIGN KEY ("workspace_id","revoked_by_member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_keys_list" ON "api_keys" USING btree ("workspace_id","created_at" DESC NULLS LAST) WHERE "api_keys"."revoked_at" is null;--> statement-breakpoint
ALTER TABLE "api_keys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "api_keys" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "api_keys_tenant" ON "api_keys"
  USING ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
