// What the public pages read of a brand (spec 0060, AC-4, AC-14, AC-22): the accent pair a booking page, a hosted
// form or a link page wears, the version its stylesheet is served at, the stylesheet itself, and the logo and
// photos. Each reader takes what a door made (a booking page's entry, a form's entry, a handle's owner), so it reads
// only that page's workspace, under that workspace's own row level security. Nothing here reads a member's email or
// anything typed but a checked hex; every path is one the server made.
//
// The stylesheet holds custom properties only: the accent colours `brandVariables()` computes (`BRAND_PROPERTIES`)
// and, for a link page, a `url()` to our own image routes. Each value is checked again here on the way out, so even a
// row that somehow held something else could never write anything but a hex or our own path into CSS.
import { createHash } from 'node:crypto';
import {
  BRAND_HEX_PATTERN,
  brandProperties,
  brandVariables,
  lookImagePath,
  type PageImageSlot,
  type PublicBrand,
  type PublicLook,
} from '@crm/contracts';
import type { Database, WorkspaceTx } from '@crm/db';
import { schema } from '@crm/db';
import { and, eq, isNull } from 'drizzle-orm';
import type { BookingEntry, HandleOwner } from '../access/door.ts';
import { inWorkspace } from '../access/run.ts';
import type { EngineScope } from '../engine/scope.ts';
import { brandRowOf, type BrandRow } from './brand.ts';
import { lookRowOf, type LookRow } from './look.ts';

const { bookingPages } = schema;

/** The accent pair a page wears, both checked, or none for the product's own. */
interface Accents {
  readonly accent?: string;
  readonly accentDark?: string;
}

/** A hex that passes the pattern, else nothing: the last check before CSS. */
const hex = (value: string | null | undefined): string | undefined =>
  typeof value === 'string' && BRAND_HEX_PATTERN.test(value) ? value : undefined;

/** The person's own pair when they set one, else the workspace's (AC-14). A dark one never comes without its light. */
function accentsOf(own: LookRow | undefined, brand: BrandRow | undefined): Accents {
  const mine = hex(own?.accent);
  if (mine !== undefined) {
    const dark = hex(own?.accent_dark);
    return { accent: mine, ...(dark === undefined ? {} : { accentDark: dark }) };
  }
  const theirs = hex(brand?.accent);
  if (theirs === undefined) return {};
  const dark = hex(brand?.accentDark);
  return { accent: theirs, ...(dark === undefined ? {} : { accentDark: dark }) };
}

/** A short version of what a stylesheet draws: a new accent or photo is a new path. */
function versionOf(...parts: readonly (string | undefined)[]): string {
  return createHash('sha256')
    .update(parts.map((part) => part ?? '').join('|'))
    .digest('hex')
    .slice(0, 12);
}

/** Everything a booking page or form wears: its accents and logo, and the version its stylesheet is served at. */
export interface PageBrand {
  readonly accents: Accents;
  readonly logo?: { readonly path: string; readonly type: string; readonly version: string };
  /** What the public answer carries (`PublicBrand`), absent when the page wears nothing of its own. */
  readonly answer?: PublicBrand;
}

function pageBrandOf(accents: Accents, brand: BrandRow | undefined): PageBrand {
  const [path, type, version] = [brand?.logoPath, brand?.logoType, brand?.logoVersion];
  const logo =
    typeof path === 'string' && typeof type === 'string' && typeof version === 'string'
      ? { path, type, version }
      : undefined;
  const sheet = accents.accent === undefined ? undefined : versionOf(accents.accent, accents.accentDark);
  const answer: PublicBrand = {
    ...(sheet === undefined ? {} : { version: sheet }),
    ...(logo === undefined ? {} : { logo: logo.version }),
  };
  return {
    accents,
    ...(logo === undefined ? {} : { logo }),
    ...(sheet === undefined && logo === undefined ? {} : { answer }),
  };
}

/**
 * A booking page's brand (AC-4, AC-14): a personal page wears its owner's own accent when they set one, else the
 * workspace's; a team page always the workspace's. The logo is always the workspace's. A deleted page wears nothing.
 * One transaction, through the page's own entry.
 */
export async function readBookingBrand(entry: BookingEntry): Promise<PageBrand> {
  return inWorkspace(entry.scope, async (tx) => {
    const [page] = await tx
      .select({ kind: bookingPages.kind, ownerUserId: bookingPages.ownerUserId })
      .from(bookingPages)
      .where(and(eq(bookingPages.id, entry.pageId), isNull(bookingPages.deletedAt)));
    if (page === undefined) return { accents: {} };
    const brand = await brandRowOf(tx, entry.scope.workspaceId);
    const own =
      page.kind === 'personal' && page.ownerUserId !== null
        ? await lookRowOf(tx, page.ownerUserId, entry.scope.workspaceId)
        : undefined;
    return pageBrandOf(accentsOf(own, brand), brand);
  });
}

