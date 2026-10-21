// Where a workspace opens (Settings › Account › Preferences): the member's
// landing page, else Home. Pure, so the `/w/$slug/` loader and its tests share
// it. A landing object that was archived, or that the member can no longer see
// (absent from their object list), falls back to Home.
import type { LandingPage, ObjectSummary } from '@crm/data';
import { navObjects } from './objects.ts';

/** Where the opening redirect goes: Home, Tasks, or an object's records. */
export type LandingTarget =
  { readonly kind: 'home' } | { readonly kind: 'tasks' } | { readonly kind: 'object'; readonly apiSlug: string };

/** The page a workspace opens on: Home unless the member chose Tasks or an object they can still see. */
export function landingTarget(landing: LandingPage | undefined, objects: readonly ObjectSummary[]): LandingTarget {
  if (landing?.kind === 'tasks') return { kind: 'tasks' };
  if (landing?.kind === 'object') {
    const chosen = navObjects(objects).find((object) => object.id === landing.objectId);
    if (chosen !== undefined) return { kind: 'object', apiSlug: chosen.apiSlug };
  }
  return { kind: 'home' };
}
