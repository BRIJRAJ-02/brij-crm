// A sample partner hub page (spec 0070, slice 2): what an outside product's own server does to connect a Timefix
// workspace, end to end, against a local stack. Test tooling only: never shipped, never deployed.
//
// GET  /          the hub's Timefix tab: Integrate Timefix, or the connection it holds
// POST /connect   makes a PKCE verifier and a state, keeps both here, and sends the browser to Timefix's connect page
// GET  /callback  checks the state, swaps the code for a connection with the client secret and the verifier, then
//                 reads the connection back with its access token
// POST /check     reads the held connection again (after a Disconnect in Timefix, it is refused)
// POST /members   adds or updates a teammate in Timefix (slice 3): `PUT …/members/{externalId}` with their email,
//                 name and role, no invitation sent
// POST /remove    removes a teammate: `DELETE …/members/{externalId}`
// GET  /embed     the hub's Timefix tab for one teammate (slice 4): a launch (`POST …/launch`) for their screen, and
//                 Timefix in an iframe sized by the frame's own height messages; a relaunch asked by the frame
//                 (`POST /launch`, its session ended, or the browser refused its cookie) opens a fresh address in the
//                 frame or in a new tab
// POST /launch    a fresh launch for the frame's page, as JSON `{ url }`
// The page lists the hub's teammates as Timefix has them (`GET …/members`). Open it on 127.0.0.1 rather than
// localhost and the frame is on another site, as a real hub's is (`setup.ts` registers both as frame origins).
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

/** The screens a launch opens, as the hub offers them. */
const SCREENS = ['link_pages.mine', 'link_pages.team'] as const;

/**
 * The hub's Timefix tab around the frame: the frame starts at the launch's address, takes the height Timefix sends
 * (only from Timefix's own origin), and asks the hub's server for a fresh launch when Timefix asks for one.
 */
