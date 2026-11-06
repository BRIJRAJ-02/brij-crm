// The sample partner's local stack (spec 0070, slice 2): a throwaway database migrated to the newest schema, with the
// sample hub registered as a partner, so the whole connect runs end to end on a laptop without touching anyone's
// `crm` database. Test tooling only, never shipped.
//
//   node tools/partner-sample/setup.ts [--port=5390] [--out=<file>]   prepare, register, write the settings as JSON
//   node tools/partner-sample/setup.ts --drop                         drop the database again
//
// The JSON holds the database's logins (test only, as every test database's) and the partner's client id and
// secret, for the api's environment and the sample's.
import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { registerPartner } from '@crm/core';
import { createIdentityStore } from '@crm/db';
import { dropTestDatabase, prepareTestDatabase } from '@crm/db/testing';

const DATABASE = 'crm_test_partner_sample';

const { values } = parseArgs({
  options: {
    port: { type: 'string', default: '5390' },
    out: { type: 'string' },
    drop: { type: 'boolean', default: false },
  },
});

if (values.drop) {
  // The checkout's own copy: prepareTestDatabase named it, so it is found the same way.
  const prepared = await prepareTestDatabase(DATABASE);
  await dropTestDatabase(prepared);
  process.stdout.write(`Dropped ${prepared.name}\n`);
} else {
  const database = await prepareTestDatabase(DATABASE);
  const identity = createIdentityStore({ url: database.identityUrl, applicationName: 'crm-partner-sample' });
  try {
    const made = await registerPartner(
      { partners: identity },
      {
        name: 'Sample Hub',
        frameOrigins: [`http://localhost:${values.port}`],
        redirectUris: [`http://localhost:${values.port}/callback`],
      },
      { userId: '00000000-0000-0000-0000-000000000000', action: 'operator.partnerSample', requestId: 'partner-sample' },
    );
    const settings = {
      database: database.name,
      appUrl: database.appUrl,
      identityUrl: database.identityUrl,
      workerUrl: database.workerUrl,
      ownerUrl: database.ownerUrl,
      clientId: made.partner.clientId,
      clientSecret: made.secret,
    };
    const text = `${JSON.stringify(settings, null, 2)}\n`;
    if (values.out === undefined) process.stdout.write(text);
    else await writeFile(values.out, text, { mode: 0o600 });
  } finally {
    await identity.close();
  }
}
