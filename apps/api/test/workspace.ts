// Test helpers for the workspace procedures: a signed in member with their own
// workspace (made through the real procedures), its People object and
// attributes, and the refusals a call ends in.
import { randomUUID } from 'node:crypto';
import { newId } from '@crm/core';
import { ORPCError } from '@orpc/client';
import { rpcClient, signIn, type signInApp } from './sign-in.ts';

type App = ReturnType<typeof signInApp>['app'];

/** A short random tag, for unique slugs. */
export const tag = (): string => randomUUID().slice(0, 8);

/** A signed in person with their own new workspace, its client, and the People object with its attributes by API name. */
export async function memberWithWorkspace(app: App) {
  const { cookie, email } = await signIn(app);
  const client = rpcClient(app, cookie);
  const { workspace } = await client.workspaces.create({
    id: newId(),
    name: 'Acme',
    slug: `people-${tag()}`,
    memberName: 'Ada',
  });
  const objects = await client.objects.list({ workspace: workspace.slug });
  const people = objects.find((object) => object.standardKey === 'people');
  const companies = objects.find((object) => object.standardKey === 'companies');
  if (people === undefined || companies === undefined) throw new Error('The template has no People or Companies.');
  const attributes = await client.attributes.list({ workspace: workspace.slug, objectId: people.id });
  const attribute = (apiSlug: string): string => {
    const found = attributes.find((each) => each.apiSlug === apiSlug);
    if (found === undefined) throw new Error(`People has no ${apiSlug}.`);
    return found.id;
  };
  return { cookie, email, client, workspace, slug: workspace.slug, people, companies, attributes, attribute };
}

/** The error a call ends in; fails the test if it succeeds. */
export async function failure(call: () => Promise<unknown>): Promise<ORPCError<string, unknown>> {
  try {
    await call();
  } catch (error) {
    if (error instanceof ORPCError) return error;
    throw error;
  }
  throw new Error('The call succeeded.');
}

/** A refusal's code, status and message, for comparing. */
export async function refusal(call: () => Promise<unknown>) {
  const { code, status, message } = await failure(call);
  return { code, status, message };
}

/** The refusals listed in an error's data. */
export function refusalsOf(error: ORPCError<string, unknown>): readonly Record<string, unknown>[] {
  const data: unknown = error.data;
  if (typeof data !== 'object' || data === null || !('refusals' in data) || !Array.isArray(data.refusals)) return [];
  return data.refusals as Record<string, unknown>[];
}

/** What a non member and an unknown address both get. */
export const NOT_A_MEMBER = {
  code: 'NOT_FOUND',
  status: 404,
  message: "That workspace doesn't exist, or you're not a member of it.",
};
