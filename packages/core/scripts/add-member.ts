// `pnpm --filter @crm/core member:add -- --workspace acme --email bea@example.com --role member`:
// adds a person to a local workspace with a chosen role (spec 0009, milestone
// 1), so a second browser can see the app as a member or an admin until #23
// brings invites. The person signs in with that email's code; if no account
// has the email yet, one is made with it verified. Someone already in the
// workspace gets the new role instead (the last owner guard still holds).
// Local only: runs as the owner role and refuses any host but localhost.
import { parseArgs } from 'node:util';
import { sql } from 'drizzle-orm';
import * as z from 'zod';
import { Role } from '@crm/contracts';
import { createDatabase, createIdentityStore } from '@crm/db';
import { newId, outboxHook } from '../src/index.ts';
import { runWrite } from '../src/engine/write.ts';
import { systemScope } from '../src/system.ts';
import { refuseRemote } from './local-only.ts';

const env = z.object({ DATABASE_URL_OWNER: z.url(), IDENTITY_DATABASE_URL: z.url() }).parse(process.env);
refuseRemote(env.DATABASE_URL_OWNER, undefined, 'member:add');
refuseRemote(env.IDENTITY_DATABASE_URL, undefined, 'member:add');

const { values } = parseArgs({
  options: {
    workspace: { type: 'string' },
    email: { type: 'string' },
    role: { type: 'string', default: 'member' },
    name: { type: 'string' },
  },
});
const input = z
  .object({
    workspace: z.string().min(1, 'Name the workspace by its address: --workspace acme'),
    email: z.email('Give the person’s email: --email bea@example.com').toLowerCase(),
    role: Role,
    name: z.string().min(1).optional(),
  })
  .parse(values);

const identity = createIdentityStore({ url: env.IDENTITY_DATABASE_URL, applicationName: 'crm-member-add' });
const db = createDatabase({ url: env.DATABASE_URL_OWNER, applicationName: 'crm-member-add' });
try {
  const workspace = await identity.findWorkspace(input.workspace);
  if (workspace === undefined) {
    console.error(`No workspace at ${input.workspace}.`);
    process.exitCode = 1;
  } else {
    const name = input.name ?? input.email.split('@')[0] ?? input.email;
    // Through runWrite with the outbox hook, so open tabs and the relay's audiences hear of the member (spec 0007,
    // AC-82, AC-85): a member added with no `members` row would leave the relay planning without them.
    const written = await runWrite(
      systemScope(db, workspace.id),
      async ({ tx, ...context }) => {
        // The owner role reads schema auth and bypasses row level security, as on Neon. An existing account whose
        // email nobody has proven (an unverified Google sign up from before spec 0005 milestone 4) is never made a
        // member: it may be someone else's, until its owner signs in by code, which proves the email.
        const users = await tx.execute<{ id: string }>(
          sql`insert into auth."user" (email, name, email_verified) values (${input.email}, ${name}, true)
            on conflict (email) do update set email = excluded.email where auth."user".email_verified returning id`,
        );
        const userId = users.rows[0]?.id;
        if (userId === undefined) {
          throw new Error(
            `${input.email} has an account whose email isn't verified. Its owner signs in by code first.`,
          );
        }
        const existing = await tx.execute<{ id: string }>(
          sql`select id from members where workspace_id = ${workspace.id} and user_id = ${userId} and status = 'active'`,
        );
        const memberId = existing.rows[0]?.id;
        if (memberId !== undefined) {
          await tx.execute(
            sql`update members set role = ${input.role}::member_role, updated_at = now(), updated_by_type = 'system'
              where workspace_id = ${workspace.id} and id = ${memberId}`,
          );
          context.record({ members: [memberId] });
          return `Made ${input.email} ${input.role} in ${input.workspace}.`;
        }
        const id = newId();
        await tx.execute(
          sql`insert into members (workspace_id, id, user_id, name, email, role, created_by_type, updated_by_type)
            values (${workspace.id}, ${id}, ${userId}, ${name}, ${input.email}, ${input.role}::member_role, 'system', 'system')`,
        );
        await tx.execute(
          sql`insert into auth.workspace_membership (user_id, workspace_id, member_id) values (${userId}, ${workspace.id}, ${id})
            on conflict (user_id, workspace_id) do update set member_id = excluded.member_id`,
        );
        context.record({ members: [id] });
        return `Added ${input.email} to ${input.workspace} as ${input.role}. They sign in with a code sent to that email.`;
      },
      [outboxHook()],
    );
    console.log(written.result);
  }
} finally {
  await identity.close();
  await db.close();
}
