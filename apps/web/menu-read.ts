// The headers the guest menu's server render (`api/menu.mjs`) reads the menu with (security review, should-fix 4).
// The render reads `/api/public/menu/<key>` from the function's own address, which every guest's render would share
// in the API's per address limit. So it vouches for the guest: the edge secret in `RENDER_HEADER` and the guest's own
// address in `GUEST_IP_HEADER`. The middleware overwrites `x-crm-edge` and `x-forwarded-for` with its own, so these
// two are the render's. The API believes the address only when the secret checks (`EdgeGuard.rendered`). Pure, run in
// a Node test.

/** Equal to `RENDER_HEADER` in apps/api/src/edge.ts. */
export const RENDER_HEADER = 'x-crm-render';

/** Equal to `GUEST_IP_HEADER` in apps/api/src/edge.ts. */
export const GUEST_IP_HEADER = 'x-crm-guest-ip';

/** What an edge secret must look like (middleware.ts's rule): 32 or more printable ASCII characters, no spaces. */
const EDGE_SECRET_FORMAT = /^[\x21-\x7e]{32,}$/;

/** An IPv4 or IPv6 address as the edge reports one: hex digits, dots and colons only, never a list. */
const ADDRESS = /^[0-9a-fA-F.:]{2,45}$/;

/**
 * The render's read headers: JSON, and, while the deployment has a well formed edge secret, the secret and the
 * guest's address (when the edge gave one). Without a secret it vouches for nobody, so the read counts as the
 * function's own, as before.
 */
export function menuReadHeaders(input: {
  readonly secret: string | undefined;
  readonly guestIp: string | undefined;
}): Record<string, string> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (input.secret === undefined || !EDGE_SECRET_FORMAT.test(input.secret)) return headers;
  headers[RENDER_HEADER] = input.secret;
  const guestIp = input.guestIp?.trim();
  if (guestIp !== undefined && ADDRESS.test(guestIp)) headers[GUEST_IP_HEADER] = guestIp;
  return headers;
}
