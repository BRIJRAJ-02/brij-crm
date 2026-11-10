# Timefix for partners: the integration guide

This guide is everything your developers need to offer Timefix inside your product. Your admins connect a Timefix
workspace once, your server adds and removes your team in it, and your pages show Timefix's own screens in a frame.
Your users never sign up to Timefix.

Today one module is shared: **Link pages** (each person's page at `timefix.com/<handle>`, and Team pages, where an
admin manages everyone's page and QR code). Booking pages, forms and menus come later, through the same API.

- [How it fits together](#how-it-fits-together)
- [1. Your keys](#1-your-keys)
- [2. The Integrate Timefix button and the connect](#2-the-integrate-timefix-button-and-the-connect)
- [3. Storing the connection](#3-storing-the-connection)
- [4. Adding, changing and removing people](#4-adding-changing-and-removing-people)
- [5. Opening a screen: the launch and the frame](#5-opening-a-screen-the-launch-and-the-frame)
- [6. Errors and what to do](#6-errors-and-what-to-do)
- [7. Rate limits](#7-rate-limits)
- [8. Replacing the secret](#8-replacing-the-secret)
- [9. The sandbox](#9-the-sandbox)
- [10. A complete sample hub](#10-a-complete-sample-hub)

## How it fits together

| Step | Who | What |
| --- | --- | --- |
| Register | Timefix, once | You get a **client id** and a **client secret**. You tell us the addresses that receive a connection and the sites that show Timefix in a frame. |
| Connect | Your admin, once per workspace | Integrate Timefix sends them to Timefix, they sign in, pick a workspace and approve. Your server swaps the code for a **connection** and its **access token**. |
| People | Your server | `PUT` and `DELETE` people by **your own id** for them. Timefix makes them silently: no email, no password. |
| Launch | Your server, each time someone opens the tab | You ask for a **one time address** for one person and one screen, and put it in an `<iframe>`. |

Every request your server makes goes to `https://app.timefix.com/api/partner/v1`. Secrets and tokens stay on your
server: nothing in the browser ever holds them.

All examples use Node 20 or later (built in `fetch` and `crypto`). Set these once:

```js
const TIMEFIX = 'https://app.timefix.com';
const CLIENT_ID = process.env.TIMEFIX_CLIENT_ID; // tfp_…
const CLIENT_SECRET = process.env.TIMEFIX_CLIENT_SECRET; // tfs_…, never in the browser
```

## 1. Your keys

Timefix registers your product and gives you:

- **Client id** (`tfp_` and 22 characters). Public: it appears in addresses.
- **Client secret** (`tfs_` and 43 characters). Shown once. Keep it in your secret store. Timefix keeps only a hash,
  so a lost secret can only be replaced (section 8).

Tell us:

- **Redirect addresses**: the exact addresses that receive a connection, like `https://hub.example.com/timefix/callback`.
  Use `https`. A connect must name one of them character for character.
- **Frame origins**: the origins of the pages that show Timefix in a frame, like `https://hub.example.com`. Origin
  only, no path. Timefix's screens refuse to load in a frame on any other site.

## 2. The Integrate Timefix button and the connect

The connect is OAuth 2.0's authorization code flow with PKCE (RFC 7636, `S256` only). A person who owns a Timefix
workspace always approves it: your product can never reach a workspace nobody in it approved.

### 2.1 The button

Integrate Timefix is a button in your product. When pressed, your server makes a fresh **verifier** and **state**,
keeps both for this browser, and sends the browser to Timefix's connect page:

```
GET https://app.timefix.com/oauth/partner/authorize
  ?response_type=code
  &client_id=tfp_…
  &redirect_uri=https%3A%2F%2Fhub.example.com%2Ftimefix%2Fcallback
  &state=<random, kept for this browser>
  &code_challenge=<base64url SHA-256 of the verifier>
  &code_challenge_method=S256
```

```js
import { createHash, randomBytes } from 'node:crypto';

function startConnect(session) {
  const verifier = randomBytes(32).toString('base64url');
  const state = randomBytes(16).toString('base64url');
  session.timefixConnect = { verifier, state, at: Date.now() }; // your own session store
  const url = new URL('/oauth/partner/authorize', TIMEFIX);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: 'https://hub.example.com/timefix/callback',
    state,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
  }).toString();
  return url.href; // send the browser there (a 303)
}
```

On Timefix's page the person signs in (or signs up), picks a workspace they own or makes one, ticks the modules to
share, and approves. A request Timefix can't accept (an unknown client id, an address you didn't register, no state,
no S256) is refused on Timefix's own page and never sent back to you.

### 2.2 The callback

Timefix sends the browser back to your redirect address:

- approved: `…/timefix/callback?code=tfc_…&state=<yours>`
- cancelled: `…/timefix/callback?error=access_denied&state=<yours>`

Check the `state` is the one you kept for this browser before anything else, then swap the code at once: it works
once, within 60 seconds.

### 2.3 Swapping the code

```
POST https://app.timefix.com/api/partner/v1/token
Authorization: Basic base64(client_id:client_secret)
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&code=tfc_…&redirect_uri=https%3A%2F%2Fhub.example.com%2Ftimefix%2Fcallback&code_verifier=<the verifier>
```

```js
async function finishConnect(session, query) {
  const kept = session.timefixConnect;
  delete session.timefixConnect;
  if (!kept || query.state !== kept.state) throw new Error('This answer names no connect this browser started.');
  if (query.error) return undefined; // the person cancelled
  const answer = await fetch(`${TIMEFIX}/api/partner/v1/token`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: query.code,
      redirect_uri: 'https://hub.example.com/timefix/callback',
      code_verifier: kept.verifier,
    }),
  });
  const body = await answer.json();
  if (!answer.ok) throw new Error(`${body.code}: ${body.message}`);
  return body; // store it: section 3
}
```

The answer (`200`, `Cache-Control: no-store`):

```json
{
  "access_token": "tfa_…",
  "token_type": "Bearer",
  "connection_id": "0195f2c4-…",
  "connection": {
    "id": "0195f2c4-…",
    "workspace": { "id": "0195f2b1-…", "name": "Northwind Studio" },
    "modules": ["link_pages"],
    "connectedAt": "2026-11-06T10:15:00.000Z",
    "isTest": false
  }
}
```

The client id and secret may also go in the body as `client_id` and `client_secret`, and the body may be JSON with
the same field names. A code sent a second time is refused, and Timefix ends the connection it made (someone else may
hold it): ask the person to connect again.

## 3. Storing the connection

Keep, per connected organisation in your own database:

| Field | Why |
| --- | --- |
| `connection_id` | Every call names it. |
| `access_token` | Every call sends it. **Encrypt it at rest**; it is shown only this once. |
| `workspace.id`, `workspace.name` | To show which workspace is connected. |

The token doesn't expire. It stops working when the workspace's owner disconnects your app in Timefix (Settings ›
Connected apps): every call then answers `401 UNAUTHENTICATED`. Treat that as "disconnected": show Integrate Timefix
again. Connecting the same workspace again keeps the same `connection_id` and its people, with a new token.

Read the connection back at any time:

```
GET https://app.timefix.com/api/partner/v1/connections/{connection_id}
Authorization: Bearer tfa_…
```

```js
async function timefix(connection, path, init = {}) {
  const answer = await fetch(`${TIMEFIX}/api/partner/v1/connections/${connection.id}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${connection.token}`, 'content-type': 'application/json', ...init.headers },
  });
  if (answer.status === 204) return undefined;
  const body = await answer.json();
  if (!answer.ok) throw Object.assign(new Error(body.message), { code: body.code, status: answer.status, body });
  return body;
}

const connection = { id: stored.connectionId, token: decrypt(stored.accessToken) };
const read = await timefix(connection, ''); // { id, workspace, modules, connectedAt, isTest }
```

## 4. Adding, changing and removing people

People are keyed by **your own id for them** (the external id). The same external id is always the same person in
Timefix; Timefix never matches people by email, so your product can never sign in as someone's own Timefix account.

**Choose a stable, opaque external id**: your user's database id, like `usr_8f2k1`. **Don't use an email address.** The
external id sits in the request's address, which proxies and logs keep, and people change their email. It is 1 to 128
of `A–Z a–z 0–9 . _ ~ : @ + = | -`.

### 4.1 Add or update someone

```
PUT https://app.timefix.com/api/partner/v1/connections/{connection_id}/members/{external_id}
Authorization: Bearer tfa_…
Content-Type: application/json

{ "email": "maya@example.com", "name": "Maya Okafor", "role": "admin" }
```

```js
await timefix(connection, `/members/${encodeURIComponent(user.id)}`, {
  method: 'PUT',
  body: JSON.stringify({ email: user.email, name: user.name, role: user.isAdmin ? 'admin' : 'member' }),
});
```

- `role` is `admin` (Timefix's Admin, who manages the team's link pages) or `member`. You can't make an owner.
- `201` when the person was added (or came back after a removal), `200` when they already were. Safe to send again:
  send it whenever someone joins or their name, email or role changes.
- Timefix sends them no invitation and no email of its own. They get a link page right away.
- Answer:

```json
{
  "externalId": "usr_8f2k1",
  "memberId": "0195f2d0-…",
  "name": "Maya Okafor",
  "email": "maya@example.com",
  "role": "admin",
  "handle": "maya-okafor",
  "addedAt": "2026-11-06T10:16:02.000Z"
}
```

`role` reads `owner` for someone the workspace made an owner in Timefix: you can't change or remove them.

**Their own Timefix login.** An admin of the workspace can set up a Timefix login for a person you added, from Team
pages in Timefix (never from inside your frame: your page there only tells them whom to ask). Timefix emails them a
link; once they open it they sign in to Timefix directly too, to the same page. They stay yours: launch, `PUT` and the list work for them as before, and the
answer carries `"hasTimefixLogin": true`. From then on `email` is their login's: a `PUT` still changes their name and
role, but never their address.

### 4.2 List

```
GET https://app.timefix.com/api/partner/v1/connections/{connection_id}/members
```

Answers `{ "members": [ … ] }`, oldest first, at most 1,000.

### 4.3 Remove

```
DELETE https://app.timefix.com/api/partner/v1/connections/{connection_id}/members/{external_id}
```

```js
await timefix(connection, `/members/${encodeURIComponent(user.id)}`, { method: 'DELETE' });
```

`204`, also when they were already removed (safe to send again). Their sessions end at once, their page stops
answering, and its content is kept in case they come back: a later `PUT` with the same external id brings back the
same person and page. Someone the workspace removed in Timefix itself is refused a `PUT` (`403 FORBIDDEN`) until you
`DELETE` them first, so a routine sync never undoes the workspace's own choice.

Someone who set up their own Timefix login stays in the workspace when you `DELETE` them: you stop managing them,
your frame closes for them, and they keep their login and page as an ordinary member (an account outlives an
integration). They leave your list. A later `PUT` with the same external id takes them back as yours.

## 5. Opening a screen: the launch and the frame

### 5.1 The launch

Each time someone opens your Timefix tab, your server asks for a one time address for them:

```
POST https://app.timefix.com/api/partner/v1/connections/{connection_id}/launch
Authorization: Bearer tfa_…
Content-Type: application/json

{ "externalId": "usr_8f2k1", "screen": "link_pages.mine", "theme": "dark" }
```

```js
async function launch(connection, user, screen = 'link_pages.mine', theme) {
  const body = await timefix(connection, '/launch', {
    method: 'POST',
    body: JSON.stringify({ externalId: user.id, screen, ...(theme ? { theme } : {}) }),
  });
  return body.url; // put it in the frame now: it works once, within 60 seconds
}
```

| Screen | What it opens | Who |
| --- | --- | --- |
| `link_pages.mine` | The person's own link page: share it, its QR code, and its editor. | Anyone you added. |
| `link_pages.team` | Team pages: everyone's page and QR code, and each page's editor. | Only someone with the `admin` role; anyone else is `403 FORBIDDEN`. |

**Pages for people who aren't in your product.** Inside `link_pages.team`, an admin can press **Add a page** to make
a page for someone who never signs up anywhere (a name, an optional email, and their `timefix.com/<handle>`). Timefix
sends them nothing. These page only people are the workspace's, not yours: they never appear in `GET …/members`, and
your `PUT` and `DELETE` can't change or remove them, whatever external id you send. They take a seat like anyone else,
and an email one of them uses is refused for your people (`409`). The admin removes them from the same screen.

`theme` is `light` or `dark`; leave it out to follow the person's system. The answer (`200`, `no-store`):

```json
{ "url": "https://app.timefix.com/embed/tfp_…/start#code=tfl_…", "expiresAt": "2026-11-06T10:20:00.000Z" }
```

Launch on every page view, and never cache or log the `url`: it opens a session for that person. The code sits after
`#`, so browsers never send it to any server.

### 5.2 The frame

```html
<iframe
  id="timefix"
  title="Timefix"
  src="https://app.timefix.com/embed/tfp_…/start#code=tfl_…"
  style="width: 100%; height: 720px; border: 0"
></iframe>
```

- The page holding the frame must be on one of your registered frame origins, or the screen refuses to load.
- Inside, the person uses Timefix's own screens, without Timefix's sidebar. Nothing in the frame links outside the
  shared modules.
- The frame signs in with its own cookie: `Secure`, `SameSite=None`, `HttpOnly` and `Partitioned` (CHIPS), so it works
  only inside your site's frame. The session lasts 12 hours and is never extended. Removing the person or
  disconnecting ends it at once.

### 5.3 What the frame tells your page

The frame sends `postMessage` messages to your page, addressed to your registered origins. Listen for them, and
always check the sender:

| Message | When | What to do |
| --- | --- | --- |
| `{ "type": "timefix:height", "height": 948 }` | Whenever the screen's height changes. | Size the frame. **Never taller than the visible window** (the frame scrolls inside), so Timefix's dialogs and notices stay in view. |
| `{ "type": "timefix:relaunch", "target": "frame", "reason": "expired" \| "ended" }` | The address ran out, was used already, or the 12 hour session ended, and the person pressed Open again. | Launch again and put the new `url` in the same frame. |
| `{ "type": "timefix:relaunch", "target": "tab", "reason": "cookies" }` | The browser refused the frame's cookie (some Safari and privacy settings), and the person pressed Open in a new tab. | Launch again and open the new `url` in a new tab. |

```js
const frame = document.getElementById('timefix');
const TIMEFIX_ORIGIN = 'https://app.timefix.com';

window.addEventListener('message', async (event) => {
  if (event.origin !== TIMEFIX_ORIGIN || event.source !== frame.contentWindow) return;
  const message = event.data;
  if (message?.type === 'timefix:height') {
    frame.style.height = `${Math.max(320, Math.min(message.height, window.innerHeight - frame.getBoundingClientRect().top))}px`;
  }
  if (message?.type === 'timefix:relaunch') {
    // Open the tab now, while the press still counts: browsers block a window opened after an await.
    const tab = message.target === 'tab' ? window.open('', '_blank') : null;
    if (tab) tab.opener = null;
    const answer = await fetch('/timefix/launch', { method: 'POST' }); // your own route: it calls launch() above
    const { url } = await answer.json();
    if (!url) return tab?.close();
    if (tab) tab.location.href = url;
    else frame.src = url;
  }
});
```

## 6. Errors and what to do

Every refusal has the same shape, with `Cache-Control: no-store`:

```json
{ "code": "NOT_FOUND", "message": "This connection has no person with that external id." }
```

Bad input adds `data.issues`, one entry per field: `{ "path": ["email"], "message": "Enter a valid email address." }`.
Act on `code`; `message` is a plain sentence you may log or show your admins, and its words can change.

| Status | Code | When | What to do |
| --- | --- | --- | --- |
| 400 | `INPUT_INVALID` | A body or external id isn't valid (see `data.issues`); a token request with a wrong, expired or used code, a wrong verifier or redirect address; a launch with an unknown screen or theme. | Fix the request. For a code, start the connect again. |
| 401 | `UNAUTHENTICATED` | A wrong client id or secret (`WWW-Authenticate: Basic`); a missing, wrong or disconnected access token (`WWW-Authenticate: Bearer`). | Check your keys. For a token: the workspace disconnected you, so show Integrate Timefix again. |
| 403 | `FORBIDDEN` | Team pages launched for someone who isn't an admin; a screen whose module the connection doesn't have; a `PUT` for someone the workspace removed in Timefix; a `DELETE` of a workspace owner. | Launch `link_pages.mine`, or make them an admin; send `DELETE` then `PUT` to bring someone back; leave owners to the workspace. |
| 404 | `NOT_FOUND` | A connection id that isn't yours; an external id you never added (or removed, for a launch). | Check the ids; `PUT` the person first. |
| 409 | `UNIQUE_CONFLICT` | Someone already in the workspace, or an open invitation, uses that email. | Use another address, or ask the workspace's owner. |
| 409 | `SEAT_LIMIT` | The workspace's plan has no free seat. | Ask the workspace's owner to free or add seats. |
| 413 | `PAYLOAD_TOO_LARGE` | A body over 64 KB. | Send less. |
| 429 | `TOO_MANY_REQUESTS` | A rate limit (section 7). | Wait the `Retry-After` seconds, then retry. |
| 500 | `INTERNAL` | Something failed on our side. | Retry with backoff. `PUT`, `DELETE` and a fresh launch are safe to repeat. |

## 7. Rate limits

| Limit | Applies to |
| --- | --- |
| 600 requests a minute | per calling IP address, every partner API request |
| 120 requests a minute | per connection (people and launches together) |
| 30 token requests a minute | per client id |
| 30 refused keys or tokens per 10 minutes | per calling IP address; past it, that address is refused for a while |

Past a limit, the answer is `429 TOO_MANY_REQUESTS` with `Retry-After` in seconds. Syncing a large team: send people
one after another, not all at once, and honour `Retry-After`.

## 8. Replacing the secret

Ask Timefix to replace your client secret (for example, if it leaked). The new one is shown once; **the old one stops
at once**, so put the new one in your secret store before or right after the change, and redeploy. Existing
connections keep working: their access tokens don't change. A token you think leaked is replaced by connecting that
workspace again.

## 9. The sandbox

A sandbox partner is a second registration for your developers, marked as a test in Timefix. Use it with a Timefix
workspace you made for testing, and try every call above before going live:

- its connections show as **Test** in the workspace's Connected apps, and never count toward billing;
- Timefix can wipe all of its test connections in one go when you're done (each is disconnected, and its frames
  close; the people it added stay in their workspaces);
- it has its own client id, secret, redirect addresses and frame origins, so `http://localhost` addresses are fine for
  it.

## 10. A complete sample hub

One file, no dependencies, Node 20 or later: a hub page with Integrate Timefix, a team list it syncs to Timefix, and
the Timefix tab in a frame. Run it with `TIMEFIX_CLIENT_ID=… TIMEFIX_CLIENT_SECRET=… node hub.mjs`, having registered
`http://localhost:5390/callback` as a redirect address and `http://localhost:5390` as a frame origin (a sandbox
partner). It keeps everything in memory; a real hub keeps the connection in its database, encrypted.

```js
// hub.mjs
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';

const TIMEFIX = process.env.TIMEFIX_URL ?? 'https://app.timefix.com';
const CLIENT_ID = process.env.TIMEFIX_CLIENT_ID;
const CLIENT_SECRET = process.env.TIMEFIX_CLIENT_SECRET;
const PORT = 5390;
const REDIRECT = `http://localhost:${PORT}/callback`;

const pending = new Map(); // state -> verifier (per browser, in a real hub)
let connection; // { id, token, workspace }
const team = [
  { id: 'usr_1', name: 'Maya Okafor', email: 'maya@example.com', role: 'admin' },
  { id: 'usr_2', name: 'Leo Brandt', email: 'leo@example.com', role: 'member' },
];
const esc = (text) => String(text).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

async function timefix(path, init = {}) {
  const answer = await fetch(`${TIMEFIX}/api/partner/v1/connections/${connection.id}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${connection.token}`, 'content-type': 'application/json' },
  });
  if (answer.status === 204) return undefined;
  const body = await answer.json();
  if (answer.status === 401) connection = undefined; // disconnected in Timefix
  if (!answer.ok) throw new Error(`${body.code}: ${body.message}`);
  return body;
}

const launch = (user, screen) => timefix('/launch', { method: 'POST', body: JSON.stringify({ externalId: user.id, screen }) });

function home(note = '') {
  const people = team
    .map(
      (u) => `<li>${esc(u.name)} (${esc(u.role)})
        <a href="/timefix?user=${u.id}">Link page</a>
        ${u.role === 'admin' ? `<a href="/timefix?user=${u.id}&screen=link_pages.team">Team pages</a>` : ''}</li>`,
    )
    .join('');
  return `<!doctype html><meta charset="utf-8"><title>Hub</title><h1>Hub</h1>
    <p>${connection ? `Connected to ${esc(connection.workspace)}` : 'Not connected'}</p>
    <form method="post" action="/connect"><button>Integrate Timefix</button></form>
    ${connection ? `<form method="post" action="/sync"><button>Sync team</button></form><ul>${people}</ul>` : ''}
    <p role="status">${esc(note)}</p>`;
}

function tab(url, user, screen) {
  return `<!doctype html><meta charset="utf-8"><title>Hub · Timefix</title><a href="/">Back</a>
    <iframe id="timefix" title="Timefix" src="${esc(url)}" style="display:block;width:100%;height:720px;border:0"></iframe>
    <script>
      const frame = document.getElementById('timefix');
      window.addEventListener('message', async (event) => {
        if (event.origin !== ${JSON.stringify(new URL(TIMEFIX).origin)} || event.source !== frame.contentWindow) return;
        const m = event.data;
        if (m && m.type === 'timefix:height') {
          frame.style.height = Math.max(320, Math.min(m.height, innerHeight - frame.getBoundingClientRect().top)) + 'px';
        }
        if (m && m.type === 'timefix:relaunch') {
          const win = m.target === 'tab' ? window.open('', '_blank') : null;
          if (win) win.opener = null;
          const r = await fetch('/relaunch?user=${esc(user.id)}&screen=${esc(screen)}', { method: 'POST' });
          const { url } = await r.json();
          if (!url) return win && win.close();
          if (win) win.location.href = url; else frame.src = url;
        }
      });
    </script>`;
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const html = (body, status = 200) => {
    res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(body);
  };
  const json = (body) => {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  try {
    if (req.method === 'POST' && url.pathname === '/connect') {
      const verifier = randomBytes(32).toString('base64url');
      const state = randomBytes(16).toString('base64url');
      pending.set(state, verifier);
      const go = new URL('/oauth/partner/authorize', TIMEFIX);
      go.search = new URLSearchParams({
        response_type: 'code',
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT,
        state,
        code_challenge: createHash('sha256').update(verifier).digest('base64url'),
        code_challenge_method: 'S256',
      });
      res.writeHead(303, { location: go.href }).end();
      return;
    }
    if (url.pathname === '/callback') {
      const verifier = pending.get(url.searchParams.get('state'));
      pending.delete(url.searchParams.get('state'));
      if (!verifier || url.searchParams.has('error')) return html(home('Not connected.'));
      const answer = await fetch(`${TIMEFIX}/api/partner/v1/token`, {
        method: 'POST',
        headers: {
          authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: url.searchParams.get('code'),
          redirect_uri: REDIRECT,
          code_verifier: verifier,
        }),
      });
      const body = await answer.json();
      if (!answer.ok) return html(home(`${body.code}: ${body.message}`));
      connection = { id: body.connection_id, token: body.access_token, workspace: body.connection.workspace.name };
      res.writeHead(303, { location: '/' }).end();
      return;
    }
    if (req.method === 'POST' && url.pathname === '/sync') {
      for (const u of team) {
        await timefix(`/members/${encodeURIComponent(u.id)}`, {
          method: 'PUT',
          body: JSON.stringify({ email: u.email, name: u.name, role: u.role }),
        });
      }
      return html(home('Team synced.'));
    }
    const user = team.find((u) => u.id === url.searchParams.get('user'));
    const screen = url.searchParams.get('screen') === 'link_pages.team' ? 'link_pages.team' : 'link_pages.mine';
    if (url.pathname === '/timefix' && connection && user) return html(tab((await launch(user, screen)).url, user, screen));
    if (req.method === 'POST' && url.pathname === '/relaunch' && connection && user) return json(await launch(user, screen));
    html(home());
  } catch (error) {
    html(home(String(error.message)), 500);
  }
}).listen(PORT, () => console.log(`Hub on http://localhost:${PORT}`));
```

Open `http://localhost:5390`, press Integrate Timefix, approve in Timefix, press Sync team, then open Maya's link page
or Team pages.

## Questions

Ask your Timefix contact. Include the `x-request-id` header from the answer in question: it lets us find that request
without your data.
