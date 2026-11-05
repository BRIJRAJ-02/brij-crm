-- The visit engine, slice B0 of spec 0066 (AC-6601 to AC-6606, and the rules settled by the cross check of 4 Nov 2026).
-- Numbered 0183 after H0's 0181 and H1's 0182.
--
-- What changes:
-- * Fourteen tenant tables: the services catalogue (`service_categories`, `services`, `service_variants` with a buffer
--   before and a processing window, `service_variant_staff` for per staff length and price, `service_places`,
--   `service_staff`, `service_resources`), staff (`staff`, `staff_places` with weekly shifts as a PlaceHours document,
--   `staff_time_off` and `staff_blocks` for staff with no linked member), and visits (`appointments`,
--   `appointment_items`, `appointment_holds`). Each with forced row level security and the plain workspace policy;
--   every index leads with workspace_id.
-- * Two database guards (AC-6602): no staff member and no resource holds two overlapping live holds (exclusion
--   constraints on `(workspace_id, staff_id, during)` and `(workspace_id, resource_id, during)` where live). A visit's
--   write takes the place lock and the person locks first; these are the last guard under them, and a `23P01` from
--   either reads as SLOT_TAKEN.
-- * `workspace_apps` takes the Appointments and Events apps; `consent_records` takes consents given on a visit or an
--   event registration (`source_type` `appointment` and `event_registration`).
--
-- Postgres 17 compatible (btree_gist came with 0041). Any change here goes through security-access-reviewer.
set local lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE "appointment_holds" (
	"workspace_id" uuid NOT NULL,
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"appointment_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"place_id" uuid NOT NULL,
	"staff_id" uuid,
	"resource_id" uuid,
	"during" "tstzrange" NOT NULL,
	"starts_at" timestamp (6) with time zone GENERATED ALWAYS AS (lower(during)) STORED,
	"ends_at" timestamp (6) with time zone GENERATED ALWAYS AS (upper(during)) STORED,
	"live" boolean DEFAULT true NOT NULL,
	CONSTRAINT "appointment_holds_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "appointment_holds_holder" CHECK (("appointment_holds"."staff_id" is null) <> ("appointment_holds"."resource_id" is null)),
	CONSTRAINT "appointment_holds_during" CHECK (not isempty("appointment_holds"."during") and lower_inc("appointment_holds"."during") and not upper_inc("appointment_holds"."during")
        and upper("appointment_holds"."during") - lower("appointment_holds"."during") <= interval '1 day')
);
--> statement-breakpoint
CREATE TABLE "appointment_items" (
	"workspace_id" uuid NOT NULL,
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"appointment_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"service_name" text NOT NULL,
	"variant_name" text NOT NULL,
	"starts_at" timestamp (6) with time zone NOT NULL,
	"ends_at" timestamp (6) with time zone NOT NULL,
	"price_minor" bigint DEFAULT 0 NOT NULL,
	"price_type" text NOT NULL,
	"staff_id" uuid,
	"position" smallint NOT NULL,
	CONSTRAINT "appointment_items_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "appointment_items_span" CHECK ("appointment_items"."ends_at" > "appointment_items"."starts_at"),
	CONSTRAINT "appointment_items_position" CHECK ("appointment_items"."position" between 0 and 4),
	CONSTRAINT "appointment_items_price" CHECK ("appointment_items"."price_minor" >= 0),
	CONSTRAINT "appointment_items_price_type" CHECK ("appointment_items"."price_type" in ('fixed', 'from', 'free', 'on_request')),
	CONSTRAINT "appointment_items_names" CHECK (char_length("appointment_items"."service_name") between 1 and 80 and char_length("appointment_items"."variant_name") between 1 and 60)
);
--> statement-breakpoint
CREATE TABLE "appointments" (
	"workspace_id" uuid NOT NULL,
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"place_id" uuid NOT NULL,
	"person_record_id" uuid,
	"client_name" text NOT NULL,
	"client_email" text,
	"client_phone" text,
	"note" text,
	"party_size" smallint DEFAULT 1 NOT NULL,
	"starts_at" timestamp (6) with time zone NOT NULL,
	"ends_at" timestamp (6) with time zone NOT NULL,
	"status" text DEFAULT 'booked' NOT NULL,
	"approval" text DEFAULT 'none' NOT NULL,
	"source" text NOT NULL,
	"manage_token_hash" text,
	"lookup_code" text NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"total_minor" bigint DEFAULT 0 NOT NULL,
	"currency" text NOT NULL,
	"created_by_member_id" uuid,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp (6) with time zone,
	"cancel_reason" text,
	"occasion" text,
	"arrived_at" timestamp (6) with time zone,
	"seated_at" timestamp (6) with time zone,
	"finished_at" timestamp (6) with time zone,
	CONSTRAINT "appointments_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "appointments_client_name" CHECK (char_length("appointments"."client_name") between 1 and 120),
	CONSTRAINT "appointments_client_email" CHECK (char_length("appointments"."client_email") <= 254),
	CONSTRAINT "appointments_client_phone" CHECK (char_length("appointments"."client_phone") <= 40),
	CONSTRAINT "appointments_note" CHECK (char_length("appointments"."note") <= 500),
	CONSTRAINT "appointments_party" CHECK ("appointments"."party_size" between 1 and 100),
	CONSTRAINT "appointments_span" CHECK ("appointments"."ends_at" > "appointments"."starts_at"),
	CONSTRAINT "appointments_status" CHECK ("appointments"."status" in ('booked', 'confirmed', 'arrived', 'started', 'completed', 'no_show', 'cancelled')),
	CONSTRAINT "appointments_approval" CHECK ("appointments"."approval" in ('none', 'pending', 'approved', 'declined')),
	CONSTRAINT "appointments_source" CHECK ("appointments"."source" in ('online', 'desk', 'walk_in')),
	CONSTRAINT "appointments_lookup_shape" CHECK ("appointments"."lookup_code" ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$'),
	CONSTRAINT "appointments_total" CHECK ("appointments"."total_minor" >= 0),
	CONSTRAINT "appointments_currency" CHECK ("appointments"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "appointments_cancel_reason" CHECK (char_length("appointments"."cancel_reason") <= 200),
	CONSTRAINT "appointments_occasion" CHECK ("appointments"."occasion" in ('birthday', 'anniversary', 'business', 'date', 'other'))
);
--> statement-breakpoint
CREATE TABLE "service_categories" (
	"workspace_id" uuid NOT NULL,
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"created_by_member_id" uuid,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_by_member_id" uuid,
	CONSTRAINT "service_categories_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "service_categories_name" CHECK (char_length("service_categories"."name") between 1 and 60)
);
--> statement-breakpoint
CREATE TABLE "service_places" (
	"workspace_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"place_id" uuid NOT NULL,
	CONSTRAINT "service_places_pkey" PRIMARY KEY("workspace_id","service_id","place_id")
);
--> statement-breakpoint
CREATE TABLE "service_resources" (
	"workspace_id" uuid NOT NULL,
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"service_id" uuid NOT NULL,
	"kind" text,
	"count" smallint DEFAULT 1 NOT NULL,
	"resource_id" uuid,
	CONSTRAINT "service_resources_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "service_resources_need" CHECK (("service_resources"."resource_id" is null) <> ("service_resources"."kind" is null) and "service_resources"."count" between 1 and 5
        and ("service_resources"."resource_id" is null or "service_resources"."count" = 1)
        and ("service_resources"."kind" is null or "service_resources"."kind" in ('table', 'room', 'chair', 'bed', 'court', 'station', 'equipment', 'other')))
);
--> statement-breakpoint
CREATE TABLE "service_staff" (
	"workspace_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	CONSTRAINT "service_staff_pkey" PRIMARY KEY("workspace_id","service_id","staff_id")
);
--> statement-breakpoint
CREATE TABLE "service_variant_staff" (
	"workspace_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"minutes" smallint,
	"price_minor" bigint,
	CONSTRAINT "service_variant_staff_pkey" PRIMARY KEY("workspace_id","variant_id","staff_id"),
	CONSTRAINT "service_variant_staff_values" CHECK (("service_variant_staff"."minutes" is not null or "service_variant_staff"."price_minor" is not null) and ("service_variant_staff"."minutes" is null or "service_variant_staff"."minutes" between 5 and 600)
        and ("service_variant_staff"."price_minor" is null or "service_variant_staff"."price_minor" >= 0))
);
--> statement-breakpoint
CREATE TABLE "service_variants" (
	"workspace_id" uuid NOT NULL,
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"service_id" uuid NOT NULL,
	"name" text NOT NULL,
	"minutes" smallint NOT NULL,
	"price_minor" bigint DEFAULT 0 NOT NULL,
	"price_type" text DEFAULT 'fixed' NOT NULL,
	"buffer_before_min" smallint DEFAULT 0 NOT NULL,
	"processing_after_min" smallint,
	"processing_min" smallint,
	"position" smallint NOT NULL,
	"archived_at" timestamp (6) with time zone,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_variants_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "service_variants_name" CHECK (char_length("service_variants"."name") between 1 and 60),
	CONSTRAINT "service_variants_minutes" CHECK ("service_variants"."minutes" between 5 and 600),
	CONSTRAINT "service_variants_price" CHECK ("service_variants"."price_minor" >= 0),
	CONSTRAINT "service_variants_price_type" CHECK ("service_variants"."price_type" in ('fixed', 'from', 'free', 'on_request')),
	CONSTRAINT "service_variants_buffer_before" CHECK ("service_variants"."buffer_before_min" between 0 and 120),
	CONSTRAINT "service_variants_processing" CHECK (("service_variants"."processing_after_min" is null) = ("service_variants"."processing_min" is null) and ("service_variants"."processing_min" is null
        or ("service_variants"."processing_after_min" >= 0 and "service_variants"."processing_min" > 0 and "service_variants"."processing_after_min" + "service_variants"."processing_min" < "service_variants"."minutes"))),
	CONSTRAINT "service_variants_position" CHECK ("service_variants"."position" between 0 and 7)
);
--> statement-breakpoint
CREATE TABLE "services" (
	"workspace_id" uuid NOT NULL,
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"category_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"slug" text NOT NULL,
	"buffer_after_min" smallint DEFAULT 0 NOT NULL,
	"online" boolean DEFAULT true NOT NULL,
	"capacity_mode" text DEFAULT 'one' NOT NULL,
	"staff_rule" text DEFAULT 'all' NOT NULL,
	"hold_by_size" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"intake_form_id" uuid,
	"sensitive" boolean DEFAULT false NOT NULL,
	"cancel_note" text,
	"step_min" smallint DEFAULT 15 NOT NULL,
	"notice_min" integer DEFAULT 0 NOT NULL,
	"window_days" smallint DEFAULT 60 NOT NULL,
	"covers_cap" smallint,
	"party_min" smallint DEFAULT 1 NOT NULL,
	"party_max" smallint DEFAULT 8 NOT NULL,
	"change_cutoff_min" integer DEFAULT 120 NOT NULL,
	"cancel_cutoff_min" integer DEFAULT 120 NOT NULL,
	"position" integer NOT NULL,
	"archived_at" timestamp (6) with time zone,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"created_by_member_id" uuid,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_by_member_id" uuid,
	CONSTRAINT "services_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "services_name" CHECK (char_length("services"."name") between 1 and 80),
	CONSTRAINT "services_description" CHECK (char_length("services"."description") <= 600),
	CONSTRAINT "services_slug_shape" CHECK ("services"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length("services"."slug") <= 80),
	CONSTRAINT "services_buffer_after" CHECK ("services"."buffer_after_min" between 0 and 120),
	CONSTRAINT "services_capacity_mode" CHECK ("services"."capacity_mode" in ('one', 'party')),
	CONSTRAINT "services_staff_rule" CHECK ("services"."staff_rule" in ('all', 'chosen', 'none')),
	CONSTRAINT "services_hold_by_size" CHECK (jsonb_typeof("services"."hold_by_size") = 'array' and jsonb_array_length("services"."hold_by_size") <= 8),
	CONSTRAINT "services_cancel_note" CHECK (char_length("services"."cancel_note") <= 200),
	CONSTRAINT "services_booking_rules" CHECK ("services"."step_min" between 5 and 240 and "services"."notice_min" between 0 and 43200
      and "services"."window_days" between 1 and 730 and ("services"."covers_cap" is null or "services"."covers_cap" between 1 and 1000)),
	CONSTRAINT "services_party" CHECK ("services"."party_min" between 1 and 100 and "services"."party_max" between "services"."party_min" and 100),
	CONSTRAINT "services_cutoffs" CHECK ("services"."change_cutoff_min" between 0 and 10080 and "services"."cancel_cutoff_min" between 0 and 10080)
);
--> statement-breakpoint
CREATE TABLE "staff" (
	"workspace_id" uuid NOT NULL,
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"title" text,
	"photo_path" text,
	"bio" text,
	"member_id" uuid,
	"position" integer NOT NULL,
	"archived_at" timestamp (6) with time zone,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"created_by_member_id" uuid,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_by_member_id" uuid,
	CONSTRAINT "staff_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "staff_name" CHECK (char_length("staff"."name") between 1 and 80),
	CONSTRAINT "staff_title" CHECK (char_length("staff"."title") <= 60),
	CONSTRAINT "staff_bio" CHECK (char_length("staff"."bio") <= 600),
	CONSTRAINT "staff_photo_path" CHECK (char_length("staff"."photo_path") <= 300)
);
--> statement-breakpoint
CREATE TABLE "staff_blocks" (
	"workspace_id" uuid NOT NULL,
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"staff_id" uuid NOT NULL,
	"place_id" uuid NOT NULL,
	"starts_at" timestamp (6) with time zone NOT NULL,
	"ends_at" timestamp (6) with time zone NOT NULL,
	"reason" text,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"created_by_member_id" uuid,
	CONSTRAINT "staff_blocks_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "staff_blocks_span" CHECK ("staff_blocks"."ends_at" > "staff_blocks"."starts_at" and "staff_blocks"."ends_at" - "staff_blocks"."starts_at" <= interval '31 days'),
	CONSTRAINT "staff_blocks_reason" CHECK (char_length("staff_blocks"."reason") <= 60)
);
--> statement-breakpoint
CREATE TABLE "staff_places" (
	"workspace_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"place_id" uuid NOT NULL,
	"shifts" jsonb DEFAULT '{"weekly":{},"exceptions":[]}'::jsonb NOT NULL,
	"outside_hours" boolean DEFAULT false NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_places_pkey" PRIMARY KEY("workspace_id","staff_id","place_id"),
	CONSTRAINT "staff_places_shifts" CHECK (jsonb_typeof("staff_places"."shifts") = 'object' and "staff_places"."shifts" ? 'weekly' and "staff_places"."shifts" ? 'exceptions')
);
--> statement-breakpoint
CREATE TABLE "staff_time_off" (
	"workspace_id" uuid NOT NULL,
	"id" uuid DEFAULT uuidv7() NOT NULL,
	"staff_id" uuid NOT NULL,
	"place_id" uuid,
	"starts_at" timestamp (6) with time zone NOT NULL,
	"ends_at" timestamp (6) with time zone NOT NULL,
	"reason" text DEFAULT 'other' NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"created_by_member_id" uuid,
	CONSTRAINT "staff_time_off_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "staff_time_off_span" CHECK ("staff_time_off"."ends_at" > "staff_time_off"."starts_at" and "staff_time_off"."ends_at" - "staff_time_off"."starts_at" <= interval '367 days'),
	CONSTRAINT "staff_time_off_reason" CHECK ("staff_time_off"."reason" in ('holiday', 'sick', 'training', 'other'))
);
--> statement-breakpoint
ALTER TABLE "appointment_holds" ADD CONSTRAINT "appointment_holds_item" FOREIGN KEY ("workspace_id","item_id") REFERENCES "public"."appointment_items"("workspace_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "appointment_holds" ADD CONSTRAINT "appointment_holds_appointment" FOREIGN KEY ("workspace_id","appointment_id") REFERENCES "public"."appointments"("workspace_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "appointment_holds" ADD CONSTRAINT "appointment_holds_staff_ref" FOREIGN KEY ("workspace_id","staff_id") REFERENCES "public"."staff"("workspace_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "appointment_holds" ADD CONSTRAINT "appointment_holds_resource_ref" FOREIGN KEY ("workspace_id","resource_id") REFERENCES "public"."resources"("workspace_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "appointment_holds" ADD CONSTRAINT "appointment_holds_place" FOREIGN KEY ("workspace_id","place_id") REFERENCES "public"."places"("workspace_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "appointment_items" ADD CONSTRAINT "appointment_items_appointment" FOREIGN KEY ("workspace_id","appointment_id") REFERENCES "public"."appointments"("workspace_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "appointment_items" ADD CONSTRAINT "appointment_items_service" FOREIGN KEY ("workspace_id","service_id") REFERENCES "public"."services"("workspace_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "appointment_items" ADD CONSTRAINT "appointment_items_variant" FOREIGN KEY ("workspace_id","variant_id") REFERENCES "public"."service_variants"("workspace_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "appointment_items" ADD CONSTRAINT "appointment_items_staff" FOREIGN KEY ("workspace_id","staff_id") REFERENCES "public"."staff"("workspace_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_place" FOREIGN KEY ("workspace_id","place_id") REFERENCES "public"."places"("workspace_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_person" FOREIGN KEY ("workspace_id","person_record_id") REFERENCES "public"."records"("workspace_id","id") ON DELETE set null ("person_record_id") ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "service_categories" ADD CONSTRAINT "service_categories_workspace" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "service_places" ADD CONSTRAINT "service_places_service" FOREIGN KEY ("workspace_id","service_id") REFERENCES "public"."services"("workspace_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "service_places" ADD CONSTRAINT "service_places_place" FOREIGN KEY ("workspace_id","place_id") REFERENCES "public"."places"("workspace_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "service_resources" ADD CONSTRAINT "service_resources_service" FOREIGN KEY ("workspace_id","service_id") REFERENCES "public"."services"("workspace_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "service_resources" ADD CONSTRAINT "service_resources_resource" FOREIGN KEY ("workspace_id","resource_id") REFERENCES "public"."resources"("workspace_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "service_staff" ADD CONSTRAINT "service_staff_service" FOREIGN KEY ("workspace_id","service_id") REFERENCES "public"."services"("workspace_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "service_staff" ADD CONSTRAINT "service_staff_staff" FOREIGN KEY ("workspace_id","staff_id") REFERENCES "public"."staff"("workspace_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "service_variant_staff" ADD CONSTRAINT "service_variant_staff_variant" FOREIGN KEY ("workspace_id","variant_id") REFERENCES "public"."service_variants"("workspace_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "service_variant_staff" ADD CONSTRAINT "service_variant_staff_staff" FOREIGN KEY ("workspace_id","staff_id") REFERENCES "public"."staff"("workspace_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "service_variants" ADD CONSTRAINT "service_variants_service" FOREIGN KEY ("workspace_id","service_id") REFERENCES "public"."services"("workspace_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_workspace" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_category" FOREIGN KEY ("workspace_id","category_id") REFERENCES "public"."service_categories"("workspace_id","id") ON DELETE set null ("category_id") ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_workspace" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_member" FOREIGN KEY ("workspace_id","member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "staff_blocks" ADD CONSTRAINT "staff_blocks_staff" FOREIGN KEY ("workspace_id","staff_id") REFERENCES "public"."staff"("workspace_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "staff_blocks" ADD CONSTRAINT "staff_blocks_place" FOREIGN KEY ("workspace_id","place_id") REFERENCES "public"."places"("workspace_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "staff_places" ADD CONSTRAINT "staff_places_staff" FOREIGN KEY ("workspace_id","staff_id") REFERENCES "public"."staff"("workspace_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "staff_places" ADD CONSTRAINT "staff_places_place" FOREIGN KEY ("workspace_id","place_id") REFERENCES "public"."places"("workspace_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "staff_time_off" ADD CONSTRAINT "staff_time_off_staff" FOREIGN KEY ("workspace_id","staff_id") REFERENCES "public"."staff"("workspace_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "staff_time_off" ADD CONSTRAINT "staff_time_off_place" FOREIGN KEY ("workspace_id","place_id") REFERENCES "public"."places"("workspace_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "appointment_holds_item" ON "appointment_holds" USING btree ("workspace_id","item_id");
--> statement-breakpoint
CREATE INDEX "appointment_holds_appointment" ON "appointment_holds" USING btree ("workspace_id","appointment_id");
--> statement-breakpoint
CREATE INDEX "appointment_holds_by_staff" ON "appointment_holds" USING btree ("workspace_id","staff_id","starts_at") WHERE "appointment_holds"."live" and "appointment_holds"."staff_id" is not null;
--> statement-breakpoint
CREATE INDEX "appointment_holds_by_resource" ON "appointment_holds" USING btree ("workspace_id","resource_id","starts_at") WHERE "appointment_holds"."live" and "appointment_holds"."resource_id" is not null;
--> statement-breakpoint
CREATE INDEX "appointment_holds_by_place" ON "appointment_holds" USING btree ("workspace_id","place_id","starts_at") WHERE "appointment_holds"."live";
--> statement-breakpoint
CREATE UNIQUE INDEX "appointment_items_order" ON "appointment_items" USING btree ("workspace_id","appointment_id","position");
--> statement-breakpoint
CREATE INDEX "appointment_items_service" ON "appointment_items" USING btree ("workspace_id","service_id");
--> statement-breakpoint
CREATE INDEX "appointment_items_variant" ON "appointment_items" USING btree ("workspace_id","variant_id");
--> statement-breakpoint
CREATE INDEX "appointment_items_staff" ON "appointment_items" USING btree ("workspace_id","staff_id","starts_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "appointments_attempt" ON "appointments" USING btree ("workspace_id","place_id","idempotency_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "appointments_manage_token" ON "appointments" USING btree ("workspace_id","manage_token_hash") WHERE "appointments"."manage_token_hash" is not null;
--> statement-breakpoint
CREATE UNIQUE INDEX "appointments_lookup_code" ON "appointments" USING btree ("workspace_id","lookup_code");
--> statement-breakpoint
CREATE INDEX "appointments_by_place" ON "appointments" USING btree ("workspace_id","place_id","starts_at");
--> statement-breakpoint
CREATE INDEX "appointments_person" ON "appointments" USING btree ("workspace_id","person_record_id");
--> statement-breakpoint
CREATE INDEX "appointments_by_email" ON "appointments" USING btree ("workspace_id","place_id",lower("client_email"),"starts_at");
--> statement-breakpoint
CREATE INDEX "service_categories_order" ON "service_categories" USING btree ("workspace_id","position");
--> statement-breakpoint
CREATE INDEX "service_places_place" ON "service_places" USING btree ("workspace_id","place_id");
--> statement-breakpoint
CREATE INDEX "service_resources_service" ON "service_resources" USING btree ("workspace_id","service_id");
--> statement-breakpoint
CREATE INDEX "service_resources_resource" ON "service_resources" USING btree ("workspace_id","resource_id");
--> statement-breakpoint
CREATE INDEX "service_staff_staff" ON "service_staff" USING btree ("workspace_id","staff_id");
--> statement-breakpoint
CREATE INDEX "service_variant_staff_staff" ON "service_variant_staff" USING btree ("workspace_id","staff_id");
--> statement-breakpoint
CREATE INDEX "service_variants_order" ON "service_variants" USING btree ("workspace_id","service_id","position");
--> statement-breakpoint
CREATE INDEX "services_category" ON "services" USING btree ("workspace_id","category_id","position");
--> statement-breakpoint
CREATE UNIQUE INDEX "services_slug" ON "services" USING btree ("workspace_id","slug") WHERE "services"."archived_at" is null;
--> statement-breakpoint
CREATE UNIQUE INDEX "staff_member" ON "staff" USING btree ("workspace_id","member_id") WHERE "staff"."member_id" is not null;
--> statement-breakpoint
CREATE INDEX "staff_order" ON "staff" USING btree ("workspace_id","position");
--> statement-breakpoint
CREATE INDEX "staff_blocks_by_staff" ON "staff_blocks" USING btree ("workspace_id","staff_id","starts_at");
--> statement-breakpoint
CREATE INDEX "staff_blocks_place" ON "staff_blocks" USING btree ("workspace_id","place_id");
--> statement-breakpoint
CREATE INDEX "staff_places_place" ON "staff_places" USING btree ("workspace_id","place_id");
--> statement-breakpoint
CREATE INDEX "staff_time_off_by_staff" ON "staff_time_off" USING btree ("workspace_id","staff_id","starts_at");
--> statement-breakpoint
CREATE INDEX "staff_time_off_place" ON "staff_time_off" USING btree ("workspace_id","place_id");
--> statement-breakpoint
-- No staff member holds two overlapping live holds, and no resource does (AC-6602).
alter table appointment_holds add constraint appointment_holds_staff
  exclude using gist (workspace_id with =, staff_id with =, during with &&) where (live and staff_id is not null);
--> statement-breakpoint
alter table appointment_holds add constraint appointment_holds_resource
  exclude using gist (workspace_id with =, resource_id with =, during with &&) where (live and resource_id is not null);
--> statement-breakpoint
alter table workspace_apps drop constraint workspace_apps_app;
--> statement-breakpoint
alter table workspace_apps add constraint workspace_apps_app
  check (app in ('menu', 'menu_qr', 'table_seating', 'appointments', 'events'));
--> statement-breakpoint
alter table consent_records drop constraint consent_records_source;
--> statement-breakpoint
alter table consent_records add constraint consent_records_source check (
  source_type in ('submission', 'member', 'site', 'appointment', 'event_registration')
  and (source_type <> 'submission' or (source_id is not null and question_id is not null))
);
--> statement-breakpoint
alter table service_categories enable row level security;
--> statement-breakpoint
alter table service_categories force row level security;
--> statement-breakpoint
create policy service_categories_tenant on service_categories
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
alter table services enable row level security;
--> statement-breakpoint
alter table services force row level security;
--> statement-breakpoint
create policy services_tenant on services
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
alter table service_variants enable row level security;
--> statement-breakpoint
alter table service_variants force row level security;
--> statement-breakpoint
create policy service_variants_tenant on service_variants
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
alter table service_variant_staff enable row level security;
--> statement-breakpoint
alter table service_variant_staff force row level security;
--> statement-breakpoint
create policy service_variant_staff_tenant on service_variant_staff
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
alter table service_places enable row level security;
--> statement-breakpoint
alter table service_places force row level security;
--> statement-breakpoint
create policy service_places_tenant on service_places
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
alter table service_staff enable row level security;
--> statement-breakpoint
alter table service_staff force row level security;
--> statement-breakpoint
create policy service_staff_tenant on service_staff
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
alter table service_resources enable row level security;
--> statement-breakpoint
alter table service_resources force row level security;
--> statement-breakpoint
create policy service_resources_tenant on service_resources
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
alter table staff enable row level security;
--> statement-breakpoint
alter table staff force row level security;
--> statement-breakpoint
create policy staff_tenant on staff
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
alter table staff_places enable row level security;
--> statement-breakpoint
alter table staff_places force row level security;
--> statement-breakpoint
create policy staff_places_tenant on staff_places
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
alter table staff_time_off enable row level security;
--> statement-breakpoint
alter table staff_time_off force row level security;
--> statement-breakpoint
create policy staff_time_off_tenant on staff_time_off
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
alter table staff_blocks enable row level security;
--> statement-breakpoint
alter table staff_blocks force row level security;
--> statement-breakpoint
create policy staff_blocks_tenant on staff_blocks
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
alter table appointments enable row level security;
--> statement-breakpoint
alter table appointments force row level security;
--> statement-breakpoint
create policy appointments_tenant on appointments
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
alter table appointment_items enable row level security;
--> statement-breakpoint
alter table appointment_items force row level security;
--> statement-breakpoint
create policy appointment_items_tenant on appointment_items
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
alter table appointment_holds enable row level security;
--> statement-breakpoint
alter table appointment_holds force row level security;
--> statement-breakpoint
create policy appointment_holds_tenant on appointment_holds
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
