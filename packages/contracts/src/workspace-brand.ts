// A workspace's brand kit (spec 0060, AC-1 to AC-4, AC-22, AC-23): a logo and an accent colour that its booking
// pages and hosted forms wear. Settings › Brand reads it with `brand.get` and an owner or admin saves it with
// `brand.save`; the logo goes up as its own request (`/api/brand/logo`), since it is bytes. The only free value is
// the accent, a hex checked here and again by the database, so nothing a person typed ever reaches CSS. The
// colours a page draws from it come from `brandVariables()` (`./brand-colour.ts`).
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { BRAND_HEX_PATTERN } from './brand-colour.ts';
import { Uuid } from './values/ids.ts';
import { WorkspaceScoped } from './workspaces.ts';

/** The one sentence a colour that isn't a hex is refused with. It never repeats what was typed. */
export const BRAND_HEX_REFUSAL = 'Use a colour like #1f5fd6.';

/**
 * A brand colour: `#` and six hex digits, any case on the way in, lowercase once checked. `red`, `#fff`, a seventh
 * digit or anything after the sixth (`#123456;}`) is refused, so the value can be written into a stylesheet as is.
 */
export const BrandHex = z
  .string({ error: BRAND_HEX_REFUSAL })
  .max(7, { error: BRAND_HEX_REFUSAL })
  .toLowerCase()
  .regex(BRAND_HEX_PATTERN, { error: BRAND_HEX_REFUSAL });
/** A brand colour, checked. */
export type BrandHex = z.infer<typeof BrandHex>;

/** The largest logo, cover or photo ground taken, in bytes (AC-2, AC-13). */
export const BRAND_IMAGE_MAX_BYTES = 4 * 1024 * 1024;

/** A served image's version: the short hash the server made of its bytes. */
export const ImageVersion = z.string().regex(/^[0-9a-f]{12}$/);
/** A served image's version. */
export type ImageVersion = z.infer<typeof ImageVersion>;

/**
 * A workspace's brand kit as Settings › Brand reads it. No accent means the product's own; no dark accent means the
 * light one lifted for dark pages; no logo means none. `canEdit` is whether the reader may change it (owners and
 * admins, AC-1): everyone else sees it read only.
 */
export const WorkspaceBrand = z.object({
  accent: BrandHex.optional(),
  accentDark: BrandHex.optional(),
  logo: z.object({ version: ImageVersion }).optional(),
  canEdit: z.boolean(),
});
/** A workspace's brand kit. */
export type WorkspaceBrand = z.infer<typeof WorkspaceBrand>;

/**
 * Saves the accent pair, whole: `null` clears one. A dark accent needs a light one beside it, since the light one is
 * what every page without the dark one draws.
 */
export const SaveBrandInput = WorkspaceScoped.extend({
  accent: BrandHex.nullable(),
  accentDark: BrandHex.nullable(),
  mutationId: Uuid,
}).refine((input) => input.accentDark === null || input.accent !== null, {
  error: 'Pick the main colour before a dark one.',
  path: ['accentDark'],
});
/** Saves the accent pair. */
export type SaveBrandInput = z.infer<typeof SaveBrandInput>;

/**
 * What a public booking page or form is told of its brand, beside its facts: the version its stylesheet and logo
 * are served at. Absent when the page draws the product's own look, and `logo` absent when it has none.
 */
export const PublicBrand = z.object({
  version: z
    .string()
    .regex(/^[0-9a-f]{12}$/)
    .optional(),
  logo: ImageVersion.optional(),
});
/** What a public page is told of its brand. */
export type PublicBrand = z.infer<typeof PublicBrand>;

/** A public key (booking page or form) as a path segment takes it. */
const PUBLIC_KEY = /^[A-Za-z0-9_-]{16}$/;
const VERSION = /^[0-9a-f]{12}$/;

/** Which kind of public page a brand path is for. */
export type BrandedPage = 'booking' | 'forms';

/** The brand stylesheet of a booking page or form: `/api/public/<kind>/<key>/brand.css?v=<version>`. */
export function brandStylesheetPath(kind: BrandedPage, publicKey: string, version: string): string | undefined {
  if (!PUBLIC_KEY.test(publicKey) || !VERSION.test(version)) return undefined;
  return `/api/public/${kind}/${publicKey}/brand.css?v=${version}`;
}

/** The workspace logo on a booking page or form: `/api/public/<kind>/<key>/logo?v=<version>`. */
export function brandLogoPath(kind: BrandedPage, publicKey: string, version: string): string | undefined {
  if (!PUBLIC_KEY.test(publicKey) || !VERSION.test(version)) return undefined;
  return `/api/public/${kind}/${publicKey}/logo?v=${version}`;
}

/** The logo as Settings › Brand shows it to members: `/api/brand/logo?workspace=<slug>&v=<version>`. */
export function memberLogoPath(workspace: string, version: string): string {
  return `/api/brand/logo?${new URLSearchParams({ workspace, v: version }).toString()}`;
}

/** The header a brand or link page upload names its workspace by: its address, as every RPC input does. */
export const UPLOAD_WORKSPACE_HEADER = 'x-crm-workspace';

/**
 * The brand procedures. Any member reads the kit (everyone sees it, read only); saving it takes `workspace.manage`
 * (owners and admins). Neither touches a record, so no change event is stored.
 */
export const brandContract = {
  get: oc.input(WorkspaceScoped).output(WorkspaceBrand),
  save: oc.input(SaveBrandInput).output(WorkspaceBrand),
};
