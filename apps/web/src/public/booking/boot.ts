// What a handle address's shell already read (handle-shell.ts, 29 Oct 2026), so the page starts from it rather than
// asking the api first: a profile draws at once, and a booking page starts from its key instead of looking its
// address up, a whole round trip before anything else could begin. The block is read once, checked for shape (the
// public bundle carries no Zod), and anything missing or malformed reads as no block at all, which is the page as
// it always loaded.
import type { PublicProfile } from '@crm/data/booking';

/** The shell's boot block's id, as `handle-shell.ts` writes it (`BOOT_ID`). */
export const BOOT_ID = 'crm-boot';

/** What the shell handed over: a profile, or a booking page's key and its current address. */
export type Boot =
  | { readonly kind: 'profile'; readonly profile: PublicProfile }
  | { readonly kind: 'page'; readonly publicKey: string; readonly handle: string; readonly slug: string };

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null;

const isText = (value: unknown): value is string => typeof value === 'string' && value !== '';

/** The block's JSON as a `Boot`, or undefined for anything else. */
export function bootOf(json: string | null | undefined): Boot | undefined {
  if (json === null || json === undefined) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  if (value.kind === 'page') {
    return isText(value.publicKey) && isText(value.handle) && isText(value.slug)
      ? { kind: 'page', publicKey: value.publicKey, handle: value.handle, slug: value.slug }
      : undefined;
  }
  if (value.kind === 'profile' && isRecord(value.profile)) {
    const profile = value.profile;
    // The fields the page draws before its own read lands; the rest arrive with that read.
    if (!isText(profile.handle) || typeof profile.name !== 'string' || !Array.isArray(profile.items)) return undefined;
    if (typeof profile.initials !== 'string' || typeof profile.bio !== 'string' || !isRecord(profile.theme)) {
      return undefined;
    }
    // Checked as far as the page relies on it; the api wrote it, through the same edge the page's own read uses.
    return { kind: 'profile', profile: profile as PublicProfile };
  }
  return undefined;
}

/** This document's boot block, when its shell wrote one. */
export function readBoot(document: Pick<Document, 'getElementById'>): Boot | undefined {
  return bootOf(document.getElementById(BOOT_ID)?.textContent);
}
