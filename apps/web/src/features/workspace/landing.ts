// Where a workspace opens (Settings › Account › Preferences): the member's
// landing page, else the first live object. Pure, so the `/w/$slug/` loader
// and its tests share it. A landing object that was archived, or that the
// member can no longer see (absent from their object list), falls back.
import type { LandingPage, ObjectSummary } from '@crm/data';
import { navObjects } from './objects.ts';

/** Where the opening redirect goes: an object's records, Tasks, or Settings › Objects when nothing is live. */
export type LandingTarget =
  { readonly kind: 'object'; readonly apiSlug: string } | { readonly kind: 'tasks' } | { readonly kind: 'settings' };

/**
 * The page a workspace opens on. Home is the first live object by the
 * workspace's order until the Home page lands (the home lane), as before.
 */
export function landingTarget(landing: LandingPage | undefined, objects: readonly ObjectSummary[]): LandingTarget {
  const live = navObjects(objects);
  if (landing?.kind === 'tasks') return { kind: 'tasks' };
  if (landing?.kind === 'object') {
    const chosen = live.find((object) => object.id === landing.objectId);
    if (chosen !== undefined) return { kind: 'object', apiSlug: chosen.apiSlug };
  }
  const [first] = live;
  return first === undefined ? { kind: 'settings' } : { kind: 'object', apiSlug: first.apiSlug };
}
