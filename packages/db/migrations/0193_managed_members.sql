-- Managed members (spec 0070, slice 3, AC-7020 to AC-7025).
--
-- Numbered 0193 and stamped after 0192 (partner connect, slice 2), which lands first.
--
-- `managed_members` (tenant, forced row level security, the plain policy): a person a partner added to the workspace,
-- keyed by the partner and the partner's own id for them (never by email, AC-7021), with the member row and the
-- identity it made. The connection that last wrote it is kept, so a partner that disconnects and connects again
-- still finds the same people. `removed_at` is set by the partner's DELETE (the member row is removed as any removal
-- is); a later PUT for the same id brings the same identity back, so their handle and page return (AC-5603).
--
-- `auth.managed_users` (global, the identity login's, like the rest of schema `auth`): which identities a partner
-- made. A managed identity's `auth.user.email` is a made up address under `.invalid` (RFC 2606), so no sign in by
-- email or Google ever finds it and no Timefix account with the person's real address is ever merged with it
-- (AC-7021, AC-7023); the person's real address lives only on their member row. It has no password and no linked
-- account. Deleting the identity takes this row with it.
set local lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE "managed_members" (
  "workspace_id" uuid NOT NULL,
  "id" uuid DEFAULT uuidv7() NOT NULL,
  "partner_id" uuid NOT NULL,
  "external_id" text NOT NULL,
  "connection_id" uuid NOT NULL,
  "member_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
  "removed_at" timestamp (6) with time zone,
  CONSTRAINT "managed_members_pkey" PRIMARY KEY("workspace_id","id"),
  CONSTRAINT "managed_members_external_id" CHECK ("external_id" ~ '^[A-Za-z0-9._~:@+=|-]{1,128}$')
);
--> statement-breakpoint
ALTER TABLE "managed_members" ADD CONSTRAINT "managed_members_workspace" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "managed_members" ADD CONSTRAINT "managed_members_connection" FOREIGN KEY ("workspace_id","connection_id") REFERENCES "public"."partner_connections"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "managed_members" ADD CONSTRAINT "managed_members_member" FOREIGN KEY ("workspace_id","member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "managed_members_external" ON "managed_members" USING btree ("workspace_id","partner_id","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "managed_members_member_ix" ON "managed_members" USING btree ("workspace_id","member_id");--> statement-breakpoint
CREATE INDEX "managed_members_connection_ix" ON "managed_members" USING btree ("workspace_id","connection_id");--> statement-breakpoint
ALTER TABLE "managed_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "managed_members" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "managed_members_tenant" ON "managed_members"
  USING ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
CREATE TABLE "auth"."managed_users" (
  "user_id" uuid PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL,
  "partner_id" uuid NOT NULL,
  "external_id" text NOT NULL,
  "created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "managed_users_external_id" CHECK ("external_id" ~ '^[A-Za-z0-9._~:@+=|-]{1,128}$')
);
--> statement-breakpoint
ALTER TABLE "auth"."managed_users" ADD CONSTRAINT "managed_users_user" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "managed_users_external" ON "auth"."managed_users" USING btree ("workspace_id","partner_id","external_id");
