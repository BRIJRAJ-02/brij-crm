CREATE SCHEMA "auth";
--> statement-breakpoint
CREATE TABLE "auth"."account" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp (6) with time zone,
	"refresh_token_expires_at" timestamp (6) with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth"."rate_limit" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth"."session" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"expires_at" timestamp (6) with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth"."user" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_lowercase" CHECK ("auth"."user"."email" = lower("auth"."user"."email"))
);
--> statement-breakpoint
CREATE TABLE "auth"."verification" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp (6) with time zone NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (6) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth"."workspace_directory" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_directory_slug_shape" CHECK ("auth"."workspace_directory"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length("auth"."workspace_directory"."slug") between 3 and 40)
);
--> statement-breakpoint
CREATE TABLE "auth"."workspace_membership" (
	"user_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"created_at" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_membership_pkey" PRIMARY KEY("user_id","workspace_id")
);
--> statement-breakpoint
ALTER TABLE "auth"."account" ADD CONSTRAINT "account_user_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."session" ADD CONSTRAINT "session_user_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."workspace_directory" ADD CONSTRAINT "workspace_directory_workspace" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."workspace_membership" ADD CONSTRAINT "workspace_membership_user" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."workspace_membership" ADD CONSTRAINT "workspace_membership_directory" FOREIGN KEY ("workspace_id") REFERENCES "auth"."workspace_directory"("workspace_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."workspace_membership" ADD CONSTRAINT "workspace_membership_member" FOREIGN KEY ("workspace_id","member_id") REFERENCES "public"."members"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_provider" ON "auth"."account" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "account_user" ON "auth"."account" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rate_limit_key" ON "auth"."rate_limit" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "session_token" ON "auth"."session" USING btree ("token");--> statement-breakpoint
CREATE INDEX "session_user" ON "auth"."session" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_email" ON "auth"."user" USING btree ("email");--> statement-breakpoint
CREATE INDEX "verification_identifier" ON "auth"."verification" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_directory_slug" ON "auth"."workspace_directory" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "workspace_membership_workspace" ON "auth"."workspace_membership" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "members_user" ON "members" USING btree ("workspace_id","user_id") WHERE "members"."status" = 'active';