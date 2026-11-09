// The connect page's address (spec 0070, AC-7011): OAuth's own parameters, read as plain text. The server checks every
// one before anything happens; this only keeps what is a string, so nothing else rides in the page's state.
import type { PartnerConnectRequest } from '@crm/data';

/** Where a partner's Integrate Timefix button sends the browser. */
export const CONNECT_PATH = '/oauth/partner/authorize';

/** The page's search: each OAuth parameter, when it is a string. */
export interface ConnectSearch {
  readonly client_id?: string;
  readonly redirect_uri?: string;
  readonly state?: string;
  readonly code_challenge?: string;
  readonly code_challenge_method?: string;
  readonly response_type?: string;
}

const KEYS = [
  'client_id',
  'redirect_uri',
  'state',
  'code_challenge',
  'code_challenge_method',
  'response_type',
] as const;

/** The route's search, keeping only the OAuth parameters that are strings of a sane length. */
export function connectSearch(search: Record<string, unknown>): ConnectSearch {
  const kept: Record<string, string> = {};
  for (const key of KEYS) {
    const value = search[key];
    // The router parses a value that looks like JSON (a number, `true`); OAuth's are always text.
    const text = typeof value === 'string' ? value : typeof value === 'number' ? String(value) : undefined;
    if (text !== undefined && text.length <= 600) kept[key] = text;
  }
  return kept;
}

/** The request as the server reads it. */
export function connectRequest(search: ConnectSearch): PartnerConnectRequest {
  return {
    clientId: search.client_id ?? '',
    redirectUri: search.redirect_uri ?? '',
    state: search.state ?? '',
    codeChallenge: search.code_challenge ?? '',
    codeChallengeMethod: search.code_challenge_method ?? '',
    responseType: search.response_type ?? '',
  };
}

/** This page's own address again, for sign in to come back to. */
export function connectHref(search: ConnectSearch): string {
  const params = new URLSearchParams();
  for (const key of KEYS) {
    const value = search[key];
    if (value !== undefined) params.set(key, value);
  }
  return `${CONNECT_PATH}?${params.toString()}`;
}

/** A new workspace's address from its name: its words, then four random characters, so it is free at once. */
export function newWorkspaceSlug(name: string, random: () => number = Math.random): string {
  const words = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)
    .replace(/-+$/g, '');
  const tail = Array.from({ length: 4 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(random() * 36)]).join(
    '',
  );
  return `${words.length >= 3 ? words : 'workspace'}-${tail}`;
}

/** A list with `item` in it (last) or out of it, each item once. */
export function toggled<T extends string>(list: readonly T[], item: T, isOn: boolean): readonly T[] {
  const without = list.filter((each) => each !== item);
  return isOn ? [...without, item] : without;
}
