// What a picture picker takes before the cropper (spec 0060, AC-2, AC-13; spec 0061, AC-6108). Cropping and drawing
// again live in one place for every picture since spec 0068 (AC-6809): `PhotoCrop` and `preparePhoto` in
// `@crm/ui` and `@crm/ui/photo`. `apps/web` may not import the contracts, so the numbers the server holds to are
// repeated here and kept equal by hand.

/** The types a person may pick: what the server takes. SVG is refused (it runs scripts). */
export const BRAND_PHOTO_TYPES: readonly string[] = ['image/png', 'image/jpeg', 'image/webp'];

/** The largest file a person may pick, before it is drawn again: a phone's photo is a few megabytes. */
export const BRAND_PHOTO_PICK_MAX_BYTES = 20_000_000;

/**
 * The largest logo a person may pick: the server's own limit (4 MB), said as it is in the picker's hint. A logo is
 * small, so the redraw never needs room to shrink a phone's photo here.
 */
export const BRAND_LOGO_PICK_MAX_BYTES = 4_000_000;

/** The largest picture a block may be picked from (spec 0061, AC-6108): `PROFILE_IMAGE_PICK_MAX_BYTES`. */
export const PICTURE_PICK_MAX_BYTES = 10_000_000;
