-- Consent records (spec 0023, AC-1053, AC-578; 3 November 2026).
--
-- A Consent question shows its exact words beside a tick box. When a submission is filed onto a person, each consent
-- it answered becomes one row here: the answer, the words, their version and the time, with the submission as its
-- source. Rows are only ever inserted: a withdrawal is a new row, never an edit, so a person's latest row for a
-- purpose is their answer and every earlier one stays as the record of what they agreed to and when.
--
-- A tenant table: forced row level security and the standard workspace policy. Like every row hanging off a record
-- it restricts rather than cascades; the purge registry deletes a person's consents with them (erasure, AC-575) and
-- a merge moves them onto the person kept.
set local lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE "consent_records" (
	"workspace_id" uuid NOT NULL,
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"record_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"granted" boolean NOT NULL,
	"wording" text NOT NULL,
	"wording_version" integer NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid,
	"at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consent_records_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "consent_records_purpose" CHECK ("consent_records"."purpose" ~ '^[a-z][a-z0-9_]{0,39}$'),
	CONSTRAINT "consent_records_wording" CHECK (char_length("consent_records"."wording") between 1 and 2000),
	CONSTRAINT "consent_records_version" CHECK ("consent_records"."wording_version" >= 1),
	CONSTRAINT "consent_records_source" CHECK (
		"consent_records"."source_type" in ('submission', 'member', 'site')
		and ("consent_records"."source_type" <> 'submission' or "consent_records"."source_id" is not null)
	)
);
--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_workspace" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- No `on delete` action: the purge deletes these rows first, with the record's other links.
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_record" FOREIGN KEY ("workspace_id","record_id") REFERENCES "public"."records"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- A person's latest consent for a purpose (AC-579), and the purge and merge by record.
CREATE INDEX "consent_records_by_record" ON "consent_records" USING btree ("workspace_id","record_id","purpose","at" DESC);--> statement-breakpoint
-- What a submission (or a member, or a site) gave. A job run twice never writes twice: processing only runs for a
-- submission still `received`, under its row lock.
CREATE INDEX "consent_records_by_source" ON "consent_records" USING btree ("workspace_id","source_type","source_id");--> statement-breakpoint

alter table consent_records enable row level security;
--> statement-breakpoint
alter table consent_records force row level security;
--> statement-breakpoint
create policy consent_records_tenant on consent_records
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
