// Where a workspace opens (Settings › Account › Preferences): the member's
// landing page, else Home. Pure, so the `/w/$slug/` loader and its tests share
// it. A landing object that was archived, or that the member can no longer see
// (absent from their object list), falls back to Home.
import type { LandingPage, ObjectSummary } from '@crm/data';
import { navObjects } from './objects.ts';

/** Where the opening redirect goes: Home, Tasks, an object's records, or nowhere (a guest with nothing shared). */
export type LandingTarget =
  | { readonly kind: 'home' }
  | { readonly kind: 'tasks' }
  | { readonly kind: 'object'; readonly apiSlug: string }
  | { readonly kind: 'nothing' };

/**
 * The page a workspace opens on: Home unless the member chose Tasks or an object they can still see. A guest (spec
 * 0031, slice 9) has no Home of meetings and a link page: they open on what is shared with them, the object they
 * chose or else the first, and with nothing shared, on nothing (the page says so).
 */
export function landingTarget(
  landing: LandingPage | undefined,
  objects: readonly ObjectSummary[],
  isGuest = false,
): LandingTarget {
  if (landing?.kind === 'tasks') return { kind: 'tasks' };
  const shown = navObjects(objects);
  if (landing?.kind === 'object') {
    const chosen = shown.find((object) => object.id === landing.objectId);
    if (chosen !== undefined) return { kind: 'object', apiSlug: chosen.apiSlug };
  }
  if (isGuest) {
    const first = shown[0];
    return first === undefined ? { kind: 'nothing' } : { kind: 'object', apiSlug: first.apiSlug };
  }
  return { kind: 'home' };
}