/** A hosted form's brand (AC-4): its workspace's accent and logo, through the form's own entry. */
export async function readFormBrand(entry: { readonly scope: EngineScope }): Promise<PageBrand> {
  return inWorkspace(entry.scope, async (tx) => {
    const brand = await brandRowOf(tx, entry.scope.workspaceId);
    return pageBrandOf(accentsOf(undefined, brand), brand);
  });
}

/** One photo of a link page: where the store keeps it, its checked type, and the version its path carries. */
export interface LookImage {
  readonly path: string;
  readonly type: string;
  readonly version: string;
}

/** Everything a link page wears beyond its look's names: the accents, the two photos, and the public answer. */
export interface PageLook {
  readonly accents: Accents;
  readonly cover?: LookImage;
  readonly ground?: LookImage;
  readonly answer?: PublicLook;
}

function imageOf(path: string | null, type: string | null, version: string | null): LookImage | undefined {
  return path !== null && type !== null && version !== null && /^[0-9a-f]{12}$/.test(version)
    ? { path, type, version }
    : undefined;
}

/**
 * A link page's accent and photos (AC-14): its owner's own accent, else their workspace's brand, and the cover and
 * photo ground they uploaded. `owner` is what the handle door answered, so this reads only that page's workspace.
 */
export async function readHandleLook(deps: { readonly db: Database }, owner: HandleOwner): Promise<PageLook> {
  return deps.db.withWorkspace(owner.workspaceId, async (tx: WorkspaceTx) => {
    const own = await lookRowOf(tx, owner.userId, owner.workspaceId);
    const brand = await brandRowOf(tx, owner.workspaceId);
    const accents = accentsOf(own, brand);
    const cover = imageOf(own?.cover_path ?? null, own?.cover_type ?? null, own?.cover_version ?? null);
    const ground = imageOf(own?.ground_path ?? null, own?.ground_type ?? null, own?.ground_version ?? null);
    const drawsAnything = accents.accent !== undefined || cover !== undefined || ground !== undefined;
    const version = drawsAnything
      ? versionOf(accents.accent, accents.accentDark, cover?.version, ground?.version)
      : undefined;
    const answer: PublicLook = {
      ...(version === undefined ? {} : { version }),
      ...(cover === undefined ? {} : { cover: cover.version }),
      ...(ground === undefined ? {} : { ground: ground.version }),
    };
    return {
      accents,
      ...(cover === undefined ? {} : { cover }),
      ...(ground === undefined ? {} : { ground }),
      ...(drawsAnything ? { answer } : {}),
    };
  });
}

/** The custom properties of an accent pair, or none for the product's own. */
function accentDeclarations(accents: Accents): readonly (readonly [string, string])[] {
  if (accents.accent === undefined) return [];
  return brandProperties(
    brandVariables({
      accent: accents.accent,
      ...(accents.accentDark === undefined ? {} : { accentDark: accents.accentDark }),
    }),
  );
}

/** One `:root` block of checked declarations: names from `BRAND_PROPERTIES` or ours, values a hex or our own url. */
function rootBlock(declarations: readonly (readonly [string, string])[]): string {
  const safe = declarations.filter(
    ([name, value]) =>
      /^--[a-z-]+$/.test(name) &&
      (BRAND_HEX_PATTERN.test(value) || /^url\("\/api\/public\/[a-z0-9/?=.-]+"\)$/.test(value)),
  );
  return `:root{${safe.map(([name, value]) => `${name}:${value}`).join(';')}}\n`;
}

/** A booking page's or form's brand stylesheet: its accent's custom properties, light and dark (AC-4, AC-5). */
export function brandStylesheet(brand: PageBrand): string {
  return rootBlock(accentDeclarations(brand.accents));
}

/** The custom properties that carry a link page's photos: the stylesheet draws them under the scrim and in the band. */
export const LOOK_IMAGE_PROPERTIES = { cover: '--page-cover-image', ground: '--page-ground-image' } as const;

/**
 * A link page's own stylesheet (AC-14, AC-10, AC-13): its accent's custom properties and a `url()` for each photo,
 * on our own image routes under its current handle.
 */
export function lookStylesheet(look: PageLook, handle: string): string {
  const images: (readonly [string, string])[] = [];
  for (const slot of ['cover', 'ground'] as const satisfies readonly PageImageSlot[]) {
    const image = look[slot];
    const path = image === undefined ? undefined : lookImagePath(handle, slot, image.version);
    if (path !== undefined) images.push([LOOK_IMAGE_PROPERTIES[slot], `url("${path}")`]);
  }
  return rootBlock([...accentDeclarations(look.accents), ...images]);
}
