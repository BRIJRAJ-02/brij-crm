// Creates (or updates the password of) one login role inside one group role,
// as the owner. `app-login.ts` and `identity-login.ts` both use it, so the two
// logins are made the same way. Roles made in SQL (not in the Neon console)
// get no extra powers.
import pg from 'pg';
import { assertDirectUrl } from '../src/direct.ts';

/** Which login to make: from which variable's URL, into which group, and the group it must stay out of. */
export interface LoginSpec {
  /** The owner's direct URL, which runs the statements. */
  readonly ownerUrl: string;
  /** The URL the login will connect with; its user and password name the role. */
  readonly loginUrl: string;
  /** The variable `loginUrl` came from, for messages. */
  readonly variable: string;
  /** The group role the login joins (`crm_app` or `crm_identity`). */
  readonly group: string;
  /** The other group, which the login must never be in, so one login can't reach both sides. */
  readonly apartFrom: string;
}

/** Creates the login named in `loginUrl` inside `group`, or sets its password if it exists. */
export async function ensureLogin(spec: LoginSpec): Promise<void> {
  assertDirectUrl(spec.ownerUrl, 'DATABASE_URL_OWNER');
  const url = new URL(spec.loginUrl);
  const login = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  if (!login || !password) {
    throw new Error(`${spec.variable} needs its login role and a password.`);
  }

  const client = new pg.Client({ connectionString: spec.ownerUrl, application_name: 'crm-login' });
  await client.connect();
  try {
    const owner = await client.query<{ current_user: string }>('select current_user');
    if (owner.rows[0]?.current_user === login) {
      throw new Error(`${spec.variable} uses the owner role. It needs its own login role.`);
    }
    const role = client.escapeIdentifier(login);
    const secret = client.escapeLiteral(password);
    const existing = await client.query('select 1 from pg_roles where rolname = $1', [login]);
    if (existing.rowCount === 0) {
      await client.query(
        `create role ${role} login password ${secret} nosuperuser nobypassrls nocreatedb nocreaterole`,
      );
      console.log(`Created login role "${login}".`);
    } else {
      await client.query(`alter role ${role} with login password ${secret}`);
      console.log(`Updated the password of login role "${login}".`);
    }
    // The other group may not exist yet (a database before the migration that makes it).
    const apart = await client.query<{ member: boolean }>(
      `select case when exists (select 1 from pg_roles where rolname = $2)
        then pg_has_role($1, $2, 'MEMBER') else false end as member`,
      [login, spec.apartFrom],
    );
    if (apart.rows[0]?.member === true) {
      throw new Error(`"${login}" is a member of ${spec.apartFrom}. Use a separate login for ${spec.variable}.`);
    }
    await client.query(`grant ${client.escapeIdentifier(spec.group)} to ${role}`);
    console.log(`"${login}" is a member of ${spec.group}.`);
  } finally {
    await client.end();
  }
}
