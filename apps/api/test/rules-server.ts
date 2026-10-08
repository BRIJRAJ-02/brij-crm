// A local test server: the api with object, field and record rules injected
// into its door (spec 0009, milestone 2, step 11), for a Playwright run that
// shows a hidden column and hidden rows absent from the People table before
// #24 stores rules. Never deployed, never in the image's entrypoints: it
// refuses anything but APP_ENV=local on a localhost database.
//
//   ACCESS_RULES_FILE=rules.json node --env-file=../../.env test/rules-server.ts
//
// The file names attributes by `<object api name>.<attribute api name>`, for
// one role: {"role":"member","hidden":["people.job_title"],
// "readOnly":["people.description"],"own":"people.owner"}.
import { readFile } from 'node:fs/promises';
import { serve } from '@hono/node-server';
import type { AccessRules, RuleSource } from '@crm/core';
import { createDatabase, createIdentityStore, schema } from '@crm/db';
import * as z from 'zod';
import { createApp } from '../src/app.ts';
import { createAuth } from '../src/auth/auth.ts';
import { ApiEnv, loadEnv } from '../src/env.ts';
import { log } from '../src/log.ts';
import { createMailer } from '../src/mail/mailer.ts';
import { NO_WAKE } from '../src/realtime/wake.ts';

const RulesFile = z.object({
  role: z.string(),
  hidden: z.array(z.string()).default([]),
  readOnly: z.array(z.string()).default([]),
  own: z.string().optional(),
});
type RulesFile = z.infer<typeof RulesFile>;

const env = loadEnv(ApiEnv);
const file = z.string().min(1).parse(process.env.ACCESS_RULES_FILE);
for (const url of [env.DATABASE_URL, env.IDENTITY_DATABASE_URL]) {
  if (env.APP_ENV !== 'local' || !['localhost', '127.0.0.1'].includes(new URL(url).hostname)) {
    throw new Error('The rules server runs only locally, on a localhost database.');
  }
}
const wanted: RulesFile = RulesFile.parse(JSON.parse(await readFile(file, 'utf8')));

/** The rules the file names, with each `object.attribute` resolved to ids in the door's transaction. */
const rules: RuleSource = async (tx) => {
  const objects = await tx.select({ id: schema.objects.id, slug: schema.objects.apiSlug }).from(schema.objects);
  const attributes = await tx
    .select({ id: schema.attributes.id, objectId: schema.attributes.objectId, slug: schema.attributes.apiSlug })
    .from(schema.attributes);
  const slugOf = new Map(objects.map((object) => [object.id, object.slug]));
  const byName = new Map(
    attributes.flatMap((attribute) =>
      attribute.objectId === null
        ? []
        : [
            [
              `${slugOf.get(attribute.objectId) ?? ''}.${attribute.slug}`,
              { ...attribute, objectId: attribute.objectId },
            ],
          ],
    ),
  );
  const subject = { type: 'role' as const, role: wanted.role };
  const level = (name: string, value: string) => {
    const attribute = byName.get(name);
    return attribute === undefined
      ? []
      : [
          {
            subject,
            target: { type: 'attribute' as const, objectId: attribute.objectId, attributeId: attribute.id },
            level: value,
          },
        ];
  };
  const own = wanted.own === undefined ? undefined : byName.get(wanted.own);
  const result: AccessRules = {
    levels: [
      ...wanted.hidden.flatMap((name) => level(name, 'hidden')),
      ...wanted.readOnly.flatMap((name) => level(name, 'read')),
    ],
    records: own === undefined ? [] : [{ subject, objectId: own.objectId, kind: 'own', attributeId: own.id }],
  };
  return result;
};

const db = createDatabase({ url: env.DATABASE_URL, applicationName: 'crm-api-rules' });
const identity = createIdentityStore({ url: env.IDENTITY_DATABASE_URL, applicationName: 'crm-api-rules-identity' });
await db.assertAppRole();
await identity.assertIdentityRole();
const auth = createAuth({ env, identity, mailer: createMailer(env) });
serve(
  { fetch: createApp({ services: { db, identity, auth, wakeRelay: NO_WAKE, rules }, env }).fetch, port: env.PORT },
  (info) => log.info('Rules test server listening', { port: info.port, role: wanted.role }),
);
