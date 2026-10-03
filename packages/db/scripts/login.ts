// Creates (or updates the password of) one login role inside one group role,
// as the owner. `app-login.ts` and `identity-login.ts` both use it, so the two
// logins are made the same way. Roles made in SQL (not in the Neon console)
// get no extra powers, and an existing role loses any it had.
import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';
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

/** The iteration count Postgres (and psql's `\password`) uses for SCRAM-SHA-256. */
export const SCRAM_ITERATIONS = 4096;

/** The powers a login must not hold, as `pg_roles` columns and the `alter role` words that clear them. */
const POWERS = [
  ['rolsuper', 'nosuperuser'],
  ['rolbypassrls', 'nobypassrls'],
  ['rolcreatedb', 'nocreatedb'],
  ['rolcreaterole', 'nocreaterole'],
  ['rolreplication', 'noreplication'],
] as const;

type Powers = Record<(typeof POWERS)[number][0], boolean>;

/**
 * The SCRAM-SHA-256 verifier Postgres stores for `password`, computed here as
 * psql's `\password` does (PBKDF2 with SHA-256, 4096 iterations, a random 16
 * byte salt), so the plain password never travels in a statement, and never
 * lands in a server log or `pg_stat_statements`. Postgres keeps a verifier it
 * is sent as it is. Printable ASCII only: Postgres runs a password through
 * SASLprep first, which leaves ASCII alone but could change anything else.
 */
export function scramVerifier(password: string, salt: Buffer = randomBytes(16)): string {
  if (!/^[\x20-\x7e]+$/.test(password)) {
    throw new Error('A login password must be printable ASCII, so its verifier matches the one Postgres computes.');
  }
  const salted = pbkdf2Sync(password, salt, SCRAM_ITERATIONS, 32, 'sha256');
  const clientKey = createHmac('sha256', salted).update('Client Key').digest();
  const storedKey = createHash('sha256').update(clientKey).digest();
  const serverKey = createHmac('sha256', salted).update('Server Key').digest();
  return `SCRAM-SHA-256$${SCRAM_ITERATIONS}:${salt.toString('base64')}$${storedKey.toString('base64')}:${serverKey.toString('base64')}`;
}

async function powersOf(client: pg.Client, login: string): Promise<Powers | undefined> {
  const result = await client.query<Powers>(
    `select ${POWERS.map(([column]) => column).join(', ')} from pg_roles where rolname = $1`,
    [login],
  );
  return result.rows[0];
}

/** Refuses a login in any group but `spec.group` (directly), or in `spec.apartFrom` (by any path). */
async function assertOnlyItsGroup(client: pg.Client, login: string, spec: LoginSpec): Promise<void> {
  // Only its own group: any other (a Neon console role's neon_superuser, say) could reach what this one must not.
  const others = await client.query<{ name: string }>(
    `select g.rolname as name from pg_auth_members m
     join pg_roles g on g.oid = m.roleid join pg_roles r on r.oid = m.member
     where r.rolname = $1 and g.rolname <> $2 order by 1`,
    [login, spec.group],
  );
  if (others.rows.length > 0) {
    throw new Error(
      `"${login}" is a member of ${others.rows.map((row) => row.name).join(', ')}. ` +
        `A login belongs to ${spec.group} only; use a separate login for ${spec.variable}.`,
    );
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
}

/**
 * Creates the login named in `loginUrl` inside `group`, or, if it exists,
 * clears any power it holds and sets its password. Refuses a role in any
 * group but `group`, and one in `apartFrom` by any path.
 */
export async function ensureLogin(spec: LoginSpec): Promise<void> {
  assertDirectUrl(spec.ownerUrl, 'DATABASE_URL_OWNER');
  const url = new URL(spec.loginUrl);
  const login = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  if (!login || !password) {
    throw new Error(`${spec.variable} needs its login role and a password.`);
  }
  const verifier = scramVerifier(password);

  const client = new pg.Client({ connectionString: spec.ownerUrl, application_name: 'crm-login' });
  await client.connect();
  try {
    const owner = await client.query<{ current_user: string }>('select current_user');
    if (owner.rows[0]?.current_user === login) {
      throw new Error(`${spec.variable} uses the owner role. It needs its own login role.`);
    }
    const role = client.escapeIdentifier(login);
    const secret = client.escapeLiteral(verifier);
    const existing = await powersOf(client, login);
    if (existing === undefined) {
      await client.query(
        `create role ${role} login password ${secret} nosuperuser nobypassrls nocreatedb nocreaterole noreplication`,
      );
      console.log(`Created login role "${login}".`);
    } else {
      await assertOnlyItsGroup(client, login, spec);
      // Only a power it holds is cleared: Postgres refuses even `nosuperuser` from a role that isn't a superuser.
      const held = POWERS.filter(([column]) => existing[column]).map(([, clear]) => clear);
      if (held.length > 0) {
        try {
          await client.query(`alter role ${role} ${held.join(' ')}`);
        } catch (error) {
          throw new Error(
            `"${login}" holds powers a login must not (${held.join(', ')}), and the owner can't clear them. ` +
              `Clear them as a superuser, or use a new login for ${spec.variable}.`,
            { cause: error },
          );
        }
        console.log(`Cleared ${held.join(', ')} on "${login}".`);
      }
      const after = await powersOf(client, login);
      if (after === undefined || POWERS.some(([column]) => after[column])) {
        throw new Error(`"${login}" still holds a power a login must not. Use a new login for ${spec.variable}.`);
      }
      await client.query(`alter role ${role} with login password ${secret}`);
      console.log(`Updated the password of login role "${login}".`);
    }
    await client.query(`grant ${client.escapeIdentifier(spec.group)} to ${role}`);
    console.log(`"${login}" is a member of ${spec.group}.`);
  } finally {
    await client.end();
  }
}
