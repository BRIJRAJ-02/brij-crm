// A sample partner hub page (spec 0070, slice 2): what an outside product's own server does to connect a Timefix
// workspace, end to end, against a local stack. Test tooling only: never shipped, never deployed.
//
// GET  /          the hub's Timefix tab: Integrate Timefix, or the connection it holds
// POST /connect   makes a PKCE verifier and a state, keeps both here, and sends the browser to Timefix's connect page
// GET  /callback  checks the state, swaps the code for a connection with the client secret and the verifier, then
//                 reads the connection back with its access token
// POST /check     reads the held connection again (after a Disconnect in Timefix, it is refused)
//
// Settings come from the environment: TIMEFIX_URL (the app, http://localhost:5290), PARTNER_CLIENT_ID,
// PARTNER_CLIENT_SECRET, and PORT (5390). The redirect address it sends is http://localhost:<PORT>/callback, which
// the partner must have registered exactly.
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

/** The sample's settings, read once at start. */
interface Settings {
  readonly timefix: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly port: number;
}

/** A connect on its way: the verifier for its state. */
interface Pending {
  readonly verifier: string;
  readonly at: number;
}

/** What the hub keeps once connected: the connection and its token (a real hub keeps it in its own database). */
interface Held {
  readonly connectionId: string;
  readonly token: string;
  readonly workspace: string;
  readonly modules: readonly string[];
}

/** One answer from a Timefix call: its status and its JSON body. */
interface Answer {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

function settingsOf(env: NodeJS.ProcessEnv): Settings {
  const clientId = env['PARTNER_CLIENT_ID'] ?? '';
  const clientSecret = env['PARTNER_CLIENT_SECRET'] ?? '';
  if (clientId === '' || clientSecret === '') throw new Error('Set PARTNER_CLIENT_ID and PARTNER_CLIENT_SECRET.');
  return {
    timefix: (env['TIMEFIX_URL'] ?? 'http://localhost:5290').replace(/\/$/, ''),
    clientId,
    clientSecret,
    port: Number(env['PORT'] ?? '5390'),
  };
}

const escape = (text: string) => text.replace(/[&<>"']/g, (character) => `&#${String(character.charCodeAt(0))};`);

/** The hub's one page, plain HTML: what it holds, a status line, and its buttons. */
function page(held: Held | undefined, status: string): string {
  const body =
    held === undefined
      ? `<p id="state">Not connected</p>
         <form method="post" action="/connect"><button type="submit">Integrate Timefix</button></form>`
      : `<p id="state">Connected to ${escape(held.workspace)}</p>
         <p id="modules">Modules: ${escape(held.modules.join(', '))}</p>
         <p id="connection">Connection: ${escape(held.connectionId)}</p>
         <form method="post" action="/check"><button type="submit">Check connection</button></form>
         <form method="post" action="/connect"><button type="submit">Integrate Timefix</button></form>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Sample hub</title></head>
    <body><main><h1>Sample hub · Timefix</h1>${body}<p id="status" role="status">${escape(status)}</p></main></body></html>`;
}

function send(response: ServerResponse, status: number, html: string): void {
  response.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  response.end(html);
}

function goTo(response: ServerResponse, location: string): void {
  response.writeHead(303, { location, 'cache-control': 'no-store' });
  response.end();
}

async function call(url: string, init: RequestInit): Promise<Answer> {
  const answered = await fetch(url, init);
  const body: unknown = await answered.json().catch(() => ({}));
  return {
    status: answered.status,
    body: typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {},
  };
}

/** Starts the sample on its port and answers the server, for a test to close. */
export function startSample(settings: Settings): ReturnType<typeof createServer> {
  const redirectUri = `http://localhost:${String(settings.port)}/callback`;
  const pending = new Map<string, Pending>();
  let held: Held | undefined;
  let status = '';

  const handle = async (request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url ?? '/', redirectUri);
    if (request.method === 'GET' && url.pathname === '/') {
      send(response, 200, page(held, status));
      return;
    }
    if (request.method === 'POST' && url.pathname === '/connect') {
      // RFC 7636: a fresh verifier per connect, its S256 challenge sent; the state ties the answer to this browser.
      const verifier = randomBytes(32).toString('base64url');
      const state = randomBytes(16).toString('base64url');
      pending.set(state, { verifier, at: Date.now() });
      const authorize = new URL('/oauth/partner/authorize', settings.timefix);
      authorize.search = new URLSearchParams({
        response_type: 'code',
        client_id: settings.clientId,
        redirect_uri: redirectUri,
        state,
        code_challenge: createHash('sha256').update(verifier).digest('base64url'),
        code_challenge_method: 'S256',
      }).toString();
      goTo(response, authorize.toString());
      return;
    }
    if (request.method === 'GET' && url.pathname === '/callback') {
      const state = url.searchParams.get('state') ?? '';
      const waiting = pending.get(state);
      pending.delete(state);
      if (waiting === undefined || Date.now() - waiting.at > 10 * 60_000) {
        status = 'Refused: that answer names no connect this hub started.';
      } else if (url.searchParams.get('error') !== null) {
        status = `Not connected: ${url.searchParams.get('error') ?? ''}`;
      } else {
        const swapped = await call(`${settings.timefix}/api/partner/v1/token`, {
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            authorization: `Basic ${Buffer.from(`${settings.clientId}:${settings.clientSecret}`).toString('base64')}`,
          },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code: url.searchParams.get('code') ?? '',
            redirect_uri: redirectUri,
            code_verifier: waiting.verifier,
          }).toString(),
        });
        const token = swapped.body['access_token'];
        const connectionId = swapped.body['connection_id'];
        if (swapped.status !== 200 || typeof token !== 'string' || typeof connectionId !== 'string') {
          status = `Token refused: ${String(swapped.body['code'])} ${String(swapped.body['message'])}`;
        } else {
          const read = await call(`${settings.timefix}/api/partner/v1/connections/${connectionId}`, {
            headers: { authorization: `Bearer ${token}` },
          });
          const workspace = read.body['workspace'] as { name?: unknown } | undefined;
          const modules = read.body['modules'];
          held = {
            connectionId,
            token,
            workspace: typeof workspace?.name === 'string' ? workspace.name : '?',
            modules: Array.isArray(modules) ? modules.map(String) : [],
          };
          status = 'Connected.';
        }
      }
      goTo(response, '/');
      return;
    }
    if (request.method === 'POST' && url.pathname === '/check') {
      if (held !== undefined) {
        const read = await call(`${settings.timefix}/api/partner/v1/connections/${held.connectionId}`, {
          headers: { authorization: `Bearer ${held.token}` },
        });
        status =
          read.status === 200
            ? 'Connection works.'
            : `Connection refused: ${String(read.status)} ${String(read.body['code'])}`;
      }
      goTo(response, '/');
      return;
    }
    send(response, 404, page(held, 'Nothing here.'));
  };

  const server = createServer((request, response) => {
    handle(request, response).catch((error: unknown) => {
      send(response, 500, page(held, `Failed: ${String(error)}`));
    });
  });
  server.listen(settings.port, 'localhost');
  return server;
}

if (import.meta.main) {
  const settings = settingsOf(process.env);
  startSample(settings);
  process.stdout.write(`Sample hub on http://localhost:${String(settings.port)}\n`);
}
