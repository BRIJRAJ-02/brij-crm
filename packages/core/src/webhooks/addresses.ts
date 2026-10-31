// Where a webhook may be sent (spec 0064, AC-6424): the half of the server side request forgery answer that needs no
// network. An endpoint is https on port 443 only, names a host rather than an address, carries no credentials, and
// every address its host resolves to must be public: the refusal list is `isRefusedAddress` (spec 0055), the same one
// every outside read of ours uses (loopback, private, link local and the cloud metadata address, carrier grade NAT,
// multicast, reserved, and their IPv6 forms). The api's sender asks it at add time and again before every send, and
// connects to the address it checked, so a DNS answer that changes between the two never reaches an inside address.
import { isFetchableUrl, isRefusedAddress } from '../booking/addresses.ts';
import { WEBHOOK_URL_MAX } from '@crm/contracts';

/** Why an endpoint's address is refused, for its one line. */
export type WebhookUrlProblem = 'url' | 'https' | 'port' | 'credentials' | 'host' | 'address';

/** The one line each refusal shows (AC-6424), never quoting the address. */
export const WEBHOOK_URL_MESSAGES: Readonly<Record<WebhookUrlProblem, string>> = {
  url: 'Enter a full web address, such as https://example.com/hooks.',
  https: 'Use an https address.',
  port: 'Use the standard https port (443).',
  credentials: 'Leave the user name and password out of the address.',
  host: 'Use a host name, not an IP address.',
  address: 'That address points to a private network. Use a public one.',
};

/**
 * Whether `text` may be an endpoint at all, before anything is resolved: a parseable https address of at most
 * 2,048 characters, port 443, no user name or password, and a host name (never an IP literal, in either family).
 * Answers the problem, or undefined when it may be used.
 */
export function webhookUrlProblem(text: string): WebhookUrlProblem | undefined {
  if (text.length > WEBHOOK_URL_MAX || !URL.canParse(text)) return 'url';
  const url = new URL(text);
  if (url.protocol !== 'https:') return 'https';
  // `URL` drops the default port, so anything left is another one.
  if (url.port !== '') return 'port';
  if (url.username !== '' || url.password !== '') return 'credentials';
  return isFetchableUrl(url) ? undefined : 'host';
}

/**
 * Whether the addresses a host resolved to may be sent to: at least one, and **none** refused. A name that answers a
 * public address and a private one is refused, since which one a connection gets is the attacker's choice.
 */
export function resolvedProblem(addresses: readonly string[]): 'address' | undefined {
  return addresses.length > 0 && !addresses.some((address) => isRefusedAddress(address)) ? undefined : 'address';
}
