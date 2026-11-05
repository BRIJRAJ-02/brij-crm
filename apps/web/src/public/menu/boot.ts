// The guest menu page's small pure helpers (spec 0065, H1): the shell's boot block, the table's code in the address, and
// Your picks kept in this browser only (AC-6530), each tolerant of storage that is blocked or holds something else.
import { isTableCode } from '@crm/contracts/menu';
import type { PublicMenu } from '@crm/data/menu-guest';
import type { GuestPick } from '@crm/ui/public-menu';

/** How old a shell's read may be and still draw first: the edge keeps a shell a minute, then serves it stale. */
export const BOOT_FRESH_MS = 5 * 60_000;

/** The menu the shell read, when it is this key's and recent; never trusted beyond its shape. */
export function readMenuBoot(document: Document, key: string, now: number): PublicMenu | undefined {
  const text = document.getElementById('crm-menu-boot')?.textContent ?? '';
  if (text === '') return undefined;
  try {
    const boot = JSON.parse(text) as { key?: unknown; menu?: unknown; readAt?: unknown };
    if (boot.key !== key || typeof boot.readAt !== 'number' || now - boot.readAt > BOOT_FRESH_MS) return undefined;
    const menu: unknown = boot.menu;
    return typeof menu === 'object' && menu !== null && 'menu' in menu && typeof menu.menu === 'object'
      ? (menu as PublicMenu)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The code a table's QR carries in the address (`?t=<code>`, spec 0065 H2), or undefined: only something shaped like
 * a code is ever sent to be looked up. The table's name comes from the server, never from the address.
 */
export function tableCodeOf(search: string): string | undefined {
  const code = new URLSearchParams(search).get('t')?.trim();
  return code !== undefined && isTableCode(code) ? code : undefined;
}

/** The storage the picks live in, or undefined where the browser blocks it. */
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** At most this many picks are kept. */
const MAX_PICKS = 60;

/** Whether a stored value is one pick. */
function isPick(value: unknown): value is GuestPick {
  if (typeof value !== 'object' || value === null) return false;
  const pick = value as Record<string, unknown>;
  return (
    typeof pick.key === 'string' &&
    typeof pick.itemId === 'string' &&
    (pick.sizeId === undefined || typeof pick.sizeId === 'string') &&
    Array.isArray(pick.optionIds) &&
    pick.optionIds.every((id) => typeof id === 'string') &&
    typeof pick.quantity === 'number' &&
    Number.isInteger(pick.quantity) &&
    pick.quantity >= 1 &&
    pick.quantity <= 99
  );
}

/** Your picks for one menu, kept in this browser only: nothing is ever sent. */
export function picksStore(key: string, storage: () => Storage | undefined) {
  const name = `crm.menu.picks.${key}`;
  return {
    read(): readonly GuestPick[] {
      try {
        const parsed: unknown = JSON.parse(storage()?.getItem(name) ?? '[]');
        return Array.isArray(parsed) ? parsed.filter(isPick).slice(0, MAX_PICKS) : [];
      } catch {
        return [];
      }
    },
    write(picks: readonly GuestPick[]): void {
      try {
        if (picks.length === 0) storage()?.removeItem(name);
        else storage()?.setItem(name, JSON.stringify(picks.slice(0, MAX_PICKS)));
      } catch {
        // Blocked or full: the picks last while the page is open.
      }
    },
  };
}
