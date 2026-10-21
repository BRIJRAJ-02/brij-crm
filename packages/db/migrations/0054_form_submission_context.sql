-- Where a submission came from (spec 0023, the embeds): page, landing, referrer, UTM tags, passed parameters, the
-- embed mode and, only with the site's consent, the visitor id. Null for every submission before it.
ALTER TABLE "form_submissions" ADD COLUMN "context" jsonb;