function embedPage(launch: {
  readonly url: string;
  readonly externalId: string;
  readonly screen: string;
  readonly theme: string;
}): string {
  const timefix = new URL(launch.url).origin;
  const again = JSON.stringify({ externalId: launch.externalId, screen: launch.screen, theme: launch.theme });
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Sample hub · Timefix</title>
    <style>body{margin:0;font:14px system-ui,sans-serif;background:#f4f4f5}header{padding:12px 16px;background:#111827;color:#fff}
    header a{color:#c7d2fe;margin-right:12px}main{padding:16px}iframe{display:block;width:100%;height:720px;border:0;border-radius:8px;background:#fff}</style>
    </head><body><header><strong>Sample hub</strong> · <a href="/">Back to the hub</a></header>
    <main><iframe id="timefix" title="Timefix" src="${escape(launch.url)}"></iframe></main>
    <script>
      const frame = document.getElementById('timefix');
      const TIMEFIX = ${JSON.stringify(timefix)};
      const AGAIN = ${again};
      window.addEventListener('message', async (event) => {
        if (event.origin !== TIMEFIX || event.source !== frame.contentWindow) return;
        const message = event.data;
        if (message && message.type === 'timefix:height' && Number.isFinite(message.height)) {
          // The frame's own height, kept inside the window so its dialogs stay in view.
          frame.style.height = Math.max(320, Math.min(message.height, window.innerHeight - 80)) + 'px';
        }
        if (message && message.type === 'timefix:relaunch') {
          // A new tab opens now, while the press still counts (Safari forgets it across an await), then gets its
          // address once the launch answers.
          const tab = message.target === 'tab' ? window.open('', '_blank') : null;
          if (tab) tab.opener = null;
          const answer = await fetch('/launch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(AGAIN) });
          const { url } = await answer.json();
          if (typeof url !== 'string') {
            if (tab) tab.close();
            return;
          }
          if (tab) tab.location.href = url;
          else frame.src = url;
        }
      });
    </script></body></html>`;
}

/** A teammate as the hub lists them, from Timefix's answer. */
interface Teammate {
  readonly externalId: string;
  readonly name: string;
  readonly email: string;
  readonly role: string;
}

/** The hub's team: the list, and the forms that add and remove someone. */
function team(teammates: readonly Teammate[]): string {
  const rows = teammates
    .map(
      (each) => `<li data-external-id="${escape(each.externalId)}">${escape(each.name)} · ${escape(each.email)} ·
        ${escape(each.role)}
        <a href="/embed?externalId=${encodeURIComponent(each.externalId)}&amp;screen=link_pages.mine">Open ${escape(each.name)}’s link page</a>
        ${each.role === 'member' ? '' : `<a href="/embed?externalId=${encodeURIComponent(each.externalId)}&amp;screen=link_pages.team">Team pages as ${escape(each.name)}</a>`}
        <form method="post" action="/remove"><input type="hidden" name="externalId" value="${escape(each.externalId)}">
        <button type="submit">Remove ${escape(each.name)}</button></form></li>`,
    )
    .join('');
  return `<h2>Team</h2><ul id="team">${rows}</ul>
    <form method="post" action="/members">
      <label>External id <input name="externalId" required></label>
      <label>Email <input name="email" type="email" required></label>
      <label>Name <input name="name" required></label>
      <label>Role <select name="role"><option value="member">Member</option><option value="admin">Admin</option></select></label>
      <button type="submit">Add teammate</button>
    </form>`;
}

/** The hub's one page, plain HTML: what it holds, a status line, and its buttons. */
function page(held: Held | undefined, status: string, teammates: readonly Teammate[] = []): string {
  const body =
    held === undefined
      ? `<p id="state">Not connected</p>
         <form method="post" action="/connect"><button type="submit">Integrate Timefix</button></form>`
      : `<p id="state">Connected to ${escape(held.workspace)}</p>
         <p id="modules">Modules: ${escape(held.modules.join(', '))}</p>
         <p id="connection">Connection: ${escape(held.connectionId)}</p>
         <form method="post" action="/check"><button type="submit">Check connection</button></form>
         <form method="post" action="/connect"><button type="submit">Integrate Timefix</button></form>
         ${team(teammates)}`;
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

/** A posted form's fields (at most 16 KB). */
async function formOf(request: IncomingMessage): Promise<URLSearchParams> {
  let text = '';
  for await (const chunk of request) {
    text += String(chunk);
    if (text.length > 16_384) break;
  }
  return new URLSearchParams(text);
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

  /** The held connection's members address, with its token. */
  const members = (connection: Held, externalId?: string) => ({
    url: `${settings.timefix}/api/partner/v1/connections/${connection.connectionId}/members${
      externalId === undefined ? '' : `/${encodeURIComponent(externalId)}`
    }`,
    headers: { authorization: `Bearer ${connection.token}` },
  });

  /** A launch (slice 4): a one time address for one teammate's screen, or why it was refused. */
  const launch = async (
    connection: Held,
    asked: { readonly externalId: string; readonly screen: string; readonly theme: string },
  ): Promise<{ readonly url: string } | { readonly refused: string }> => {
    const launched = await call(`${settings.timefix}/api/partner/v1/connections/${connection.connectionId}/launch`, {
      method: 'POST',
      headers: { authorization: `Bearer ${connection.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        externalId: asked.externalId,
        screen: asked.screen,
        ...(asked.theme === 'light' || asked.theme === 'dark' ? { theme: asked.theme } : {}),
      }),
    });
    const url = launched.body['url'];
    return launched.status === 200 && typeof url === 'string'
      ? { url }
      : { refused: `${String(launched.body['code'])} ${String(launched.body['message'])}` };
  };

  /** The team as Timefix has it now; none when not connected or refused. */
  const teammates = async (): Promise<readonly Teammate[]> => {
    if (held === undefined) return [];
    const target = members(held);
    const listed = await call(target.url, { headers: target.headers });
    const list = listed.body['members'];
    if (listed.status !== 200 || !Array.isArray(list)) return [];
    return list.map((each: Record<string, unknown>) => ({
      externalId: String(each['externalId']),
      name: String(each['name']),
      email: String(each['email']),
      role: String(each['role']),
    }));
  };

  const handle = async (request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url ?? '/', redirectUri);
    if (request.method === 'GET' && url.pathname === '/') {
      send(response, 200, page(held, status, await teammates()));
      return;
    }
    if (request.method === 'GET' && url.pathname === '/embed') {
      const asked = {
        externalId: url.searchParams.get('externalId') ?? '',
        screen: SCREENS.find((each) => each === url.searchParams.get('screen')) ?? 'link_pages.mine',
        theme: url.searchParams.get('theme') ?? '',
      };
      if (held === undefined) {
        send(response, 409, page(held, 'Connect first.'));
        return;
      }
      const launched = await launch(held, asked);
      if ('refused' in launched) {
        status = `Launch refused: ${launched.refused}`;
        goTo(response, '/');
        return;
      }
      send(response, 200, embedPage({ ...asked, url: launched.url }));
      return;
    }
    if (request.method === 'POST' && url.pathname === '/launch') {
      let text = '';
      for await (const chunk of request) text += String(chunk);
      const parsed: unknown = JSON.parse(text || '{}');
      const body = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
      const field = (name: string, fallback: string) => {
        const value = body[name];
        return typeof value === 'string' ? value : fallback;
      };
      const launched =
        held === undefined
          ? { refused: 'not connected' }
          : await launch(held, {
              externalId: field('externalId', ''),
              screen: field('screen', 'link_pages.mine'),
              theme: field('theme', ''),
            });
      response.writeHead('refused' in launched ? 409 : 200, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      });
      response.end(JSON.stringify(launched));
      return;
    }
    if (request.method === 'POST' && url.pathname === '/members') {
      const form = await formOf(request);
      if (held !== undefined) {
        const target = members(held, form.get('externalId') ?? '');
        const put = await call(target.url, {
          method: 'PUT',
          headers: { ...target.headers, 'content-type': 'application/json' },
          body: JSON.stringify({ email: form.get('email'), name: form.get('name'), role: form.get('role') }),
        });
        status =
          put.status === 201
            ? 'Teammate added.'
            : put.status === 200
              ? 'Teammate updated.'
              : `Teammate refused: ${String(put.body['code'])} ${String(put.body['message'])}`;
      }
      goTo(response, '/');
      return;
    }
    if (request.method === 'POST' && url.pathname === '/remove') {
      const form = await formOf(request);
      if (held !== undefined) {
        const target = members(held, form.get('externalId') ?? '');
        const removed = await fetch(target.url, { method: 'DELETE', headers: target.headers });
        status = removed.status === 204 ? 'Teammate removed.' : `Remove refused: ${String(removed.status)}`;
      }
      goTo(response, '/');
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
  // Every local address, so the hub answers on localhost (the connect's registered callback) and on 127.0.0.1 (another
  // site from the app's localhost, for the frame).
  server.listen(settings.port);
  return server;
}

if (import.meta.main) {
  const settings = settingsOf(process.env);
  startSample(settings);
  process.stdout.write(`Sample hub on http://localhost:${String(settings.port)}\n`);
}
