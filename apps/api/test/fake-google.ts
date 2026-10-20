// A fake Google for the browser flows (F34): loaded into a local api with
// `node --import ./test/fake-google.ts`, it answers Google's token endpoint
// so a Google sign in runs end to end without the owner's OAuth client, the
// same way src/auth/google.test.ts fakes it in process. The flow plays
// Google's page in the browser and hands the callback a `code` that is the
// person, as base64url JSON ({ sub, email, name }); this answers the code
// exchange with an id token carrying those claims, verified. Every other
// request goes to the real fetch. It refuses to load outside APP_ENV=local,
// and nothing but a flow's api start ever imports it. It answers only the
// sign in client's exchange (GOOGLE_CLIENT_ID), at the token endpoint exactly.
import { Buffer } from 'node:buffer';
import * as z from 'zod';

/** Google's token endpoint, where Better Auth exchanges the callback's code. */
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

/** The person a flow's code names. */
const FakeGooglePerson = z.object({ sub: z.string().min(1), email: z.email(), name: z.string().min(1) });
type FakeGooglePerson = z.infer<typeof FakeGooglePerson>;

if (process.env.APP_ENV !== 'local' || process.env.NODE_ENV === 'production') {
  throw new Error('The fake Google is for local flows only (APP_ENV=local).');
}

/** A JWT shaped like Google's id token; unsigned, as Better Auth only decodes one from the token endpoint. */
function idToken(person: FakeGooglePerson, audience: string): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  return [
    part({ alg: 'RS256', typ: 'JWT', kid: 'fake' }),
    part({
      iss: 'https://accounts.google.com',
      aud: audience,
      sub: person.sub,
      email: person.email,
      email_verified: true,
      name: person.name,
      iat: now,
      exp: now + 3600,
    }),
    'signature',
  ].join('.');
}

/** A request body as text: the form Better Auth sends, as a string or as URLSearchParams. */
function bodyText(body: RequestInit['body']): string {
  if (typeof body === 'string') return body;
  if (body instanceof URLSearchParams) return body.toString();
  return '';
}

const realFetch = globalThis.fetch;

globalThis.fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const url = input instanceof Request ? input.url : String(input);
  const { origin, pathname } = new URL(url);
  if (`${origin}${pathname}` !== TOKEN_ENDPOINT) return realFetch(input, init);
  const form = new URLSearchParams(input instanceof Request ? await input.clone().text() : bodyText(init?.body));
  // Only sign in's client: anything else (calendar connect's code exchange) is refused, never handed a person.
  if (form.get('client_id') !== process.env.GOOGLE_CLIENT_ID) {
    return Response.json({ error: 'invalid_client' }, { status: 401 });
  }
  const person = FakeGooglePerson.safeParse(
    JSON.parse(Buffer.from(form.get('code') ?? '', 'base64url').toString('utf8') || 'null'),
  );
  if (!person.success) return Response.json({ error: 'invalid_grant' }, { status: 400 });
  return Response.json({
    access_token: `fake-access-${person.data.sub}`,
    id_token: idToken(person.data, form.get('client_id') ?? ''),
    expires_in: 3599,
    token_type: 'Bearer',
    scope: 'openid email profile',
  });
};
