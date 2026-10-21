-- The record ids bookings and form submissions hold with no foreign key (spec 0022's purge registry): a company's
-- and a deal's bookings, and a record's submissions as their main record. The purge clears them when the record goes
-- for good, through these indexes, as every registered dependent goes through one that leads with its record (the
-- person's already has bookings_by_person). All partial, so they stay small. drizzle-kit's; the header and the lock
-- timeout are hand written. Building them briefly blocks writes to the two tables: give up after 5 seconds rather
-- than queue behind traffic, like 0045.
set local lock_timeout = '5s';
--> statement-breakpoint
CREATE INDEX "bookings_by_company" ON "bookings" USING btree ("workspace_id","company_record_id") WHERE "bookings"."company_record_id" is not null;--> statement-breakpoint
CREATE INDEX "bookings_by_deal" ON "bookings" USING btree ("workspace_id","deal_record_id") WHERE "bookings"."deal_record_id" is not null;--> statement-breakpoint
CREATE INDEX "form_submissions_by_main_record" ON "form_submissions" USING btree ("workspace_id","main_record_id") WHERE "form_submissions"."main_record_id" is not null;