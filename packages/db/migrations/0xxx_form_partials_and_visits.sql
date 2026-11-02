-- Forms: save and resume, and visit counts (spec 0063, AC-6319, AC-6320, AC-6329; 2 November 2026).
--
-- `form_partials` holds a visitor's part filled form so they can finish it later. It is found only by the SHA-256 of
-- a 32 byte token their link carries: the token itself is never stored, so a stolen row opens no one's answers. A
-- partial is never a submission — never filed, never notified, never counted, never in Submissions — and goes on
-- submit, with its form, and thirty days after it was made.
--
-- `form_visits` holds one row per form, UTC day and visitor, where the visitor is the daily keyed hash of spec 0047
-- and nothing else: the `form_visits_visitor` check writes AC-6320's privacy line into the database, so no cookie,
-- no address and no lasting visitor id can be put there. `source` is normalised to a UTM word or a referring host,
-- never a whole address.
--
-- Both are tenant tables: forced row level security and the standard workspace policy. The public endpoints reach
-- them only inside withWorkspace(), in the scope enterPublicForm() made from the form's public key.
set local lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE "form_partials" (
	"workspace_id" uuid NOT NULL,
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"form_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"answers" jsonb NOT NULL,
	"step_id" text,
	"ip_hash" text,
	"expires_at" timestamp (6) with time zone NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "form_partials_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "form_partials_token_hash" CHECK ("form_partials"."token_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "form_visits" (
	"workspace_id" uuid NOT NULL,
	"form_id" uuid NOT NULL,
	"day" date NOT NULL,
	"visitor" text NOT NULL,
	"version_id" uuid NOT NULL,
	"source" text DEFAULT 'direct' NOT NULL,
	"started_at" timestamp (6) with time zone,
	"completed_at" timestamp (6) with time zone,
	"furthest_question_id" text,
	"duration_ms" integer,
	"first_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"last_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "form_visits_pkey" PRIMARY KEY("workspace_id","form_id","day","visitor"),
	CONSTRAINT "form_visits_visitor" CHECK ("form_visits"."visitor" ~ '^[0-9a-f]{32}$'),
	CONSTRAINT "form_visits_source" CHECK (char_length("form_visits"."source") between 1 and 60),
	CONSTRAINT "form_visits_duration" CHECK ("form_visits"."duration_ms" is null or "form_visits"."duration_ms" >= 0)
);
--> statement-breakpoint
ALTER TABLE "form_partials" ADD CONSTRAINT "form_partials_workspace" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_partials" ADD CONSTRAINT "form_partials_form" FOREIGN KEY ("workspace_id","form_id") REFERENCES "public"."forms"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_partials" ADD CONSTRAINT "form_partials_version" FOREIGN KEY ("workspace_id","version_id") REFERENCES "public"."form_versions"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_visits" ADD CONSTRAINT "form_visits_workspace" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_visits" ADD CONSTRAINT "form_visits_form" FOREIGN KEY ("workspace_id","form_id") REFERENCES "public"."forms"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- The resume read: one partial by its token's hash, inside the workspace the public key already named.
CREATE UNIQUE INDEX "form_partials_token" ON "form_partials" USING btree ("workspace_id","token_hash");--> statement-breakpoint
-- The daily cleanup's pick, oldest first, and a form's own partials.
CREATE INDEX "form_partials_expiry" ON "form_partials" USING btree ("workspace_id","expires_at");--> statement-breakpoint
CREATE INDEX "form_partials_by_form" ON "form_partials" USING btree ("workspace_id","form_id","created_at");--> statement-breakpoint
-- The Analytics tab's range read, and the daily cleanup's oldest days first.
CREATE INDEX "form_visits_by_form_day" ON "form_visits" USING btree ("workspace_id","form_id","day");--> statement-breakpoint
CREATE INDEX "form_visits_day" ON "form_visits" USING btree ("workspace_id","day");--> statement-breakpoint

alter table form_partials enable row level security;
--> statement-breakpoint
alter table form_partials force row level security;
--> statement-breakpoint
create policy form_partials_tenant on form_partials
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
alter table form_visits enable row level security;
--> statement-breakpoint
alter table form_visits force row level security;
--> statement-breakpoint
create policy form_visits_tenant on form_visits
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
